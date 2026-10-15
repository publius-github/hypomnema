import { create } from "zustand";
import { errorMessage, invoke } from "./lib/ipc";
import type {
  AppConfig,
  ConfigError,
  DashboardContext,
  DeletedTasks,
  EngineOutcome,
  HabitRate,
  KbNode,
  List,
  ListGroup,
  NewTask,
  Section,
  Task,
  TaskPatch,
  TaskStatus,
} from "./types";
import { addDaysISO, compareTasks, todayISO } from "./lib/tasks";
import { warn } from "./lib/log";
import { readable, setColorContext } from "./lib/color";

/// Settings the backend's habit rates are computed from.
const HABIT_RATE_KEYS: (keyof AppConfig)[] = [
  "habit_rate_threshold",
  "habit_rate_window",
  "habit_rate_min_instances",
];

/// Settings that change how many days the views show: both the snapshot
/// window and the engine horizon derive from them.
const WINDOW_KEYS: (keyof AppConfig)[] = [
  "grid_columns",
  "dashboard_today_only",
  "days_page_columns",
  "days_today_only",
];

interface AppState {
  loaded: boolean;
  vaultPath: string | null;
  config: AppConfig | null;
  section: Section;
  error: string | null;
  today: string;
  lists: List[];
  groups: ListGroup[];
  tasks: Task[];
  configErrors: ConfigError[];
  dashboard: DashboardContext | null;
  /// completion rate per recurring rule item, keyed by rule_key; items
  /// without enough settled instances are absent
  habitRates: Record<string, HabitRate>;
  loadHabitRates: () => Promise<void>;
  /// bumped after every engine pass (manual or watcher-triggered) so
  /// sections holding YAML-derived local state know to reload
  vaultVersion: number;
  /// grid window shift in days (negative = the past); the snapshot
  /// window follows it so past days are browsable in place
  gridOffset: number;
  setGridOffset: (offset: number) => void;
  /// first visible list in the paged list zone; lives here so the page
  /// survives section switches
  listOffset: number;
  setListOffset: (offset: number) => void;
  /// set to jump to Notes with a config file opened (error banner,
  /// focus line, Settings links)
  kbOpenConfig: string | null;
  openConfigFile: (file: string) => void;
  /// Notes tree/editor state survives section switches for the whole
  /// app session (folders start collapsed only on a fresh launch)
  kbExpanded: string[];
  setKbExpanded: (paths: string[]) => void;
  kbCurrent: { kind: "note" | "config"; path: string } | null;
  setKbCurrent: (doc: { kind: "note" | "config"; path: string } | null) => void;
  /// set to jump to Notes with a note opened (search palette)
  kbOpenNote: string | null;
  openKbNote: (path: string) => void;
  /// resolves a [[wiki link]] name to a note file and opens it
  openKbNoteByName: (name: string) => Promise<void>;
  /// set to jump to Journal with a date opened (search palette)
  journalOpenDate: string | null;
  openJournalDate: (date: string) => void;
  init: () => Promise<void>;
  runEngine: () => Promise<EngineOutcome | null>;
  setConfigErrors: (errors: ConfigError[]) => void;
  selectVault: (path: string) => Promise<void>;
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  /// factory defaults, fetched once - drives "is this at its default?"
  /// (settings group disclosure, the per-group Reset) and the Profiles
  /// tab
  defaults: AppConfig | null;
  /// config keys a settings profile covers (Rust PROFILE_KEYS, fetched
  /// once beside the defaults): the Settings page marks each group with
  /// what a profile does to it, and the list is authoritative on the
  /// Rust side, so the frontend never keeps a second copy of the scope
  profileKeys: (keyof AppConfig)[] | null;
  /// saved settings-profile names (the built-in Default is not listed)
  profiles: string[];
  loadProfiles: () => Promise<void>;
  saveProfile: (name: string) => Promise<boolean>;
  deleteProfile: (name: string) => Promise<void>;
  /// applies a saved profile (or "Default") over the live config
  applyProfile: (name: string) => Promise<void>;
  setSection: (section: Section) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  /// tasks whose status was just cycled via the checkbox, with the
  /// status they were displayed under at click time; they stay in that
  /// section until the hold expires (done_hold_seconds)
  statusHold: { id: number; status: TaskStatus }[];
  holdStatus: (id: number, shownStatus: TaskStatus) => void;
  /// section folds the user clicked this session, by section key
  /// (shared by every column); absent = the configured default
  sectionFolds: Record<string, boolean>;
  setSectionFold: (key: string, folded: boolean) => void;
  /// last destructive action, offered back through the Undo toast until
  /// the hold (undo_toast_seconds) expires or another delete replaces it
  undoEntry:
    | { kind: "task"; label: string; deleted: DeletedTasks }
    | { kind: "list"; label: string; listId: number }
    | null;
  offerUndo: (entry: NonNullable<AppState["undoEntry"]>) => void;
  undoLast: () => Promise<void>;
  dismissUndo: () => void;
  setError: (message: string) => void;
  clearError: () => void;
  refresh: () => Promise<void>;
  /// opens a web/mail link from a note or description in the system
  /// browser (the webview would navigate the app itself)
  openExternal: (url: string) => Promise<void>;
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
}

