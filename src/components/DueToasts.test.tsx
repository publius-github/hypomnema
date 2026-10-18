// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => "denied"),
  sendNotification: vi.fn(),
}));

import DueToasts from "./DueToasts";
import { useAppStore } from "../store";
import { defaultConfig, makeTask } from "../test/fixtures";
import { todayISO } from "../lib/tasks";

// A timed task already due when the app starts raises its own toast:
// the text opens the task, the cross only closes the toast.
function dueTask() {
  const task = makeTask({ id: 7, title: "Call the bank", scheduled_date: todayISO(), time: "00:00" });
  useAppStore.setState({
    tasks: [task],
    today: todayISO(),
    config: { ...defaultConfig, notify_system: false },
  });
}

describe("DueToasts", () => {
  beforeEach(dueTask);

  it("opens the task its text names", () => {
    const onOpen = vi.fn();
    render(<DueToasts onOpen={onOpen} />);
    fireEvent.click(screen.getByTitle("Open the task"));
    expect(onOpen).toHaveBeenCalledWith(7);
    expect(screen.queryByText("00:00 Call the bank")).toBeNull();
  });

  it("closes without opening anything from its cross", () => {
    const onOpen = vi.fn();
    render(<DueToasts onOpen={onOpen} />);
    expect(screen.getByText("00:00 Call the bank")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByText("00:00 Call the bank")).toBeNull();
  });
});
