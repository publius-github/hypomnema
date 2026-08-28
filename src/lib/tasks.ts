import type { List, ScheduleBlock, Task, TaskStatus } from "../types";

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
  if (dateISO === today) return "Today";
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export interface DayGroup {
  listId: number | null;
  listName: string;
  tasks: Task[];
}

/**
 * Tasks of one day column, grouped by list and sorted by
 * (time, list order, sort_order) per requirements 16-17.
 */
export function groupDayTasks(tasks: Task[], lists: List[]): DayGroup[] {
  const listOrder = new Map<number, { order: number; name: string }>(
    lists.map((l) => [l.id, { order: l.sort_order, name: l.name }]),
  );
  const groups = new Map<number | null, Task[]>();
  for (const task of tasks) {
    const key = task.list_id !== null && listOrder.has(task.list_id) ? task.list_id : null;
    const bucket = groups.get(key);
    if (bucket) bucket.push(task);
    else groups.set(key, [task]);
  }
  const result: DayGroup[] = Array.from(groups.entries()).map(
    ([listId, groupTasks]) => ({
      listId,
      listName: listId === null ? "" : listOrder.get(listId)!.name,
      tasks: groupTasks.sort(compareTasks),
    }),
  );
  return result.sort((a, b) => {
    if (a.listId === null) return -1;
    if (b.listId === null) return 1;
    return listOrder.get(a.listId)!.order - listOrder.get(b.listId)!.order;
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
  const current =
    sorted.find((b) => b.from <= hhmm && hhmm < b.to) ?? null;
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
