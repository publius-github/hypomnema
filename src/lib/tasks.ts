import type { AppConfig, List, ScheduleBlock, Task, TaskPatch, TaskStatus } from "../types";

// The checkbox cycles todo -> done -> postponed -> todo: postponing is
// one extra click on a just-completed task (the done-hold delay keeps
// it in place long enough to make that click).
export const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = {
  todo: "done",
  done: "postponed",
  postponed: "todo",
};

export function nextStatus(status: TaskStatus): TaskStatus {
  return STATUS_CYCLE[status];
}

export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return todayISO(date);
}

/** Rolling window: today + N-1 following days. */
export function gridDates(start: string, columns: number): string[] {
  return Array.from({ length: columns }, (_, i) => addDaysISO(start, i));
}

export function dayLabel(dateISO: string, today: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
  });
  return dateISO === today
    ? `${weekday} ${dateISO} [Today]`
    : `${weekday} ${dateISO}`;
}

/**
 * A "{Category} rest" title splits into a category label (rendered as a
 * chip) and the visible text. A category is pure text on the task - it
 * has nothing to do with lists.
 */
export function splitCategory(title: string): {
  category: string | null;
  text: string;
} {
  const match = title.match(/^\{([^}]+)\}\s*(.*)$/s);
  if (match && match[1].trim() && match[2].trim()) {
    return { category: match[1].trim(), text: match[2].trim() };
  }
  return { category: null, text: title };
}

/**
 * Starring a task pins it to today's column while it KEEPS showing in
 * its list (one row shown in two places, so closing it anywhere closes
 * it everywhere); un-starring a manual list task makes it list-only
 * again. Priority tasks are exempt from the overdue mark (engine side).
 */
export function priorityPatch(
  task: Task,
  on: boolean,
  today: string,
): TaskPatch {
  if (on) {
    return {
      priority: true,
      ...(task.scheduled_date ? {} : { scheduled_date: today }),
    };
  }
  return {
    priority: false,
    ...(task.list_id !== null && task.origin === "manual"
      ? { scheduled_date: null }
      : {}),
  };
}

/** Short weekday of an ISO date, for exact-date chips ("Sat"). */
export function weekdayShort(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
  });
}

export interface CadenceGroup {
  key: string;
  label: string;
  tasks: Task[];
}

