import type { StateCreator } from "zustand";
import { errorMessage, invoke } from "../lib/ipc";
import type {
  DashboardContext,
  HabitRate,
  List,
  ListGroup,
  NewTask,
  Task,
  TaskPatch,
  TaskStatus,
} from "../types";
import type { AppState } from "../store";
import { addDaysISO, compareTasks, todayISO } from "../lib/tasks";
import { warn } from "../lib/log";

/** The task snapshot every task view renders - tasks, lists, groups,
 *  the dashboard context and habit rates - and the mutations that patch
 *  it in place instead of refetching. */
export interface TasksSlice {
  today: string;
  lists: List[];
  groups: ListGroup[];
  tasks: Task[];
  dashboard: DashboardContext | null;
  /// completion rate per recurring rule item, keyed by rule_key; items
  /// without enough settled instances are absent
  habitRates: Record<string, HabitRate>;
  loadHabitRates: () => Promise<void>;
  refresh: () => Promise<void>;
  createTask: (task: NewTask) => Promise<void>;
  updateTask: (id: number, patch: TaskPatch) => Promise<void>;
  /// drag-to-reorder inside a list column; dropping onto a task of a
  /// different list moves the task there instead
  reorderTask: (activeId: number, overId: number) => Promise<void>;
  deleteTask: (id: number) => Promise<void>;
  createList: (name: string, groupId?: number | null) => Promise<void>;
  renameList: (id: number, name: string) => Promise<void>;
  archiveList: (id: number) => Promise<void>;
  /// favorite lists sort ahead of the rest in the dashboard list zone
  toggleListFavorite: (id: number) => Promise<void>;
  /// list metadata from the list dialog; kind defaults to the current one
  updateListMeta: (
    id: number,
    meta: {
      color: string | null;
      description: string;
      kind?: List["kind"];
    },
  ) => Promise<void>;
  /// checklist bulk actions: check or uncheck every task of the list
  setListStatuses: (id: number, done: boolean) => Promise<void>;
  createGroup: (name: string) => Promise<void>;
  updateGroupMeta: (
    id: number,
    meta: { name: string; color: string | null },
  ) => Promise<void>;
  /// deleting a group releases its lists back to the panel
  deleteGroup: (id: number) => Promise<void>;
  /// folds a list into a group (null = back to the panel)
  setListGroup: (id: number, groupId: number | null) => Promise<void>;
  /// tasks whose status was just cycled via the checkbox, with the
  /// status they were displayed under at click time; they stay in that
  /// section until the hold expires (done_hold_seconds)
  statusHold: { id: number; status: TaskStatus }[];
  holdStatus: (id: number, shownStatus: TaskStatus) => void;
}

let refreshSeq = 0;
const taskUpdateSeq = new Map<number, number>();

