import type { CSSProperties } from "react";
import type {
  AppConfig,
  List,
  ListGroup,
  ScheduleBlock,
  Task,
  TaskPatch,
  TaskStatus,
} from "../types";

/**
 * Cut a wrapping text off after `lines` lines. The webview is Chromium,
 * so the -webkit-line-clamp box is the reliable way to do it with a
 * runtime line count (Tailwind's line-clamp-N needs a literal).
 */
export function clampStyle(lines: number): CSSProperties {
  return {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: lines,
    overflow: "hidden",
  };
}

// The checkbox cycles todo -> done -> postponed -> waiting -> todo:
// postponing is one extra click on a just-completed task (the done-hold
// delay keeps it in place long enough to make that click), "done but
// waiting" one more. Dropped is never a click away - it is chosen on
// purpose (the card's drop button, the dialog, the review) - and a click
// on a dropped task brings it back to todo. Checklist lists have no
// postponed state - their checkbox is a plain todo <-> done toggle (a
// leftover row in any other state cycles back to todo).
export const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = {
  todo: "done",
  done: "postponed",
  postponed: "waiting",
  waiting: "todo",
  dropped: "todo",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To Do",
  done: "Done",
  postponed: "Postponed",
  waiting: "Done, waiting",
  dropped: "Not done, dropped",
};

/** One-character status marks for the text rows (Calendar, Review). */
export const STATUS_GLYPH: Record<TaskStatus, string> = {
  todo: "○",
  done: "✓",
  postponed: "→",
  waiting: "◷",
  dropped: "✕",
};

/** Text color of those marks; done takes --color-done inline. */
export const STATUS_GLYPH_CLASS: Record<TaskStatus, string> = {
  todo: "text-content-muted",
  done: "",
  postponed: "text-warn",
  waiting: "text-waiting",
  dropped: "text-content-muted",
};

/**
 * Done or dropped: nothing is left to act on. Closed tasks are struck
 * through and never overdue; only done counts as a completion.
 */
export function isClosed(status: TaskStatus): boolean {
  return status === "done" || status === "dropped";
}