export const CADENCE_GROUP_LABELS: Record<string, string> = {
  exact: "Exact date",
  general: "General",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export const DEFAULT_CADENCE_ORDER = Object.keys(CADENCE_GROUP_LABELS);

const CADENCE_KEYS = new Set(["daily", "weekly", "monthly", "yearly"]);

/**
 * Tasks of one day column, grouped into sections: exact-date items
 * (scheduled events and birthdays), General (manual one-offs, priority
 * pins, anything without a rule cadence), then the rule cadences. The
 * section order is user-configurable (Settings > Appearance) and
 * arrives via `order`; unknown names are dropped and missing ones are
 * appended in default position, mirroring the Rust-side sanitizing.
 */
export function groupByCadence(
  tasks: Task[],
  order: string[] = DEFAULT_CADENCE_ORDER,
  // "category" of a task for block grouping inside a section; defaults
  // to the {X} title prefix, the day columns also fall back to the
  // task's list name (engine-generated tasks carry theirs as a list)
  labelOf: (task: Task) => string | null = (t) => splitCategory(t.title).category,
): CadenceGroup[] {
  const buckets = new Map<string, Task[]>();
  for (const task of tasks) {
    // a dated manual list task behaves like a one-off event, so it
    // lands under Exact date; priority pins keep their General spot
    // (their today-date is an artifact of starring)
    const listExact =
      task.origin === "manual" &&
      task.list_id !== null &&
      task.scheduled_date !== null &&
      !task.priority;
    const key =
      task.origin === "scheduled" || task.origin === "birthday" || listExact
        ? "exact"
        : task.cadence && CADENCE_KEYS.has(task.cadence)
          ? task.cadence
          : "general";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(task);
    else buckets.set(key, [task]);
  }
  const sequence = [
    ...order.filter((key, i) => key in CADENCE_GROUP_LABELS && order.indexOf(key) === i),
    ...DEFAULT_CADENCE_ORDER.filter((key) => !order.includes(key)),
  ];
  return sequence
    .filter((key) => buckets.has(key))
    .map((key) => ({
      key,
      label: CADENCE_GROUP_LABELS[key],
      // category blocks stick together alphabetically (uncategorized
      // tasks first), so the day column can render a gap between them
      tasks: buckets.get(key)!.sort((a, b) => {
        const ca = labelOf(a) ?? "";
        const cb = labelOf(b) ?? "";
        if (ca !== cb) return ca < cb ? -1 : 1;
        return compareTasks(a, b);
      }),
    }));
}

/** Category label of a task title, for grouping ({X} prefix). */
export function categoryOf(title: string): string | null {
  return splitCategory(title).category;
}

/**
 * The cadence-palette key of a task: exact-date tasks (scheduled events
 * and birthdays) share one color, recurring tasks take their cadence.
 */
export function cadenceKeyOf(task: Task): string | null {
  if (task.origin === "scheduled" || task.origin === "birthday") {
    return "exact";
  }
  return task.cadence;
}

/**
 * The configured color for a cadence-palette key (card stripes, section
 * plates, exact-date chips); null when cadence coloring is off or the
 * key has no color ("general").
 */
export function cadenceColor(
  config: AppConfig | null,
  key: string | null,
): string | null {
  if (!config?.cadence_colors || !key) return null;
  switch (key) {
    case "exact":
      return config.cadence_color_exact;
    case "daily":
      return config.cadence_color_daily;
    case "weekly":
      return config.cadence_color_weekly;
    case "monthly":
      return config.cadence_color_monthly;
    case "yearly":
      return config.cadence_color_yearly;
    default:
      return null;
  }
}

/** Inline style of a colored chip/plate: colored text on a soft tint. */
export function tintStyle(color: string): {
  color: string;
  backgroundColor: string;
} {
  return { color, backgroundColor: `${color}26` };
}

/** Subtask order: optionally done-last, then the regular comparator. */
export function sortSubtasks(subtasks: Task[], doneLast: boolean): Task[] {
  return [...subtasks].sort((a, b) => {
    if (doneLast && (a.status === "done") !== (b.status === "done")) {
      return a.status === "done" ? 1 : -1;
    }
    return compareTasks(a, b);
  });
}

/**
 * The list columns a lists view shows, in display order: auto lists
 * ({List} prefixes, Birthdays) appear only when something unscheduled
 * (or priority-pinned) lives in them; favorites always lead; the rest
 * keep creation order, or go alphabetical when `alpha` is on.
 */
export function orderLists(lists: List[], tasks: Task[], alpha: boolean): List[] {
  return lists
    .filter(
      (list) =>
        !list.auto ||
        tasks.some(
          (t) =>
            t.list_id === list.id &&
            (!t.scheduled_date || t.priority) &&
            t.parent_task_id === null,
        ),
    )
    .sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      if (alpha) {
        const byName = a.name.localeCompare(b.name, undefined, {
          sensitivity: "base",
          numeric: true,
        });
        if (byName !== 0) return byName;
      }
      return a.sort_order - b.sort_order || a.id - b.id;
    });
}

export function compareTasks(a: Task, b: Task): number {
  if (a.time !== b.time) {
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    return a.time < b.time ? -1 : 1;
  }
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.id - b.id;
}

export interface DoneSplit {
  active: Task[];
  postponed: Task[];
  done: Task[];
}

export interface BlockFocus {
  current: ScheduleBlock | null;
  next: ScheduleBlock | null;
}

/** Day-schedule mode (req. 14): the block covering now, and the next one. */
export function currentAndNextBlock(
  blocks: ScheduleBlock[],
  now: Date,
): BlockFocus | null {
  if (blocks.length === 0) return null;
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
  const sorted = [...blocks].sort((a, b) => a.from.localeCompare(b.from));
  // a block with from > to spans midnight (e.g. 22:00-06:00)
  const covers = (b: ScheduleBlock) =>
    b.from <= b.to
      ? b.from <= hhmm && hhmm < b.to
      : hhmm >= b.from || hhmm < b.to;
  const current = sorted.find(covers) ?? null;
  const next = sorted.find((b) => b.from > hhmm) ?? null;
  if (!current && !next) return null;
  return { current, next };
}

/**
 * Done display mode (req. 15): inline keeps everything in place,
 * separate splits postponed and done into their own bottom sections
 * (Postponed above Done). Tasks in `hold` were just clicked: they stay
 * in the active block for a few seconds so a misclick can be fixed
 * before the card flies away.
 */
export function splitDone(
  tasks: Task[],
  mode: string,
  hold?: ReadonlySet<number>,
): DoneSplit {
  if (mode !== "separate") return { active: tasks, postponed: [], done: [] };
  const held = (t: Task) => hold?.has(t.id) ?? false;
  return {
    active: tasks.filter((t) => t.status === "todo" || held(t)),
    postponed: tasks.filter((t) => t.status === "postponed" && !held(t)),
    done: tasks.filter((t) => t.status === "done" && !held(t)),
  };
}