/** "#a1b2c3" -> "161 178 195" (the space-separated form the theme
 *  tokens use, so opacity modifiers keep working). */
function hexToTriplet(hex: string): string | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  return [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16))
    .join(" ");
}

/** One pending undo at a time: a new delete replaces the previous offer
 *  and restarts the dismiss timer. */
let undoTimer: ReturnType<typeof setTimeout> | null = null;

/** The chrome tokens Settings > Appearance can override, by config key. */
const THEME_OVERRIDES = [
  ["--color-surface", "surface_color"],
  ["--color-surface-alt", "surface_alt_color"],
  ["--color-content", "content_color"],
  ["--color-content-muted", "content_muted_color"],
  ["--color-accent", "accent_color"],
  ["--color-line", "line_color"],
] as const;

function applyTheme(config: AppConfig | null) {
  setColorContext(config);
  const root = document.documentElement;
  root.classList.toggle("dark", config?.theme !== "light");
  // fonts are config-driven: the UI font overrides the stylesheet
  // default, the editor font feeds CodeMirror through a CSS variable
  const ui = config?.ui_font.trim() ?? "";
  document.body.style.fontFamily = ui
    ? `"${ui}", system-ui, -apple-system, "Segoe UI", sans-serif`
    : "";
  const editor = config?.editor_font.trim() || "Consolas";
  root.style.setProperty(
    "--editor-font",
    `"${editor}", ui-monospace, SFMono-Regular, Consolas, monospace`,
  );
  // the editor size setting lives on the same scale as ui_font_size:
  // the app's main text is text-sm (87.5% of the base), so the editor
  // applies the same factor - equal settings, equal visible size
  root.style.setProperty(
    "--editor-font-size",
    `${(config?.editor_font_size ?? 16) * 0.875}px`,
  );
  // every text size derives from the root font size (rem-based tokens)
  const size = config?.ui_font_size ?? 16;
  root.style.fontSize = size === 16 ? "" : `${size}px`;
  // chrome palette: the stylesheet's VS Code Dark+/Light+ colors, with
  // the individual overrides on top; empty value = stylesheet
  for (const [name, key] of THEME_OVERRIDES) {
    const triplet = hexToTriplet(config?.[key] ?? "");
    if (triplet) root.style.setProperty(name, triplet);
    else root.style.removeProperty(name);
  }
  // done checkboxes (cards, subtasks, calendar status marks)
  if (config?.done_color) {
    root.style.setProperty("--color-done", readable(config.done_color, "mark"));
  } else root.style.removeProperty("--color-done");
  if (config?.waiting_color) {
    root.style.setProperty(
      "--color-waiting",
      readable(config.waiting_color, "mark"),
    );
  } else root.style.removeProperty("--color-waiting");
  if (config?.dropped_color) {
    root.style.setProperty(
      "--color-dropped",
      readable(config.dropped_color, "mark"),
    );
  } else root.style.removeProperty("--color-dropped");
}

let refreshSeq = 0;
const taskUpdateSeq = new Map<number, number>();

