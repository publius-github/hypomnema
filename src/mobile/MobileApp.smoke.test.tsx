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
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

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

    fireEvent.click(await screen.findByText("+ Add task"));
    fireEvent.change(screen.getByRole("textbox"), {
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
