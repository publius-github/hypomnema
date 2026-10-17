// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

import MobileCalendar from "./MobileCalendar";
import { useAppStore } from "../store";
import type { OutlookEvent } from "../types";
import { dispatchCommands } from "../test/tauriMocks";
import { todayISO } from "../lib/tasks";

describe("MobileCalendar", () => {
  afterEach(() => cleanup());

  it("drops a late outlook for the month already paged away from", async () => {
    const today = todayISO();
    useAppStore.setState({ today, tasks: [] });
    let answerFirst: (events: OutlookEvent[]) => void = () => {};
    const outlookCalls: unknown[] = [];
    dispatchCommands(invokeMock, {
      tasks_snapshot: () => [],
      calendar_outlook: (args) => {
        outlookCalls.push(args);
        if (outlookCalls.length === 1) {
          return new Promise<OutlookEvent[]>((resolve) => {
            answerFirst = resolve;
          });
        }
        return [];
      },
    });

    render(<MobileCalendar />);
    await waitFor(() => expect(outlookCalls).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(outlookCalls).toHaveLength(2));

    // the slow answer for the month just left arrives last
    await act(async () => {
      answerFirst([{ date: today, title: "stale projection", kind: "recurring" }]);
    });

    expect(screen.queryByText("stale projection")).toBeNull();
  });
});
