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

import Tracker from "./Tracker";
import { useAppStore } from "../store";
import { baseHandlers, defaultConfig } from "../test/fixtures";
import { dispatchCommands } from "../test/tauriMocks";

const b = (done: number, total: number) => ({ done, total });

describe("Tracker smoke", () => {
  it("shows the overall rate, the rules weakest first, and refetches by month", async () => {
    const calls: unknown[] = [];
    dispatchCommands(
      invokeMock,
      baseHandlers({
        habit_trends: (args: unknown) => {
          calls.push(args);
          return {
            periods: ["2026-08-17", "2026-08-24"],
            overall: [b(3, 4), b(1, 2)],
            rules: [
              {
                rule_key: "a",
                title: "{Health} weigh in",
                cadence: "daily",
                buckets: [b(1, 2), b(0, 1)],
                sum: b(1, 3),
              },
              {
                rule_key: "b",
                title: "review",
                cadence: "weekly",
                buckets: [b(2, 2), b(1, 1)],
                sum: b(3, 3),
              },
            ],
          };
        },
      }),
    );
    useAppStore.setState({ config: defaultConfig, vaultVersion: 0 });

    render(<Tracker />);
    expect(await screen.findByText("weigh in")).toBeTruthy();
    // 4 of 6 overall, rounded down like the rate chip
    expect(screen.getByText("66%")).toBeTruthy();
    expect(screen.getByText("33%")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    expect(calls[0]).toEqual({ unit: "week", count: 12 });

    fireEvent.click(screen.getByText("Months"));
    await waitFor(() => expect(calls.at(-1)).toEqual({ unit: "month", count: 6 }));
  });

  it("explains an empty range instead of drawing zeros", async () => {
    dispatchCommands(
      invokeMock,
      baseHandlers({
        habit_trends: () => ({ periods: ["2026-08-24"], overall: [b(0, 0)], rules: [] }),
      }),
    );
    useAppStore.setState({ config: defaultConfig, vaultVersion: 0 });
    render(<Tracker />);
    expect(await screen.findByText(/No recurring task has come due/)).toBeTruthy();
  });
});
