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

import MetricPrompt from "./MetricPrompt";
import { useAppStore } from "../store";
import { baseHandlers, defaultConfig, makeTask } from "../test/fixtures";
import { dispatchCommands } from "../test/tauriMocks";

function setup() {
  const calls: { cmd: string; args: unknown }[] = [];
  const task = makeTask({
    title: "{Health} Weigh in",
    origin: "recurring",
    rule_key: "r",
    // carried over from yesterday: the value belongs to its own day
    origin_date: "2026-08-30",
    scheduled_date: "2026-08-31",
    status: "todo",
  });
  const record = (cmd: string) => (args: unknown) => {
    calls.push({ cmd, args });
    return cmd === "task_update" ? { ...task, status: "done" } : undefined;
  };
  dispatchCommands(
    invokeMock,
    baseHandlers({
      task_update: record("task_update"),
      measurement_set: record("measurement_set"),
    }),
  );
  useAppStore.setState({
    config: defaultConfig,
    tasks: [task],
    lists: [],
    metricLinks: { r: ["weight"] },
    metricDefs: { weight: { id: "weight", name: "Weight", unit: "kg", decimals: 1 } },
    metricValues: {},
    metricPrompt: null,
  });
  return { calls, task };
}

describe("MetricPrompt smoke", () => {
  it("holds a check-off for the value, then records it on the task's day", async () => {
    const { calls, task } = setup();
    render(<MetricPrompt />);
    await useAppStore.getState().updateTask(task.id, { status: "done" });
    expect(calls).toEqual([]);

    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "80,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(calls.map((c) => c.cmd)).toEqual(["measurement_set", "task_update"]));
    expect(calls[0].args).toEqual({ metric: "weight", date: "2026-08-30", value: 80.5 });
    expect(calls[1].args).toMatchObject({ id: task.id, patch: { status: "done" } });
    expect(useAppStore.getState().metricValues["weight|2026-08-30"]).toBe(80.5);
    expect(useAppStore.getState().metricPrompt).toBeNull();
  });

  it("cancels without a trace, or checks off without a value", async () => {
    const { calls, task } = setup();
    render(<MetricPrompt />);
    await useAppStore.getState().updateTask(task.id, { status: "done" });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(useAppStore.getState().metricPrompt).toBeNull();
    expect(calls).toEqual([]);
    expect(useAppStore.getState().tasks[0].status).toBe("todo");

    await useAppStore.getState().updateTask(task.id, { status: "done" });
    fireEvent.click(await screen.findByRole("button", { name: "Done without value" }));
    await waitFor(() => expect(calls.map((c) => c.cmd)).toEqual(["task_update"]));
  });

  it("does not ask for a status other than done", async () => {
    const { calls, task } = setup();
    await useAppStore.getState().updateTask(task.id, { status: "postponed" });
    expect(useAppStore.getState().metricPrompt).toBeNull();
    expect(calls.map((c) => c.cmd)).toEqual(["task_update"]);
  });
});
