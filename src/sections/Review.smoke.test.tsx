// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTheme: vi.fn(async () => {}) }),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => "denied"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  ask: vi.fn(async () => false),
}));

import Review from "./Review";
import { useAppStore } from "../store";
import { baseHandlers, defaultConfig, makeTask } from "../test/fixtures";
import { dispatchCommands } from "../test/tauriMocks";
import { todayISO } from "../lib/tasks";

describe("Review smoke", () => {
  it("marks a still-open task done from the row action strip", async () => {
    const today = todayISO();
    const task = makeTask({
      title: "open leftover",
      scheduled_date: today,
      origin: "manual",
    });
    dispatchCommands(
      invokeMock,
      baseHandlers({
        tasks_snapshot: () => [task],
        task_update: () => ({ ...task, status: "done" }),
      }),
    );
    useAppStore.setState({
      config: defaultConfig,
      lists: [],
      tasks: [],
      vaultVersion: 0,
    });

    render(<Review />);
    expect(await screen.findByText("open leftover")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Mark done"));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("task_update", {
        id: task.id,
        patch: { status: "done" },
      }),
    );
  });
});
