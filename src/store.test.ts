import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTheme: vi.fn(async () => {}) }),
}));

import { useAppStore } from "./store";
import { msToNextMark } from "./store/tasks";
import { baseHandlers, defaultConfig, makeTask } from "./test/fixtures";
import { dispatchCommands } from "./test/tauriMocks";
import type { List, Task } from "./types";

/** A promise the test resolves or rejects by hand, to order IPC replies. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("store task mutations", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAppStore.setState({
      config: defaultConfig,
      vaultPath: "/test/vault",
      lists: [],
      groups: [],
      tasks: [],
      error: null,
      undoEntry: null,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies a patch optimistically and rolls back only that task on rejection", async () => {
    const a = makeTask({ title: "a" });
    const b = makeTask({ title: "b" });
    useAppStore.setState({ tasks: [a, b] });
    const reply = deferred<Task>();
    dispatchCommands(invokeMock, {
      task_update: () => reply.promise,
    });

    const pending = useAppStore.getState().updateTask(a.id, { status: "done" });
    // optimistic: the row shows done before the core has answered
    expect(useAppStore.getState().tasks[0].status).toBe("done");

    reply.reject({ kind: "db", message: "disk full" });
    await pending;
    const { tasks, error } = useAppStore.getState();
    expect(tasks[0].status).toBe("todo");
    expect(tasks[1]).toBe(b);
    expect(error).toBe("disk full");
  });

  it("lets only the latest of two overlapping patches on one task land", async () => {
    const a = makeTask({ title: "a" });
    useAppStore.setState({ tasks: [a] });
    const first = deferred<Task>();
    const second = deferred<Task>();
    let call = 0;
    dispatchCommands(invokeMock, {
      task_update: () => (++call === 1 ? first.promise : second.promise),
    });

    const p1 = useAppStore.getState().updateTask(a.id, { status: "done" });
    const p2 = useAppStore.getState().updateTask(a.id, { status: "postponed" });
    // the newer call answers first, then the stale one arrives
    second.resolve({ ...a, status: "postponed" });
    await p2;
    first.resolve({ ...a, status: "done" });
    await p1;
    expect(useAppStore.getState().tasks[0].status).toBe("postponed");
  });

  it("a stale call's rejection reports but does not roll back the newer state", async () => {
    const a = makeTask({ title: "a" });
    useAppStore.setState({ tasks: [a] });
    const first = deferred<Task>();
    const second = deferred<Task>();
    let call = 0;
    dispatchCommands(invokeMock, {
      task_update: () => (++call === 1 ? first.promise : second.promise),
    });

    const p1 = useAppStore.getState().updateTask(a.id, { title: "one" });
    const p2 = useAppStore.getState().updateTask(a.id, { title: "two" });
    second.resolve({ ...a, title: "two" });
    await p2;
    first.reject({ kind: "state", message: "late failure" });
    await p1;
    const { tasks, error } = useAppStore.getState();
    expect(tasks[0].title).toBe("two");
    expect(error).toBe("late failure");
  });

  it("delete offers Undo, and Undo puts the restored rows back", async () => {
    vi.useFakeTimers();
    const parent = makeTask({ title: "parent" });
    const child = makeTask({ title: "child", parent_task_id: parent.id });
    const other = makeTask({ title: "other" });
    useAppStore.setState({ tasks: [parent, child, other] });
    const snapshot = { tasks: [parent, child], rule_run: null };
    dispatchCommands(invokeMock, {
      task_delete: () => snapshot,
      task_restore: (args) => {
        expect(args).toEqual({ deleted: snapshot });
        return [parent, child];
      },
    });

    await useAppStore.getState().deleteTask(parent.id);
    let state = useAppStore.getState();
    expect(state.tasks).toEqual([other]);
    expect(state.undoEntry).toMatchObject({
      kind: "task",
      label: 'Deleted "parent"',
    });

    await useAppStore.getState().undoLast();
    state = useAppStore.getState();
    expect(state.undoEntry).toBeNull();
    expect(state.tasks.map((t) => t.title).sort()).toEqual([
      "child",
      "other",
      "parent",
    ]);
  });

  it("Uncheck all offers Undo, and Undo puts the ticks back", async () => {
    vi.useFakeTimers();
    const packing: List = {
      id: 3,
      name: "Packing",
      sort_order: 0,
      color: null,
      archived: false,
      auto: false,
      favorite: false,
      description: "",
      kind: "checklist",
      group_id: null,
    };
    const previous = [
      { id: 11, status: "done", completed_at: "2026-10-01T10:00:00Z" },
      { id: 12, status: "done", completed_at: "2026-10-01T10:05:00Z" },
    ];
    useAppStore.setState({ lists: [packing] });
    const restored: unknown[] = [];
    dispatchCommands(
      invokeMock,
      baseHandlers({
        lists_all: () => [packing],
        list_set_all_statuses: (args) => {
          expect(args).toEqual({ id: 3, done: false });
          return previous;
        },
        tasks_restore_statuses: (args) => {
          restored.push(args);
          return 2;
        },
      }),
    );

    await useAppStore.getState().setListStatuses(3, false);
    expect(useAppStore.getState().undoEntry).toMatchObject({
      kind: "statuses",
      label: 'Unchecked 2 items in "Packing"',
    });

    await useAppStore.getState().undoLast();
    expect(restored).toEqual([{ states: previous }]);
    expect(useAppStore.getState().undoEntry).toBeNull();
  });

  it("every N minutes, checked tasks hold until the clock's next mark and move together", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 1, 12, 3, 30));
    useAppStore.setState({
      config: { ...defaultConfig, done_move_every_minutes: 10 },
      statusHold: [],
    });
    const { holdStatus } = useAppStore.getState();
    holdStatus(1, "todo");
    vi.advanceTimersByTime(4 * 60_000);
    holdStatus(2, "todo");
    // 12:07:30: both still where they were clicked
    vi.advanceTimersByTime(2.5 * 60_000 - 1);
    expect(useAppStore.getState().statusHold.map((h) => h.id)).toEqual([1, 2]);
    // 12:10:00: the mark - both move at once
    vi.advanceTimersByTime(1);
    expect(useAppStore.getState().statusHold).toEqual([]);
  });

  it("finds the next N-minute mark of the day", () => {
    const at = (h: number, m: number, sec = 0) =>
      new Date(2026, 10, 1, h, m, sec);
    expect(msToNextMark(at(12, 3, 30), 10)).toBe(6.5 * 60_000);
    expect(msToNextMark(at(12, 10), 10)).toBe(10 * 60_000);
    expect(msToNextMark(at(9, 59), 15)).toBe(60_000);
    // 7 does not divide the day: the last stretch ends at midnight
    expect(msToNextMark(at(23, 58), 7)).toBe(2 * 60_000);
  });

  it("the Undo offer expires after undo_toast_seconds", async () => {
    vi.useFakeTimers();
    useAppStore.setState({ tasks: [makeTask({ title: "gone" })] });
    dispatchCommands(invokeMock, {
      task_delete: () => ({ tasks: [], rule_run: null }),
    });
    await useAppStore.getState().deleteTask(useAppStore.getState().tasks[0].id);
    expect(useAppStore.getState().undoEntry).not.toBeNull();
    vi.advanceTimersByTime(defaultConfig.undo_toast_seconds * 1000 + 1);
    expect(useAppStore.getState().undoEntry).toBeNull();
  });

  it("reorder renumbers the column optimistically and sends the new order", async () => {
    const list = 7;
    const t1 = makeTask({ title: "1", list_id: list, sort_order: 0 });
    const t2 = makeTask({ title: "2", list_id: list, sort_order: 1 });
    const t3 = makeTask({ title: "3", list_id: list, sort_order: 2 });
    useAppStore.setState({ tasks: [t1, t2, t3] });
    let sent: unknown = null;
    dispatchCommands(invokeMock, {
      tasks_reorder: (args) => {
        sent = args;
        return undefined;
      },
    });

    await useAppStore.getState().reorderTask(t3.id, t1.id);
    expect(sent).toEqual({ listId: list, orderedIds: [t3.id, t1.id, t2.id] });
    const order = useAppStore
      .getState()
      .tasks.slice()
      .sort((x, y) => x.sort_order - y.sort_order)
      .map((t) => t.title);
    expect(order).toEqual(["3", "1", "2"]);
  });

  it("a rejected reorder reports and refetches the snapshot", async () => {
    const list = 7;
    const t1 = makeTask({ title: "1", list_id: list, sort_order: 0 });
    const t2 = makeTask({ title: "2", list_id: list, sort_order: 1 });
    useAppStore.setState({ tasks: [t1, t2] });
    dispatchCommands(
      invokeMock,
      baseHandlers({
        tasks_reorder: () => {
          throw { kind: "db", message: "locked" };
        },
        tasks_snapshot: () => [t1, t2],
      }),
    );

    await useAppStore.getState().reorderTask(t2.id, t1.id);
    await flush();
    const state = useAppStore.getState();
    expect(state.error).toBe("locked");
    expect(state.tasks).toEqual([t1, t2]);
  });
});
