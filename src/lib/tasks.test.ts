import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  currentAndNextBlock,
  dayLabel,
  gridDates,
  groupByCadence,
  nextStatus,
  splitDone,
  weekdayShort,
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
    origin_date: null,
    priority: false,
    ...overrides,
  };
}

describe("nextStatus", () => {
  it("cycles todo -> done -> postponed -> todo", () => {
    expect(nextStatus("todo")).toBe("done");
    expect(nextStatus("done")).toBe("postponed");
    expect(nextStatus("postponed")).toBe("todo");
  });
});

describe("dayLabel", () => {
  it("writes the full weekday, the ISO date and a Today marker", () => {
    expect(dayLabel("2026-08-29", "2026-08-29")).toBe(
      "Saturday 2026-08-29 [Today]",
    );
    expect(dayLabel("2026-08-31", "2026-08-29")).toBe("Monday 2026-08-31");
    expect(weekdayShort("2026-08-29")).toBe("Sat");
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
  it("orders groups exact, once, daily, weekly, monthly, yearly", () => {
    const groups = groupByCadence([
      task({ id: 1, cadence: "yearly" }),
      task({ id: 2, cadence: "daily" }),
      task({ id: 3, cadence: null }),
      task({ id: 4, cadence: "weekly" }),
      task({ id: 5, cadence: "monthly" }),
      task({ id: 6, origin: "scheduled" }),
      task({ id: 7, origin: "birthday", cadence: "yearly" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Exact date",
      null,
      "Daily",
      "Weekly",
      "Monthly",
      "Yearly",
    ]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual([6, 7]);
    expect(groups.slice(1).map((g) => g.tasks[0].id)).toEqual([3, 2, 4, 5, 1]);
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
    task({ id: 3, status: "postponed" }),
  ];

  it("keeps everything inline by default", () => {
    const { active, postponed, done } = splitDone(tasks, "inline");
    expect(active).toHaveLength(3);
    expect(postponed).toHaveLength(0);
    expect(done).toHaveLength(0);
  });

  it("separates postponed and done in separate mode", () => {
    const { active, postponed, done } = splitDone(tasks, "separate");
    expect(active.map((t) => t.id)).toEqual([2]);
    expect(postponed.map((t) => t.id)).toEqual([3]);
    expect(done.map((t) => t.id)).toEqual([1]);
  });

  it("keeps just-clicked tasks in the active block while held", () => {
    const { active, postponed, done } = splitDone(
      tasks,
      "separate",
      new Set([1, 3]),
    );
    expect(active.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(postponed).toHaveLength(0);
    expect(done).toHaveLength(0);
  });
});
