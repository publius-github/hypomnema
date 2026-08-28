import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  currentAndNextBlock,
  gridDates,
  groupByCadence,
  nextStatus,
  splitDone,
} from "./tasks";
import type { ScheduleBlock, Task } from "../types";

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
    cadence: null,
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

describe("groupByCadence", () => {
  it("orders groups once, daily, weekly, monthly, yearly", () => {
    const groups = groupByCadence([
      task({ id: 1, cadence: "yearly" }),
      task({ id: 2, cadence: "daily" }),
      task({ id: 3, cadence: null }),
      task({ id: 4, cadence: "weekly" }),
      task({ id: 5, cadence: "monthly" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      null,
      "Daily",
      "Weekly",
      "Monthly",
      "Yearly",
    ]);
    expect(groups.map((g) => g.tasks[0].id)).toEqual([3, 2, 4, 5, 1]);
  });

  it("skips empty groups and treats unknown cadence as one-off", () => {
    const groups = groupByCadence([
      task({ id: 1, cadence: "hourly" }),
      task({ id: 2, cadence: "daily" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["once", "daily"]);
  });

  it("sorts timed tasks first inside a group, by time then sort_order", () => {
    const groups = groupByCadence([
      task({ id: 1, sort_order: 0 }),
      task({ id: 2, time: "14:00" }),
      task({ id: 3, time: "09:00" }),
    ]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual([3, 2, 1]);
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
