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

import QuickAddModal from "./QuickAddModal";
import { useAppStore } from "../store";
import { defaultConfig, makeTask } from "../test/fixtures";
import { dispatchCommands } from "../test/tauriMocks";
import { todayISO } from "../lib/tasks";

describe("QuickAddModal", () => {
  it("creates a task on submit via task_create", async () => {
    const today = todayISO();
    dispatchCommands(invokeMock, {
      task_create: () =>
        makeTask({ title: "buy milk", scheduled_date: today }),
    });
    useAppStore.setState({
      config: defaultConfig,
      lists: [],
      tasks: [],
      today,
      gridOffset: 0,
    });

    render(<QuickAddModal onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Task title/), {
      target: { value: "buy milk" },
    });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("task_create", {
        new: expect.objectContaining({
          title: "buy milk",
          scheduled_date: today,
        }),
      }),
    );
  });
});
