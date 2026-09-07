import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  cadenceColor,
  categoryBlockIndex,
  categoryChipColor,
  cadenceKeyOf,
  currentAndNextBlock,
  dayLabel,
  gridDates,
  groupByCadence,
  nextStatus,
  nextWeekTarget,
  priorityPatch,
  sortSubtasks,
  splitCategory,
  splitDone,
  weekdayShort,
} from "./tasks";
import type { AppConfig, ScheduleBlock, Task, TaskStatus } from "../types";

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
    rule_key: null,
    period_key: null,
    dow_label: null,
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

describe("splitCategory", () => {
  it("splits a {Category} prefix into a chip label and the text", () => {
    expect(splitCategory("{Home} water plants")).toEqual({
      category: "Home",
      text: "water plants",
    });
    expect(splitCategory("no prefix")).toEqual({
      category: null,
      text: "no prefix",
    });
    expect(splitCategory("{} empty")).toEqual({
      category: null,
      text: "{} empty",
    });
  });
});

describe("priorityPatch", () => {
  it("starring an unscheduled task pins it to today", () => {
    expect(priorityPatch(task({}), true, "2026-08-29")).toEqual({
      priority: true,
      scheduled_date: "2026-08-29",
    });
    expect(
      priorityPatch(task({ scheduled_date: "2026-09-01" }), true, "2026-08-29"),
    ).toEqual({ priority: true });
  });

  it("un-starring a manual list task returns it to its list", () => {
    expect(
      priorityPatch(
        task({ list_id: 5, scheduled_date: "2026-08-29" }),
        false,
        "2026-08-29",
      ),
    ).toEqual({ priority: false, scheduled_date: null });
    expect(
      priorityPatch(
        task({ scheduled_date: "2026-08-29" }),
        false,
        "2026-08-29",
      ),
    ).toEqual({ priority: false });
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
  it("orders groups exact, general, daily, weekly, monthly, yearly", () => {
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
      "General",
      "Daily",
      "Weekly",
      "Monthly",
      "Yearly",
    ]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual([6, 7]);
    expect(groups.slice(1).map((g) => g.tasks[0].id)).toEqual([3, 2, 4, 5, 1]);
  });

  it("skips empty groups and puts manual/unknown-cadence tasks in General", () => {
    const groups = groupByCadence([
      task({ id: 1, cadence: "hourly" }),
      task({ id: 2, cadence: "daily" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["general", "daily"]);
  });

  it("respects a custom section order and ignores junk in it", () => {
    const groups = groupByCadence(
      [
        task({ id: 1, cadence: "daily" }),
        task({ id: 2 }),
        task({ id: 3, origin: "scheduled" }),
      ],
      ["daily", "typo", "general"],
    );
    expect(groups.map((g) => g.key)).toEqual(["daily", "general", "exact"]);
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

describe("cadence colors", () => {
  const config = {
    cadence_colors: true,
    cadence_color_daily: "#111111",
    cadence_color_weekly: "#222222",
    cadence_color_monthly: "#333333",
    cadence_color_yearly: "#444444",
    cadence_color_exact: "#555555",
  } as AppConfig;

  it("maps scheduled and birthday tasks to the exact key", () => {
    expect(cadenceKeyOf(task({ origin: "scheduled" }))).toBe("exact");
    expect(cadenceKeyOf(task({ origin: "birthday" }))).toBe("exact");
    expect(cadenceKeyOf(task({ origin: "recurring", cadence: "weekly" }))).toBe(
      "weekly",
    );
    expect(cadenceKeyOf(task({ origin: "manual" }))).toBe(null);
  });

  it("resolves configured colors and honors the master toggle", () => {
    expect(cadenceColor(config, "daily")).toBe("#111111");
    expect(cadenceColor(config, "exact")).toBe("#555555");
    expect(cadenceColor(config, "general")).toBe(null);
    expect(cadenceColor(null, "daily")).toBe(null);
    expect(
      cadenceColor({ ...config, cadence_colors: false }, "daily"),
    ).toBe(null);
  });
});

describe("sortSubtasks", () => {
  const open = task({ id: 1, sort_order: 2 });
  const done = task({ id: 2, sort_order: 1, status: "done" });

  it("sinks done subtasks when doneLast is on", () => {
    expect(sortSubtasks([done, open], true).map((t) => t.id)).toEqual([1, 2]);
  });

  it("keeps plain order otherwise", () => {
    expect(sortSubtasks([done, open], false).map((t) => t.id)).toEqual([2, 1]);
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

  it("keeps just-clicked tasks in the section they were shown in", () => {
    // 1 is done but was clicked while shown as todo; 3 is postponed but
    // was clicked while shown in the Done section
    const { active, postponed, done } = splitDone(
      tasks,
      "separate",
      new Map<number, TaskStatus>([
        [1, "todo"],
        [3, "done"],
      ]),
    );
    expect(active.map((t) => t.id)).toEqual([1, 2]);
    expect(postponed).toHaveLength(0);
    expect(done.map((t) => t.id)).toEqual([3]);
  });
});

describe("categoryBlockIndex", () => {
  const cat = (t: Task) => splitCategory(t.title).category;

  it("advances once per category block and never restarts", () => {
    // as a column renders them: Daily block, then Weekly, then Done -
    // the counter runs straight through the section boundaries
    const cards = [
      task({ id: 1, title: "{Work} a" }),
      task({ id: 2, title: "{Work} b" }),
      task({ id: 3, title: "{Home} c" }),
      task({ id: 4, title: "{Errands} d" }),
      task({ id: 5, title: "{Errands} e" }),
    ];
    const index = categoryBlockIndex(cards, cat);
    expect(cards.map((t) => index.get(t.id))).toEqual([0, 0, 1, 2, 2]);
  });

  it("keeps a category's run going across a section boundary", () => {
    const cards = [
      task({ id: 1, title: "{Work} daily" }),
      task({ id: 2, title: "{Work} weekly" }),
    ];
    const index = categoryBlockIndex(cards, cat);
    expect(index.get(2)).toBe(0);
  });

  it("lets uncategorized cards pass without advancing the turn", () => {
    const cards = [
      task({ id: 1, title: "{Work} a" }),
      task({ id: 2, title: "no category" }),
      task({ id: 3, title: "{Work} b" }),
    ];
    const index = categoryBlockIndex(cards, cat);
    expect(index.get(3)).toBe(0);
  });
});

describe("categoryChipColor", () => {
  const config = (overrides: Partial<AppConfig>) =>
    ({
      category_color: "#111111",
      category_color_mode: "varied",
      category_color_a: "#aaaaaa",
      category_color_b: "#bbbbbb",
      ...overrides,
    }) as AppConfig;

  it("paints everything in one color in single mode", () => {
    const c = config({ category_color_mode: "single" });
    expect(categoryChipColor("Work", [], c, 3)).toBe("#111111");
  });

  it("takes turns between the two colors by block index", () => {
    const c = config({ category_color_mode: "alternate" });
    expect(categoryChipColor("Work", [], c, 0)).toBe("#aaaaaa");
    expect(categoryChipColor("Home", [], c, 1)).toBe("#bbbbbb");
    expect(categoryChipColor("Errands", [], c, 2)).toBe("#aaaaaa");
    // the name is irrelevant here: only the position in the column is
    expect(categoryChipColor("Work", [], c, 1)).toBe("#bbbbbb");
  });

  it("gives a name the same hue every time in varied mode", () => {
    const c = config({});
    expect(categoryChipColor("Work", [], c, 0)).toBe(
      categoryChipColor("Work", [], c, 7),
    );
  });
});

describe("nextWeekTarget", () => {
  it("lands on Monday of the following week when reviewing the current week", () => {
    // week of Mon 2026-09-07, reviewed mid-week on Wed
    expect(nextWeekTarget("2026-09-07", "2026-09-09")).toBe("2026-09-14");
  });

  it("clamps to tomorrow when reviewing a past week", () => {
    // week of Mon 2026-08-10 reviewed a month later: its "next Monday"
    // is long gone, the push must not reschedule into the past
    expect(nextWeekTarget("2026-08-10", "2026-09-09")).toBe("2026-09-10");
  });

  it("crosses a year boundary", () => {
    expect(nextWeekTarget("2026-12-28", "2026-12-30")).toBe("2027-01-04");
  });
});
