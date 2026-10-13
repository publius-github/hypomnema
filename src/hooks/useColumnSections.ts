import { useShallow } from "zustand/react/shallow";

import {
  categoryBlockIndex,
  categoryOf,
  compareTasks,
  cadenceColor,
  groupByCadence,
  LIST_GAP_STRIPES,
  sortClosedAlpha,
  splitDone,
} from "../lib/tasks";
import { useAppStore } from "../store";
import type { AppConfig, List, Task } from "../types";

/** One task in a column, with the separators the List view draws. */
export interface ColumnRow {
  task: Task;
  /** a category stripe before this row (a new {Category} block) */
  gapBefore: boolean;
  /** the row opens a block, so it also gets the hairline above */
  lineAbove: boolean;
  /** ordinal of its category block, for the alternating chip palette */
  blockIndex: number;
  /**
   * The category this row's block is named by, on the block's first
   * row (`category_headers` draws it once over the block); null on the
   * other rows, in sections without category blocks, and on rows with
   * no category.
   */
  header: string | null;
  /** the row's category label, whether or not its block shows a header */
  label: string | null;
  /** the section groups its rows into category blocks */
  blocks: boolean;
}

/** One section of a column: a plate over its rows. */
export interface ColumnSection {
  /** cadence key, "priority", "rest", "postponed", "waiting", "done" */
  key: string;
  /** plate label; null = the section has no plate (a list's backlog) */
  label: string | null;
  /** plate tint; null = the neutral plate */
  color: string | null;
  /** the priority plate wears the warn tone instead of a color */
  tone: "warn" | null;
  /** separator stripes before the section, 0 = none */
  stripes: number;
  rows: ColumnRow[];
}

type SectionInput = Omit<ColumnSection, "rows"> & {
  tasks: Task[];
  /** category stripes inside the section (a day's closed ones have none) */
  gaps?: boolean;
};

/**
 * Rows of every section in render order, with category stripes, block
 * hairlines and the column-wide block counter worked out - the one
 * place that decides where a List view break goes.
 */
function layout(
  inputs: SectionInput[],
  labelOf: (task: Task) => string | null,
): ColumnSection[] {
  const shown = inputs.filter((s) => s.tasks.length > 0);
  const blockIndex = categoryBlockIndex(
    shown.flatMap((s) => s.tasks),
    labelOf,
  );
  return shown.map(({ tasks, gaps = true, ...section }) => ({
    ...section,
    rows: tasks.map((task, i) => {
      const label = labelOf(task);
      const opens = i === 0 || label !== labelOf(tasks[i - 1]);
      const gapBefore = gaps && i > 0 && opens;
      return {
        task,
        gapBefore,
        lineAbove: i === 0 || gapBefore,
        blockIndex: blockIndex.get(task.id) ?? 0,
        header: gaps && opens ? label : null,
        label,
        blocks: gaps,
      };
    }),
  }));
}

/** Postponed / Done, waiting / Done under `done_display: separate`. */
function closedSections(
  split: { postponed: Task[]; waiting: Task[]; done: Task[] },
  config: AppConfig | null,
  labelOf: (task: Task) => string | null,
  gaps: boolean,
): SectionInput[] {
  const order = (items: Task[]) =>
    (config?.closed_sections_sort_alpha ?? true)
      ? sortClosedAlpha(items, labelOf)
      : items;
  const closed = (key: string, label: string, items: Task[], color = "") => ({
    key,
    label,
    color: color || null,
    tone: null,
    stripes: LIST_GAP_STRIPES.closed,
    tasks: order(items),
    gaps,
  });
  return [
    closed("postponed", "Postponed", split.postponed, config?.postponed_plate_color),
    closed("waiting", "Done, waiting", split.waiting, config?.waiting_plate_color),
    closed("done", "Done", split.done, config?.done_plate_color),
  ];
}

