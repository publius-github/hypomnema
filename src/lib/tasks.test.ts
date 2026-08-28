import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  currentAndNextBlock,
  gridDates,
  groupDayTasks,
  nextStatus,
  splitDone,
} from "./tasks";
import type { List, ScheduleBlock, Task } from "../types";

function task(overrides: Partial<Task>): Task {
  return {
    id: 1,
    title: "t",
    description_md: "",
    list_id: null,
    scheduled_date: null,
    time: null,
    status: "todo",
    color: null,
    sort_order: 0,
    parent_task_id: null,
    created_at: "",
    completed_at: null,
    overdue: false,
    origin: "manual",
    ...overrides,
  };
}

function list(overrides: Partial<List>): List {
  return {
    id: 1,
    name: "L",
    sort_order: 0,
    color: null,
    archived: false,
    auto: false,
    ...overrides,
  };
}

describe("nextStatus", () => {
  it("toggles open and done; a postponed task completes on click", () => {
    expect(nextStatus("todo")).toBe("done");
    expect(nextStatus("done")).toBe("todo");
    expect(nextStatus("postponed")).toBe("done");
  });
});

describe("date helpers", () => {
  it("adds days across month boundaries", () => {
    expect(addDaysISO("2026-08-30", 3)).toBe("2026-09-02");
  });

  it("builds the rolling window from today", () => {
    expect(gridDates("2026-08-28", 3)).toEqual([
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ]);
  });
});

describe("groupDayTasks", () => {
  const lists = [
    list({ id: 1, name: "Work", sort_order: 1 }),
    list({ id: 2, name: "Home", sort_order: 0 }),
  ];

  it("groups by list ordered by list sort_order, ungrouped first", () => {
    const groups = groupDayTasks(
      [
        task({ id: 1, list_id: 1 }),
        task({ id: 2, list_id: 2 }),
        task({ id: 3, list_id: null }),
      ],
      lists,
    );
    expect(groups.map((g) => g.listName)).toEqual(["", "Home", "Work"]);
  });

  it("sorts timed tasks first, by time then sort_order", () => {
    const groups = groupDayTasks(
      [
        task({ id: 1, sort_order: 0 }),
        task({ id: 2, time: "14:00" }),
        task({ id: 3, time: "09:00" }),
      ],
      [],
    );
    expect(groups[0].tasks.map((t) => t.id)).toEqual([3, 2, 1]);
  });

  it("treats tasks of an unknown list as ungrouped", () => {
    const groups = groupDayTasks([task({ id: 1, list_id: 99 })], lists);
    expect(groups).toHaveLength(1);
    expect(groups[0].listId).toBeNull();
  });
});

describe("currentAndNextBlock", () => {
  const block = (from: string, to: string, label: string): ScheduleBlock => ({
    from,
    to,
    label,
  });
  const at = (h: number, m: number) => new Date(2026, 7, 28, h, m);

  it("finds the covering block and the next one", () => {
    const blocks = [block("09:00", "12:30", "Deep work"), block("14:00", "17:00", "Meetings")];
    const focus = currentAndNextBlock(blocks, at(10, 15));
    expect(focus?.current?.label).toBe("Deep work");
    expect(focus?.next?.label).toBe("Meetings");
    const gap = currentAndNextBlock(blocks, at(13, 0));
    expect(gap?.current).toBeNull();
    expect(gap?.next?.label).toBe("Meetings");
  });

  it("supports a block spanning midnight", () => {
    const blocks = [block("22:00", "06:00", "Night")];
    expect(currentAndNextBlock(blocks, at(23, 30))?.current?.label).toBe(
      "Night",
    );
    expect(currentAndNextBlock(blocks, at(5, 0))?.current?.label).toBe(
      "Night",
    );
    expect(currentAndNextBlock(blocks, at(12, 0))?.current ?? null).toBeNull();
  });
});

describe("splitDone", () => {
  const tasks = [
    task({ id: 1, status: "done" }),
    task({ id: 2, status: "todo" }),
  ];

  it("keeps done inline by default", () => {
    const { active, done } = splitDone(tasks, "inline");
    expect(active).toHaveLength(2);
    expect(done).toHaveLength(0);
  });

  it("separates done tasks in separate mode", () => {
    const { active, done } = splitDone(tasks, "separate");
    expect(active.map((t) => t.id)).toEqual([2]);
    expect(done.map((t) => t.id)).toEqual([1]);
  });
});
