import type { ScheduleBlock, Task, TaskStatus } from "../types";

// The checkbox toggles between open and done only - a double-click on
// a done task must not accidentally postpone it. Postponing is its own
// action (the arrow button / the modal).
export const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = {
  todo: "done",
  done: "todo",
  postponed: "done",
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
  if (dateISO === today) return "Today";
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
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

/** Done display mode (req. 15): inline keeps done in place, separate splits. */
export function splitDone(tasks: Task[], mode: string): DoneSplit {
  if (mode !== "separate") return { active: tasks, done: [] };
  return {
    active: tasks.filter((t) => t.status !== "done"),
    done: tasks.filter((t) => t.status === "done"),
  };
}