/**
 * A day column's sections, shared by the desktop `DayColumn` and the
 * phone's `MobileDay`: the configured cadence sections over the day's
 * top-level tasks (future days without the dailies under
 * `daily_tasks_today_only`), then the closed sections, with the List
 * view's stripes - none before the first section, two between
 * sections, three before Postponed / Done, waiting / Done.
 *
 * A task's "category" is its {X} title prefix, else its list's name
 * (engine-generated tasks carry their category as a list).
 */
export function useDaySections(date: string): ColumnSection[] {
  const config = useAppStore((s) => s.config);
  const today = useAppStore((s) => s.today);
  const lists = useAppStore((s) => s.lists);
  const hold = useAppStore(useShallow((s) => s.statusHold));
  const hideDailies = (config?.daily_tasks_today_only ?? false) && date > today;
  // shallow-compared filtered selection: targeted store merges keep
  // unchanged task identities, so a change on another day does not
  // re-render this one
  const dayTasks = useAppStore(
    useShallow((s) =>
      s.tasks.filter(
        (t) =>
          t.scheduled_date === date &&
          t.parent_task_id === null &&
          !(hideDailies && t.cadence === "daily"),
      ),
    ),
  );
  const labelOf = (t: Task) =>
    categoryOf(t.title) ??
    (t.list_id !== null
      ? (lists.find((l) => l.id === t.list_id)?.name ?? null)
      : null);
  const split = splitDone(
    dayTasks,
    config?.done_display ?? "inline",
    new Map(hold.map((h) => [h.id, h.status])),
  );
  const groups = groupByCadence(
    split.active,
    config?.cadence_group_order,
    labelOf,
  );
  return layout(
    [
      ...groups.map((g, i) => ({
        key: g.key,
        label: g.label,
        color: cadenceColor(config, g.key),
        tone: null,
        stripes: i > 0 ? LIST_GAP_STRIPES.section : 0,
        tasks: g.tasks,
      })),
      // the day column's closed blocks run without category stripes
      ...closedSections(split, config, labelOf, false),
    ],
    labelOf,
  );
}

/**
 * A list column's sections, shared by the desktop `ListColumn` and the
 * phone's `MobileLists`: Priority, the backlog (no plate; the one
 * section a drag or Up/Down reorders), then the closed sections. The
 * backlog holds unscheduled tasks, priority pins and manual tasks
 * whatever their date; a generated task that already has its day lives
 * on that day. `list_tasks_sort_alpha` sorts by title, timed tasks first.
 * No list (a phone screen with none open) gives no sections.
 */
export function useListSections(list: List | null): ColumnSection[] {
  const config = useAppStore((s) => s.config);
  const hold = useAppStore(useShallow((s) => s.statusHold));
  const listTasks = useAppStore(
    useShallow((s) =>
      s.tasks.filter(
        (t) =>
          list !== null &&
          t.list_id === list.id &&
          (t.scheduled_date === null || t.priority || t.origin === "manual") &&
          t.parent_task_id === null,
      ),
    ),
  );
  const alpha = config?.list_tasks_sort_alpha ?? false;
  const sorted = [...listTasks].sort((a, b) => {
    if (alpha) {
      if ((a.time === null) !== (b.time === null))
        return a.time === null ? 1 : -1;
      const byTitle = a.title.localeCompare(b.title, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (byTitle !== 0) return byTitle;
    }
    return compareTasks(a, b);
  });
  const split = splitDone(
    sorted,
    config?.done_display ?? "inline",
    new Map(hold.map((h) => [h.id, h.status])),
  );
  // inside a list the list is the column itself: only the {X} prefix
  // makes a category
  const labelOf = (t: Task) => categoryOf(t.title);
  const prioritized = split.active.filter((t) => t.priority);
  return layout(
    [
      {
        key: "priority",
        label: "Priority",
        color: null,
        tone: "warn",
        stripes: 0,
        tasks: prioritized,
      },
      {
        key: "rest",
        label: null,
        color: null,
        tone: null,
        stripes: prioritized.length > 0 ? LIST_GAP_STRIPES.section : 0,
        tasks: split.active.filter((t) => !t.priority),
      },
      ...closedSections(split, config, labelOf, true),
    ],
    labelOf,
  );
}