export const createTasksSlice: StateCreator<AppState, [], [], TasksSlice> = (
  set,
  get,
) => ({
  today: todayISO(),
  lists: [],
  groups: [],
  tasks: [],
  dashboard: null,
  habitRates: {},
  loadHabitRates: async () => {
    try {
      const rates = await invoke("habit_rates");
      set({
        habitRates: Object.fromEntries(rates.map((r) => [r.rule_key, r])),
      });
    } catch (e) {
      // a missing rate only hides a chip; not worth an error banner
      warn("habit rates", e);
    }
  },

  refresh: async () => {
    const config = get().config;
    if (!config) return;
    // quick day jumps start overlapping snapshots; only the newest may land
    const seq = ++refreshSeq;
    const today = todayISO();
    const start = addDaysISO(today, get().gridOffset);
    // one snapshot feeds every task view, so the window spans the
    // widest of them: with only the dashboard's count here, widening the
    // Days page (or leaving its Today-only mode) showed empty columns
    // until the dashboard was widened too
    const columns = Math.max(
      config.dashboard_today_only ? 1 : config.grid_columns,
      config.days_today_only ? 1 : config.days_page_columns,
    );
    const dates = Array.from({ length: columns }, (_, i) =>
      addDaysISO(start, i),
    );
    try {
      const [lists, groups, tasks, dashboard] = await Promise.all([
        invoke("lists_all"),
        invoke("list_groups_all"),
        invoke("tasks_snapshot", {
          startDate: start,
          endDate: addDaysISO(start, columns),
        }),
        invoke("dashboard_context", { dates }),
      ]);
      if (seq !== refreshSeq) return;
      set({ today, lists, groups, tasks, dashboard });
      void get().loadHabitRates();
    } catch (e) {
      if (seq !== refreshSeq) return;
      set({ error: errorMessage(e) });
    }
  },

  // Task mutations merge the backend's returned row into the snapshot
  // instead of refetching everything: a checkbox click used to cost
  // three IPC round-trips and a full array replacement. Engine-driven
  // changes (generation, carry-over) still arrive via refresh() after
  // sync/watcher events.
  createTask: async (task) => {
    try {
      const created = await invoke("task_create", { new: task });
      set((s) => ({ tasks: [...s.tasks, created] }));
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  updateTask: async (id, patch) => {
    const previousTask = get().tasks.find((t) => t.id === id);
    // two quick patches on one task (a double status click) may answer
    // out of order; only the latest call's row or rollback may land
    const seq = (taskUpdateSeq.get(id) ?? 0) + 1;
    taskUpdateSeq.set(id, seq);
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== id) return t;
        return { ...t, ...patch };
      }),
    }));
    try {
      const updated = await invoke("task_update", { id, patch });
      if (taskUpdateSeq.get(id) !== seq) return;
      set((s) => ({
        tasks: s.tasks.map((t) => (t.id === id ? updated : t)),
      }));
      // a status change on a recurring instance moves its rule's rate
      if (updated.origin === "recurring" && "status" in patch) {
        void get().loadHabitRates();
      }
    } catch (e) {
      if (taskUpdateSeq.get(id) !== seq) {
        set({ error: errorMessage(e) });
        return;
      }
      // roll back only this task: restoring a whole snapshot would
      // clobber concurrent optimistic updates of other tasks
      set((s) => ({
        tasks: previousTask
          ? s.tasks.map((t) => (t.id === id ? previousTask : t))
          : s.tasks,
        error: errorMessage(e),
      }));
    }
  },

  reorderTask: async (activeId, overId) => {
    const state = get();
    const active = state.tasks.find((t) => t.id === activeId);
    const over = state.tasks.find((t) => t.id === overId);
    if (!active || !over || activeId === overId) return;
    if (over.list_id === null) return;
    if (active.list_id !== over.list_id) {
      // dropped onto a card of another list: move, order comes later
      await get().updateTask(activeId, {
        list_id: over.list_id,
        scheduled_date: null,
      });
      return;
    }
    // the same visible order the list column renders (times pin first)
    const column = state.tasks
      .filter(
        (t) =>
          t.list_id === active.list_id &&
          t.parent_task_id === null &&
          (t.scheduled_date === null || t.priority || t.origin === "manual"),
      )
      .sort(compareTasks);
    const ids = column.map((t) => t.id);
    const from = ids.indexOf(activeId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, activeId);
    const orderOf = new Map(ids.map((id, index) => [id, index]));
    set((s) => ({
      tasks: s.tasks.map((t) =>
        orderOf.has(t.id) ? { ...t, sort_order: orderOf.get(t.id)! } : t,
      ),
    }));
    try {
      await invoke("tasks_reorder", {
        listId: active.list_id,
        orderedIds: ids,
      });
    } catch (e) {
      set({ error: errorMessage(e) });
      await get().refresh();
    }
  },

  deleteTask: async (id) => {
    const title = get().tasks.find((t) => t.id === id)?.title;
    try {
      // hard delete, gone from the database; the backend cascades to
      // subtasks and drops the rule_runs ledger row, so a deleted
      // generated instance of a live rule regenerates on the next run.
      // The returned snapshot backs the Undo toast.
      const deleted = await invoke("task_delete", { id });
      set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== id && t.parent_task_id !== id),
      }));
      get().offerUndo({
        kind: "task",
        label: title ? `Deleted "${title}"` : "Task deleted",
        deleted,
      });
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  createList: async (name, groupId = null) => {
    try {
      const created = await invoke("list_create", { name, color: null });
      // a list born inside an open group view joins that group right away
      if (groupId !== null) {
        await invoke("list_set_group", { id: created.id, groupId });
        created.group_id = groupId;
      }
      // new lists get the highest sort_order, so appending keeps order
      set((s) => ({ lists: [...s.lists, created] }));
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  renameList: async (id, name) => {
    try {
      await invoke("list_rename", { id, name });
      set((s) => ({
        lists: s.lists.map((l) => (l.id === id ? { ...l, name } : l)),
      }));
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  toggleListFavorite: async (id) => {
    const list = get().lists.find((l) => l.id === id);
    if (!list) return;
    const favorite = !list.favorite;
    set((s) => ({
      lists: s.lists.map((l) => (l.id === id ? { ...l, favorite } : l)),
    }));
    try {
      await invoke("list_set_favorite", { id, favorite });
    } catch (e) {
      set((s) => ({
        lists: s.lists.map((l) =>
          l.id === id ? { ...l, favorite: !favorite } : l,
        ),
        error: errorMessage(e),
      }));
    }
  },

  updateListMeta: async (id, meta) => {
    const previous = get().lists.find((l) => l.id === id);
    if (!previous) return;
    const kind = meta.kind ?? previous.kind;
    set((s) => ({
      lists: s.lists.map((l) => (l.id === id ? { ...l, ...meta, kind } : l)),
    }));
    try {
      await invoke("list_set_meta", {
        id,
        color: meta.color,
        description: meta.description,
        kind,
      });
    } catch (e) {
      set((s) => ({
        lists: s.lists.map((l) => (l.id === id ? previous : l)),
        error: errorMessage(e),
      }));
    }
  },

  setListStatuses: async (id, done) => {
    try {
      await invoke("list_set_all_statuses", { id, done });
      await get().refresh();
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  createGroup: async (name) => {
    try {
      const created = await invoke("list_group_create", { name });
      set((s) => ({ groups: [...s.groups, created] }));
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  updateGroupMeta: async (id, meta) => {
    const previous = get().groups.find((g) => g.id === id);
    if (!previous) return;
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, ...meta } : g)),
    }));
    try {
      await invoke("list_group_set_meta", {
        id,
        name: meta.name,
        color: meta.color,
      });
    } catch (e) {
      set((s) => ({
        groups: s.groups.map((g) => (g.id === id ? previous : g)),
        error: errorMessage(e),
      }));
    }
  },

  deleteGroup: async (id) => {
    try {
      await invoke("list_group_delete", { id });
      set((s) => ({
        groups: s.groups.filter((g) => g.id !== id),
        lists: s.lists.map((l) =>
          l.group_id === id ? { ...l, group_id: null } : l,
        ),
      }));
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  setListGroup: async (id, groupId) => {
    const previous = get().lists.find((l) => l.id === id);
    if (!previous) return;
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === id ? { ...l, group_id: groupId } : l,
      ),
    }));
    try {
      await invoke("list_set_group", { id, groupId });
    } catch (e) {
      set((s) => ({
        lists: s.lists.map((l) => (l.id === id ? previous : l)),
        error: errorMessage(e),
      }));
    }
  },

  archiveList: async (id) => {
    const name = get().lists.find((l) => l.id === id)?.name;
    try {
      await invoke("list_archive", { id });
      set((s) => ({ lists: s.lists.filter((l) => l.id !== id) }));
      get().offerUndo({
        kind: "list",
        label: name ? `Archived "${name}"` : "List archived",
        listId: id,
      });
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  statusHold: [],
  holdStatus: (id, shownStatus) => {
    const seconds = get().config?.done_hold_seconds ?? 0;
    if (seconds <= 0) return;
    // repeat clicks during the hold keep the original placement, so the
    // card sits still through the whole status cycle
    set((s) => ({
      statusHold: s.statusHold.some((h) => h.id === id)
        ? s.statusHold
        : [...s.statusHold, { id, status: shownStatus }],
    }));
    setTimeout(() => {
      set((s) => ({ statusHold: s.statusHold.filter((h) => h.id !== id) }));
    }, seconds * 1000);
  },
});
