import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  ConfigError,
  DashboardContext,
  DeletedTasks,
  EngineOutcome,
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
import { MD_TOKENS, resolveMdColors } from "./lib/mdPresets";
import { THEME_TOKEN_VARS, resolveThemeColors } from "./lib/themePresets";

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
  /// (settings group disclosure) and the Profiles tab
  defaults: AppConfig | null;
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
  createList: (name: string) => Promise<void>;
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

function applyTheme(config: AppConfig | null) {
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
  // chrome palette: the preset colors first ("default" = stylesheet),
  // then the individual overrides on top; empty value = fall through
  const preset = config ? resolveThemeColors(config) : null;
  for (const [token, name] of Object.entries(THEME_TOKEN_VARS)) {
    const presetHex = preset?.[token as keyof typeof THEME_TOKEN_VARS] ?? "";
    const override =
      {
        surface: config?.surface_color,
        surfaceAlt: config?.surface_alt_color,
        content: config?.content_color,
        contentMuted: config?.content_muted_color,
        accent: config?.accent_color,
        line: config?.line_color,
      }[token] ?? "";
    const triplet = hexToTriplet(override || presetHex || "");
    if (triplet) root.style.setProperty(name, triplet);
    else root.style.removeProperty(name);
  }
  // done checkboxes (cards, subtasks, calendar status marks)
  if (config?.done_color) root.style.setProperty("--color-done", config.done_color);
  else root.style.removeProperty("--color-done");
  // markdown color preset: named presets and custom colors override the
  // per-theme stylesheet defaults ("vscode" preset = no overrides)
  const md = config ? resolveMdColors(config) : null;
  for (const { key } of MD_TOKENS) {
    if (md) root.style.setProperty(`--md-${key}`, md[key]);
    else root.style.removeProperty(`--md-${key}`);
  }
}

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
  vaultVersion: 0,

  init: async () => {
    try {
      const vaultPath = await invoke<string | null>("vault_status");
      let config: AppConfig | null = null;
      if (vaultPath) {
        config = await invoke<AppConfig>("config_get");
      }
      applyTheme(config);
      set({ loaded: true, vaultPath, config });
      invoke<AppConfig>("config_default")
        .then((defaults) => set({ defaults }))
        .catch(() => undefined);
      if (vaultPath) {
        await get().runEngine();
        await get().refresh();
      }
    } catch (e) {
      set({ loaded: true, error: String(e) });
    }
  },

  selectVault: async (path: string) => {
    try {
      const config = await invoke<AppConfig>("vault_select", { path });
      applyTheme(config);
      set({ vaultPath: path, config, error: null });
      await get().runEngine();
      await get().refresh();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  runEngine: async () => {
    try {
      const outcome = await invoke<EngineOutcome>("engine_run");
      set((s) => ({
        configErrors: outcome.errors,
        vaultVersion: s.vaultVersion + 1,
      }));
      return outcome;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  setConfigErrors: (configErrors) => set({ configErrors }),

  openExternal: async (url: string) => {
    try {
      await invoke("open_external", { url });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  refresh: async () => {
    const config = get().config;
    if (!config) return;
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
        invoke<List[]>("lists_all"),
        invoke<ListGroup[]>("list_groups_all"),
        invoke<Task[]>("tasks_snapshot", {
          startDate: start,
          endDate: addDaysISO(start, columns),
        }),
        invoke<DashboardContext>("dashboard_context", { dates }),
      ]);
      set({ today, lists, groups, tasks, dashboard });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // Task mutations merge the backend's returned row into the snapshot
  // instead of refetching everything: a checkbox click used to cost
  // three IPC round-trips and a full array replacement. Engine-driven
  // changes (generation, carry-over) still arrive via refresh() after
  // sync/watcher events.
  createTask: async (task) => {
    try {
      const created = await invoke<Task>("task_create", { new: task });
      set((s) => ({ tasks: [...s.tasks, created] }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  updateTask: async (id, patch) => {
    const previousTask = get().tasks.find((t) => t.id === id);
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== id) return t;
        const merged = { ...t };
        for (const [key, value] of Object.entries(patch)) {
          (merged as unknown as Record<string, unknown>)[key] = value;
        }
        return merged;
      }),
    }));
    try {
      const updated = await invoke<Task>("task_update", { id, patch });
      set((s) => ({
        tasks: s.tasks.map((t) => (t.id === id ? updated : t)),
      }));
    } catch (e) {
      // roll back only this task: restoring a whole snapshot would
      // clobber concurrent optimistic updates of other tasks
      set((s) => ({
        tasks: previousTask
          ? s.tasks.map((t) => (t.id === id ? previousTask : t))
          : s.tasks,
        error: String(e),
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
      set({ error: String(e) });
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
      const deleted = await invoke<DeletedTasks>("task_delete", { id });
      set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== id && t.parent_task_id !== id),
      }));
      get().offerUndo({
        kind: "task",
        label: title ? `Deleted "${title}"` : "Task deleted",
        deleted,
      });
    } catch (e) {
      set({ error: String(e) });
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
        const restored = await invoke<Task[]>("task_restore", {
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
      set({ error: String(e) });
    }
  },

  createList: async (name) => {
    try {
      const created = await invoke<List>("list_create", { name, color: null });
      // new lists get the highest sort_order, so appending keeps order
      set((s) => ({ lists: [...s.lists, created] }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  renameList: async (id, name) => {
    try {
      await invoke("list_rename", { id, name });
      set((s) => ({
        lists: s.lists.map((l) => (l.id === id ? { ...l, name } : l)),
      }));
    } catch (e) {
      set({ error: String(e) });
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
        error: String(e),
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
        error: String(e),
      }));
    }
  },

  setListStatuses: async (id, done) => {
    try {
      await invoke("list_set_all_statuses", { id, done });
      await get().refresh();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createGroup: async (name) => {
    try {
      const created = await invoke<ListGroup>("list_group_create", { name });
      set((s) => ({ groups: [...s.groups, created] }));
    } catch (e) {
      set({ error: String(e) });
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
        error: String(e),
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
      set({ error: String(e) });
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
        error: String(e),
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
      set({ error: String(e) });
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
        await get().refresh();
      }
    } catch (e) {
      applyTheme(current);
      set({ config: current, error: String(e) });
    }
  },

  defaults: null,
  profiles: [],

  loadProfiles: async () => {
    try {
      set({ profiles: await invoke<string[]>("profiles_list") });
    } catch {
      set({ profiles: [] });
    }
  },

  saveProfile: async (name: string) => {
    try {
      const profiles = await invoke<string[]>("profile_save", { name });
      set({ profiles });
      return true;
    } catch (e) {
      set({ error: String(e) });
      return false;
    }
  },

  deleteProfile: async (name: string) => {
    try {
      const profiles = await invoke<string[]>("profile_delete", { name });
      set({ profiles });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  applyProfile: async (name: string) => {
    const current = get().config;
    try {
      const next = await invoke<AppConfig>("profile_apply", { name });
      applyTheme(next);
      set({ config: next });
      // same contract as updateConfig: a changed day-grid width needs an
      // engine pass and a refetch, not a wait for the settings watcher
      if (
        current &&
        WINDOW_KEYS.some((key) => current[key] !== next[key])
      ) {
        await get().runEngine();
        await get().refresh();
      }
    } catch (e) {
      set({ error: String(e) });
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
      const tree = await invoke<KbNode[]>("kb_tree");
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
      set({ error: String(e) });
    }
  },
  journalOpenDate: null,
  openJournalDate: (date) => set({ section: "journal", journalOpenDate: date }),
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  undoEntry: null,
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
  setError: (message) => set({ error: message }),
  clearError: () => set({ error: null }),
}));