export function nextStatus(status: TaskStatus, checklist = false): TaskStatus {
  if (checklist) return status === "todo" ? "done" : "todo";
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

/**
 * Where a Review "next week" push lands: Monday of the week after the
 * reviewed one - deterministic regardless of the weekday the review
 * happens on - but never in the past: reviewing an old week clamps to
 * tomorrow. ISO strings compare lexicographically.
 */
export function nextWeekTarget(weekStart: string, today: string): string {
  const nextMonday = addDaysISO(weekStart, 7);
  const tomorrow = addDaysISO(today, 1);
  return nextMonday >= tomorrow ? nextMonday : tomorrow;
}

/** Whole days from one ISO date to another (negative = past). */
export function daysBetweenISO(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
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
  labelOf: (task: Task) => string | null = (t) =>
    splitCategory(t.title).category,
): CadenceGroup[] {
  const buckets = new Map<string, Task[]>();
  for (const task of tasks) {
    const cadKey = cadenceKeyOf(task);
    const key =
      cadKey === "exact"
        ? "exact"
        : cadKey && CADENCE_KEYS.has(cadKey)
          ? cadKey
          : "general";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(task);
    else buckets.set(key, [task]);
  }
  const sequence = [
    ...order.filter(
      (key, i) => key in CADENCE_GROUP_LABELS && order.indexOf(key) === i,
    ),
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
  // a dated manual list task behaves like a one-off event (Exact date
  // section, exact-date color); priority pins stay General - their
  // today-date is an artifact of starring
  if (isListExact(task)) return "exact";
  return task.cadence;
}

/** A manual list task pinned to a concrete date (not via priority). */
export function isListExact(task: Task): boolean {
  return (
    task.origin === "manual" &&
    task.list_id !== null &&
    task.scheduled_date !== null &&
    !task.priority
  );
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
    case "general":
      // optional: empty keeps the neutral plate style
      return config.cadence_color_general || null;
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

/**
 * Hues a category chip can take when `category_colors_vary` is on.
 * Distinct enough that two of them side by side never read as the same
 * label.
 */
export const CATEGORY_PALETTE = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#ef4444",
  "#0ea5e9",
  "#84cc16",
  "#f97316",
  "#8b5cf6",
  "#06b6d4",
];

/** FNV-1a 32, the same stable hash the Rust side uses for rule keys. */
function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Chip color of a category label, per `category_color_mode`:
 *
 * - `single` - every category shares `category_color`.
 * - `varied` - a list of that name keeps the color it already wears on
 *   its column, anything else takes a palette hue hashed from its own
 *   text, so a category looks the same wherever it appears and does not
 *   change when its neighbours come and go.
 * - `alternate` - the two picked colors, chosen by `blockIndex`: the
 *   ordinal of the category block inside the column, counted straight
 *   through the cadence sections (see `categoryBlockIndex`). Without an
 *   index - a lone chip with no column around it - the first color.
 */
export function categoryChipColor(
  name: string,
  lists: List[],
  config: AppConfig | null,
  blockIndex?: number,
): string {
  const mode = config?.category_color_mode ?? "varied";
  if (mode === "alternate") {
    const a = config?.category_color_a || "#3b82f6";
    const b = config?.category_color_b || "#a855f7";
    return (blockIndex ?? 0) % 2 === 0 ? a : b;
  }
  if (mode !== "varied") return config?.category_color || "#3b82f6";
  const list = lists.find((l) => l.name === name && l.color);
  if (list?.color) return list.color;
  return CATEGORY_PALETTE[hash32(name) % CATEGORY_PALETTE.length];
}

/**
 * Ordinal of each task's category block within one column, counted over
 * the cards in the order they are rendered: the counter only advances
 * where the category changes, and it never restarts at a section
 * boundary - the point of the alternating palette is a stripe that runs
 * down the whole column, across Daily/Weekly/Monthly and on into
 * Postponed and Done. Uncategorized cards take the current index
 * without advancing it; they show no chip anyway.
 */
export function categoryBlockIndex(
  tasksInRenderOrder: Task[],
  labelOf: (task: Task) => string | null,
): Map<number, number> {
  const index = new Map<number, number>();
  let current = 0;
  let previous: string | null = null;
  for (const task of tasksInRenderOrder) {
    const label = labelOf(task);
    if (label !== null) {
      if (previous !== null && label !== previous) current += 1;
      previous = label;
    }
    index.set(task.id, current);
  }
  return index;
}

/** Inline style of a colored chip/plate: colored text on a soft tint. */
export function tintStyle(color: string): {
  color: string;
  backgroundColor: string;
} {
  return { color, backgroundColor: `${color}26` };
}

/** Monday of the ISO week holding the given date. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return addDaysISO(date, -((d.getDay() + 6) % 7));
}

/** Subtask order: optionally closed-last, then the regular comparator. */
export function sortSubtasks(subtasks: Task[], doneLast: boolean): Task[] {
  return [...subtasks].sort((a, b) => {
    if (doneLast && isClosed(a.status) !== isClosed(b.status)) {
      return isClosed(a.status) ? 1 : -1;
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
export function orderLists(
  lists: List[],
  tasks: Task[],
  alpha: boolean,
): List[] {
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

/** One slot of the list panel: an ungrouped list, or a whole group. */
export type PanelItem =
  | { type: "list"; list: List }
  | { type: "group"; group: ListGroup };

/**
 * The list panel's content: ungrouped lists (ordered like orderLists)
 * with the groups slotted in among the non-favorites - a grouped list
 * shows up only inside its group's drill-in, never as its own column.
 *
 * `flat` is the other half of `lists_group_display`: every list gets its
 * own column, grouped or not, and the groups themselves take no slot -
 * the membership shows as a chip on the column instead. Someone with two
 * lists per group wants to see all of them at once; someone with twenty
 * wants the folder. Same data, and only the panel changes.
 */
export function orderPanel(
  lists: List[],
  groups: ListGroup[],
  tasks: Task[],
  alpha: boolean,
  flat = false,
): PanelItem[] {
  if (flat) {
    return orderLists(lists, tasks, alpha).map((list) => ({
      type: "list" as const,
      list,
    }));
  }
  const items: PanelItem[] = [
    ...orderLists(
      lists.filter((l) => l.group_id === null),
      tasks,
      alpha,
    ).map((list) => ({ type: "list" as const, list })),
    ...groups.map((group) => ({ type: "group" as const, group })),
  ];
  // one comparator over both shapes, mirroring orderLists' ordering;
  // groups have no favorite flag, so they sort with the regular lists
  const key = (item: PanelItem) =>
    item.type === "list"
      ? {
          favorite: item.list.favorite,
          name: item.list.name,
          sort: item.list.sort_order,
          id: item.list.id,
        }
      : {
          favorite: false,
          name: item.group.name,
          sort: item.group.sort_order,
          id: item.group.id,
        };
  return items.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka.favorite !== kb.favorite) return ka.favorite ? -1 : 1;
    if (alpha) {
      const byName = ka.name.localeCompare(kb.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (byName !== 0) return byName;
    }
    return ka.sort - kb.sort || ka.id - kb.id;
  });
}

/** One row of the All-lists index beside a list panel. */
export type IndexRow =
  | { type: "list"; list: List; nested: boolean }
  | { type: "group"; group: ListGroup };

/**
 * The All-lists index. Folded mirrors the panel one-to-one - the same
 * slots in the same order, a group being one row.
 *
 * Flat spreads every list into its own column, which leaves the index
 * as the only place that still says which lists share a group: it keeps
 * the folded ordering and hangs each group's members, indented, under
 * the group's own row. The grid stays in flat order - the index is a
 * directory, and every row jumps to its target anyway.
 */
export function indexRows(
  lists: List[],
  groups: ListGroup[],
  tasks: Task[],
  alpha: boolean,
  flat: boolean,
): IndexRow[] {
  const rows: IndexRow[] = [];
  for (const item of orderPanel(lists, groups, tasks, alpha, false)) {
    if (item.type === "list") {
      rows.push({ type: "list", list: item.list, nested: false });
      continue;
    }
    rows.push(item);
    if (!flat) continue;
    for (const list of orderLists(
      lists.filter((l) => l.group_id === item.group.id),
      tasks,
      alpha,
    ))
      rows.push({ type: "list", list, nested: true });
  }
  return rows;
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
  waiting: Task[];
  /** done and dropped: the closed tasks share the bottom section */
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
  // a midnight-spanning block that is current still has from > now
  const next = sorted.find((b) => b !== current && b.from > hhmm) ?? null;
  if (!current && !next) return null;
  return { current, next };
}

/**
 * Done display mode (req. 15): inline keeps everything in place,
 * separate splits postponed, waiting and closed tasks into their own
 * bottom sections (Postponed, then Waiting, then Done - which also holds
 * the dropped tasks). Tasks in `hold` were just clicked: they stay
 * in the active block for a few seconds so a misclick can be fixed
 * before the card flies away.
 */
export function splitDone(
  tasks: Task[],
  mode: string,
  hold?: ReadonlyMap<number, TaskStatus>,
): DoneSplit {
  if (mode !== "separate") {
    return { active: tasks, postponed: [], waiting: [], done: [] };
  }
  // a held task keeps the section it was displayed in when its checkbox
  // was clicked, wherever the status cycle has moved it since
  const shown = (t: Task) => hold?.get(t.id) ?? t.status;
  return {
    active: tasks.filter((t) => shown(t) === "todo"),
    postponed: tasks.filter((t) => shown(t) === "postponed"),
    waiting: tasks.filter((t) => shown(t) === "waiting"),
    done: tasks.filter((t) => isClosed(shown(t))),
  };
}