export const useAppStore = create<AppState>((set, get) => ({
  loaded: false,
  vaultPath: null,
  config: null,
  section: "dashboard",
  error: null,
  today: todayISO(),
  lists: [],
  groups: [],
  tasks: [],
  configErrors: [],
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
  vaultVersion: 0,

  init: async () => {
    try {
      const vaultPath = await invoke("vault_status");
      let config: AppConfig | null = null;
      if (vaultPath) {
        config = await invoke("config_get");
      }
      applyTheme(config);
      set({ loaded: true, vaultPath, config });
      invoke("config_default")
        .then((defaults) => set({ defaults }))
        .catch((e) => set({ error: errorMessage(e) }));
      invoke("profile_scope")
        .then((keys) =>
          set({ profileKeys: keys as (keyof AppConfig)[] }),
        )
        .catch((e) => set({ error: errorMessage(e) }));
      if (vaultPath) {
        await get().runEngine();
      }
    } catch (e) {
      set({ loaded: true, error: errorMessage(e) });
    }
  },

  selectVault: async (path: string) => {
    try {
      const config = await invoke("vault_select", { path });
      applyTheme(config);
      set({ vaultPath: path, config, error: null });
      await get().runEngine();
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  // A pass may generate, carry over or prune tasks, so the snapshot is
  // refetched here rather than by every caller: the Review and Calendar
  // sections refetch on the `tasks` reference alone, and that keeps one
  // engine run at exactly one refetch for them.
  runEngine: async () => {
    try {
      const outcome = await invoke("engine_run");
      set((s) => ({
        configErrors: outcome.errors,
        vaultVersion: s.vaultVersion + 1,
      }));
      await get().refresh();
      return outcome;
    } catch (e) {
      set({ error: errorMessage(e) });
      return null;
    }
  },

  setConfigErrors: (configErrors) => set({ configErrors }),

  openExternal: async (url: string) => {
    try {
      await invoke("open_external", { url });
    } catch (e) {
      set({ error: errorMessage(e) });
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

  offerUndo: (entry) => {
    const seconds = get().config?.undo_toast_seconds ?? 0;
    if (seconds <= 0) return;
    if (undoTimer) clearTimeout(undoTimer);
    set({ undoEntry: entry });
    undoTimer = setTimeout(() => {
      undoTimer = null;
      set({ undoEntry: null });
    }, seconds * 1000);
  },

  dismissUndo: () => {
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = null;
    set({ undoEntry: null });
  },

  undoLast: async () => {
    const entry = get().undoEntry;
    if (!entry) return;
    get().dismissUndo();
    try {
      if (entry.kind === "task") {
        const restored = await invoke("task_restore", {
          deleted: entry.deleted,
        });
        if (restored.length > 0) {
          set((s) => ({ tasks: [...s.tasks, ...restored] }));
        } else {
          // the engine regenerated the instance meanwhile; the card is
          // already back, just make sure we show the current state
          await get().refresh();
        }
      } else {
        await invoke("list_unarchive", { id: entry.listId });
        await get().refresh();
      }
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

  updateConfig: async (patch: Partial<AppConfig>) => {
    const current = get().config;
    if (!current) return;
    const next = { ...current, ...patch };
    applyTheme(next);
    set({ config: next });
    try {
      await invoke("config_set", { config: next });
      // widening a day grid moves both the snapshot window and the
      // engine's generation horizon, so the new columns need a pass and
      // a refetch instead of waiting for the settings watcher
      if (WINDOW_KEYS.some((key) => key in patch)) {
        await get().runEngine();
      } else if (HABIT_RATE_KEYS.some((key) => key in patch)) {
        await get().loadHabitRates();
      }
    } catch (e) {
      // the snapshot taken before this call may predate a concurrent
      // patch that did reach disk; what app.yml holds now is the truth
      const live = await invoke("config_get").catch(() => current);
      applyTheme(live);
      set({ config: live, error: errorMessage(e) });
    }
  },

  defaults: null,
  profileKeys: null,
  profiles: [],

  loadProfiles: async () => {
    try {
      set({ profiles: await invoke("profiles_list") });
    } catch {
      set({ profiles: [] });
    }
  },

  saveProfile: async (name: string) => {
    try {
      const profiles = await invoke("profile_save", { name });
      set({ profiles });
      return true;
    } catch (e) {
      set({ error: errorMessage(e) });
      return false;
    }
  },

  deleteProfile: async (name: string) => {
    try {
      const profiles = await invoke("profile_delete", { name });
      set({ profiles });
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  applyProfile: async (name: string) => {
    const current = get().config;
    try {
      const next = await invoke("profile_apply", { name });
      applyTheme(next);
      set({ config: next });
      // same contract as updateConfig: a changed day-grid width needs an
      // engine pass and a refetch, not a wait for the settings watcher
      if (
        current &&
        WINDOW_KEYS.some((key) => current[key] !== next[key])
      ) {
        await get().runEngine();
      }
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },

  setSection: (section) => set({ section }),
  gridOffset: 0,
  setGridOffset: (gridOffset) => {
    set({ gridOffset });
    void get().refresh();
  },
  listOffset: 0,
  setListOffset: (listOffset) => set({ listOffset }),
  kbOpenConfig: null,
  openConfigFile: (file) => set({ section: "kb", kbOpenConfig: file }),
  kbExpanded: [],
  setKbExpanded: (paths) => set({ kbExpanded: paths }),
  kbCurrent: null,
  setKbCurrent: (doc) => set({ kbCurrent: doc }),
  kbOpenNote: null,
  openKbNote: (path) =>
    set((s) => {
      // expand every parent folder so the tree shows the opened note
      const parts = path.split("/");
      const parents = parts
        .slice(0, -1)
        .map((_, i) => parts.slice(0, i + 1).join("/"));
      return {
        section: "kb",
        kbOpenNote: path,
        kbExpanded: [...new Set([...s.kbExpanded, ...parents])],
      };
    }),
  openKbNoteByName: async (name) => {
    const target = name.trim().toLowerCase();
    if (!target) return;
    try {
      const tree = await invoke("kb_tree");
      const find = (nodes: KbNode[]): string | null => {
        for (const node of nodes) {
          if (!node.is_dir) {
            const base = node.name.toLowerCase().replace(/\.md$/, "");
            if (base === target || node.name.toLowerCase() === target) {
              return node.path;
            }
          }
          const hit = find(node.children);
          if (hit) return hit;
        }
        return null;
      };
      const path = find(tree);
      if (path) {
        get().openKbNote(path);
      } else {
        set({ error: `Note "${name.trim()}" not found in the notes folder` });
      }
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },
  journalOpenDate: null,
  openJournalDate: (date) => set({ section: "journal", journalOpenDate: date }),
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  undoEntry: null,
  statusHold: [],
  sectionFolds: {},
  setSectionFold: (key, folded) =>
    set((s) => ({ sectionFolds: { ...s.sectionFolds, [key]: folded } })),
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
  setError: (message) => set({ error: message }),
  clearError: () => set({ error: null }),
}));
