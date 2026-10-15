// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import MobileApp from "./MobileApp";
import { useAppStore } from "../store";
import { baseHandlers, defaultConfig, makeTask } from "../test/fixtures";
import { dispatchCommands } from "../test/tauriMocks";
import { todayISO } from "../lib/tasks";

describe("MobileApp smoke", () => {
  afterEach(() => cleanup());

  it("shows today's tasks and completes one by tapping the row", async () => {
    const today = todayISO();
    const task = makeTask({ title: "water the plants", scheduled_date: today });
    dispatchCommands(
      invokeMock,
      baseHandlers({
        tasks_snapshot: () => [task],
        task_update: () => ({ ...task, status: "done" }),
      }),
    );
    useAppStore.setState({
      config: defaultConfig,
      vaultPath: "/vault",
      lists: [],
      tasks: [task],
      today,
    });

    render(<MobileApp />);

    fireEvent.click(await screen.findByText("water the plants"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("task_update", {
        id: task.id,
        patch: { status: "done" },
      }),
    );
  });

  it("lays the day out like the desktop column: closed sections, drop action", async () => {
    const today = todayISO();
    const open = makeTask({ id: 1, title: "open one", scheduled_date: today });
    const later = makeTask({
      id: 2,
      title: "later one",
      scheduled_date: today,
      status: "postponed",
    });
    dispatchCommands(
      invokeMock,
      baseHandlers({
        tasks_snapshot: () => [open, later],
        task_update: () => ({ ...open, status: "dropped" }),
      }),
    );
    useAppStore.setState({
      config: {
        ...defaultConfig,
        done_display: "separate",
        fold_postponed: true,
        sync_auto: false,
      },
      vaultPath: "/vault",
      lists: [],
      tasks: [open, later],
      today,
    });

    render(<MobileApp />);

    // a section set to start folded shows only its plate; a click opens it
    expect(await screen.findByText("Postponed")).toBeTruthy();
    expect(screen.queryByText("later one")).toBeNull();
    fireEvent.click(screen.getByText("Postponed"));
    expect(screen.getByText("later one")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Task actions")[0]);
    fireEvent.click(screen.getByText("Drop"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("task_update", {
        id: open.id,
        patch: { status: "dropped" },
      }),
    );
  });

  it("adds a task to the day being shown", async () => {
    const today = todayISO();
    dispatchCommands(
      invokeMock,
      baseHandlers({
        tasks_snapshot: () => [],
        task_create: () => makeTask({ title: "call the dentist" }),
      }),
    );
    useAppStore.setState({
      config: defaultConfig,
      vaultPath: "/vault",
      lists: [],
      tasks: [],
      today,
    });

    render(<MobileApp />);

    fireEvent.change(await screen.findByPlaceholderText(/New task for/), {
      target: { value: "call the dentist" },
    });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("task_create", {
        new: expect.objectContaining({
          title: "call the dentist",
          scheduled_date: today,
        }),
      }),
    );
  });

  it("edits a task's title from the task editor", async () => {
    const today = todayISO();
    const task = makeTask({ title: "call mum", scheduled_date: today });
    dispatchCommands(
      invokeMock,
      baseHandlers({
        tasks_snapshot: () => [task],
        task_update: () => ({ ...task, title: "call mum back" }),
      }),
    );
    useAppStore.setState({
      config: { ...defaultConfig, sync_auto: false },
      vaultPath: "/vault",
      lists: [],
      tasks: [task],
      today,
    });

    render(<MobileApp />);

    fireEvent.click(await screen.findByLabelText("Task actions"));
    fireEvent.click(screen.getByText("Edit"));
    const title = await screen.findByDisplayValue("call mum");
    fireEvent.change(title, { target: { value: "call mum back" } });
    fireEvent.blur(title);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("task_update", {
        id: task.id,
        patch: { title: "call mum back" },
      }),
    );
  });

  it("creates a list from the lists tab", async () => {
    dispatchCommands(
      invokeMock,
      baseHandlers({
        tasks_snapshot: () => [],
        list_create: () => ({ id: 7, name: "Errands" }),
      }),
    );
    useAppStore.setState({
      config: { ...defaultConfig, sync_auto: false },
      vaultPath: "/vault",
      lists: [],
      tasks: [],
      today: todayISO(),
    });

    render(<MobileApp />);

    fireEvent.click(await screen.findByText("Lists"));
    fireEvent.change(await screen.findByPlaceholderText("New list"), {
      target: { value: "Errands" },
    });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("list_create", {
        name: "Errands",
        color: null,
      }),
    );
  });

  it("reaches Upcoming through the More tab and adds a birthday", async () => {
    dispatchCommands(
      invokeMock,
      baseHandlers({
        tasks_snapshot: () => [],
        upcoming_events: () => ({ events: [], errors: [] }),
        birthdays_list: () => ({ birthdays: [], errors: [] }),
        recurring_list: () => ({ rules: [], errors: [] }),
        birthday_add: () => null,
      }),
    );
    useAppStore.setState({
      config: { ...defaultConfig, sync_auto: false },
      vaultPath: "/vault",
      lists: [],
      tasks: [],
      today: todayISO(),
    });

    render(<MobileApp />);

    fireEvent.click(await screen.findByText("More"));
    fireEvent.click(await screen.findByText("Upcoming"));
    fireEvent.click(await screen.findByText("Birthdays"));
    fireEvent.click(await screen.findByText("+ Add"));
    fireEvent.change(screen.getByPlaceholderText("Whose birthday"), {
      target: { value: "Ada" },
    });
    fireEvent.change(screen.getByPlaceholderText("MM-DD"), {
      target: { value: "12-10" },
    });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("birthday_add", {
        entry: { name: "Ada", date: "12-10", year: null },
      }),
    );
  });

  it("offers Undo after a delete and restores through it", async () => {
    const today = todayISO();
    const task = makeTask({ title: "feed the cat", scheduled_date: today });
    const deleted = { tasks: [task], rule_run: null };
    dispatchCommands(
      invokeMock,
      baseHandlers({
        tasks_snapshot: () => [task],
        task_delete: () => deleted,
        task_restore: () => [task],
      }),
    );
    useAppStore.setState({
      config: { ...defaultConfig, sync_auto: false },
      vaultPath: "/vault",
      lists: [],
      tasks: [task],
      today,
      undoEntry: null,
    });

    render(<MobileApp />);

    fireEvent.click(await screen.findByLabelText("Task actions"));
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(await screen.findByText("Undo"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("task_restore", { deleted }),
    );
  });

  it("searches everything from the day header", async () => {
    dispatchCommands(
      invokeMock,
      baseHandlers({
        tasks_snapshot: () => [],
        tasks_search: () => [makeTask({ title: "buy searchlight" })],
        kb_search: () => [],
        journal_search: () => [],
      }),
    );
    useAppStore.setState({
      config: { ...defaultConfig, sync_auto: false },
      vaultPath: "/vault",
      lists: [],
      tasks: [],
      today: todayISO(),
    });

    render(<MobileApp />);

    fireEvent.click(await screen.findByLabelText("Search"));
    fireEvent.change(
      screen.getByPlaceholderText("Search tasks, notes and journal..."),
      { target: { value: "search" } },
    );

    expect(await screen.findByText("buy searchlight")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("tasks_search", {
      query: "search",
    });
  });

  it("switches to another tab", async () => {
    dispatchCommands(
      invokeMock,
      baseHandlers({ tasks_snapshot: () => [], kb_tree: () => [] }),
    );
    useAppStore.setState({
      config: defaultConfig,
      vaultPath: "/vault",
      lists: [],
      tasks: [],
      today: todayISO(),
    });

    render(<MobileApp />);

    fireEvent.click(await screen.findByText("Notes"));
    expect(await screen.findByText("Nothing here.")).toBeTruthy();
  });
});
