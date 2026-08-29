import type { ScheduleBlock, Task, TaskPatch, TaskStatus } from "../types";

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
 * Starring a task pulls it into today's column (it keeps its list);
 * un-starring a manual list task sends it back to its list column.
 * Priority tasks are exempt from the overdue mark (engine side).
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
  /** null for the unlabeled one-off group at the top */
  label: string | null;
  tasks: Task[];
}

const CADENCE_GROUPS: { key: string; label: string | null }[] = [
  { key: "exact", label: "Exact date" },
  { key: "once", label: null },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
];

/**
 * Tasks of one day column, grouped by how often their rule fires.
 * Exact-date items (scheduled events and birthdays, however rarely
 * they recur) always sit on top, then manual one-offs, then daily,
 * weekly, monthly, yearly - the dailies are the block to clear and
 * the rare ones sit below, safe to leave for later.
 */
export function groupByCadence(tasks: Task[]): CadenceGroup[] {
  const buckets = new Map<string, Task[]>();
  for (const task of tasks) {
    const key =
      task.origin === "scheduled" || task.origin === "birthday"
        ? "exact"
        : task.cadence && CADENCE_GROUPS.some((g) => g.key === task.cadence)
          ? task.cadence
          : "once";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(task);
    else buckets.set(key, [task]);
  }
  return CADENCE_GROUPS.filter((g) => buckets.has(g.key)).map((g) => ({
    key: g.key,
    label: g.label,
    tasks: buckets.get(g.key)!.sort(compareTasks),
  }));
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
