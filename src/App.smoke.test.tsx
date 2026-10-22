// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { invokeMock, listeners } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => unknown>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => unknown) => {
    listeners.set(name, handler);
    return () => {};
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTheme: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
  }),
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.0.0-test"),
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

import App from "./App";
import { baseHandlers, emptyOutcome, makeTask } from "./test/fixtures";
import { dispatchCommands } from "./test/tauriMocks";
import { todayISO } from "./lib/tasks";

describe("App smoke", () => {
  it("boots into the dashboard and shows a snapshot task", async () => {
    const task = makeTask({
      title: "smoke fixture task",
      scheduled_date: todayISO(),
    });
    dispatchCommands(invokeMock, baseHandlers({ tasks_snapshot: () => [task] }));

    render(<App />);

    expect(await screen.findByText("smoke fixture task")).toBeTruthy();
    // the vault resolved, so the picker never shows
    expect(invokeMock).toHaveBeenCalledWith("vault_status", undefined);
    expect(invokeMock).toHaveBeenCalledWith("engine_run", undefined);
  });

  it("keeps a config error banner through a vault-updated without errors", async () => {
    const broken = { file: "recurring.yml", line: 3, message: "bad indentation" };
    dispatchCommands(
      invokeMock,
      baseHandlers({
        engine_run: () => ({ ...emptyOutcome, errors: [broken] }),
      }),
    );

    render(<App />);
    const banner = "recurring.yml line 3: bad indentation";
    expect(await screen.findByText(banner)).toBeTruthy();

    const fire = (payload: unknown) =>
      act(async () => {
        await listeners.get("vault-updated")?.({ payload });
      });
    // quick capture and a sync pass know nothing about the config files
    await fire(null);
    expect(screen.queryByText(banner)).toBeTruthy();
    // the config watcher does, and an empty list means fixed
    await fire([]);
    expect(screen.queryByText(banner)).toBeNull();
  });
});
