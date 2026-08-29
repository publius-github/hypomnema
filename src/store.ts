import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  ConfigError,
  DashboardContext,
  EngineOutcome,
  KbNode,
  List,
  NewTask,
  Section,
  Task,
  TaskPatch,
} from "./types";
import { addDaysISO, compareTasks, todayISO } from "./lib/tasks";

interface AppState {
  loaded: boolean;
  vaultPath: string | null;
  config: AppConfig | null;
  section: Section;
  error: string | null;
  today: string;
  lists: List[];
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
  setSection: (section: Section) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  /// ids of tasks just marked done/postponed via the checkbox; they stay
  /// in the active block until the hold expires (done_hold_seconds)
  statusHold: number[];
  holdStatus: (id: number) => void;
  /// last soft-deleted task, restorable until the toast expires
  undo: { message: string; taskId: number } | null;
  undoDelete: () => Promise<void>;
  dismissUndo: () => void;
  setError: (message: string) => void;
  clearError: () => void;
  refresh: () => Promise<void>;
  createTask: (task: NewTask) => Promise<void>;
  updateTask: (id: number, patch: TaskPatch) => Promise<void>;
  /// drag-to-reorder inside a list column; dropping onto a task of a
  /// different list moves the task there instead
  reorderTask: (activeId: number, overId: number) => Promise<void>;
  deleteTask: (id: number) => Promise<void>;
  createList: (name: string) => Promise<void>;
  renameList: (id: number, name: string) => Promise<void>;
  archiveList: (id: number) => Promise<void>;
}

function applyTheme(config: AppConfig | null) {
  document.documentElement.classList.toggle(
    "dark",
    config?.theme !== "light",
  );
  // fonts are config-driven: the UI font overrides the stylesheet
  // default, the editor font feeds CodeMirror through a CSS variable
  const ui = config?.ui_font.trim() ?? "";
  document.body.style.fontFamily = ui
    ? `"${ui}", system-ui, -apple-system, "Segoe UI", sans-serif`
    : "";
  const editor = config?.editor_font.trim() || "Consolas";
  document.documentElement.style.setProperty(
    "--editor-font",
    `"${editor}", ui-monospace, SFMono-Regular, Consolas, monospace`,
  );
}

export const useAppStore = create<AppState>((set, get) => ({
  loaded: false,
  vaultPath: null,
  config: null,
  section: "dashboard",
  error: null,
  today: todayISO(),
  lists: [],
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

  refresh: async () => {
    const config = get().config;
    if (!config) return;
    const today = todayISO();
    const start = addDaysISO(today, get().gridOffset);
    const columns = config.dashboard_today_only ? 1 : config.grid_columns;
    const dates = Array.from({ length: columns }, (_, i) =>
      addDaysISO(start, i),
    );
    try {
      const [lists, tasks, dashboard] = await Promise.all([
        invoke<List[]>("lists_all"),
        invoke<Task[]>("tasks_snapshot", {
          startDate: start,
          endDate: addDaysISO(start, columns),
        }),
        invoke<DashboardContext>("dashboard_context", { dates }),
      ]);
      set({ today, lists, tasks, dashboard });
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
          (t.scheduled_date === null || t.priority),
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
    try {
      const title = get().tasks.find((t) => t.id === id)?.title;
      await invoke("task_delete", { id });
      // soft delete cascades to subtasks on the backend; mirror that
      set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== id && t.parent_task_id !== id),
        undo: {
          message: title ? `Deleted "${title}"` : "Task deleted",
          taskId: id,
        },
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  undoDelete: async () => {
    const undo = get().undo;
    if (!undo) return;
    set({ undo: null });
    try {
      await invoke("task_restore", { id: undo.taskId });
      await get().refresh();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  dismissUndo: () => set({ undo: null }),

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

  archiveList: async (id) => {
    try {
      await invoke("list_archive", { id });
      set((s) => ({ lists: s.lists.filter((l) => l.id !== id) }));
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
    } catch (e) {
      applyTheme(current);
      set({ config: current, error: String(e) });
    }
  },

  setSection: (section) => set({ section }),
  gridOffset: 0,
  setGridOffset: (gridOffset) => {
    set({ gridOffset });
    void get().refresh();
  },
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
  statusHold: [],
  holdStatus: (id) => {
    const seconds = get().config?.done_hold_seconds ?? 0;
    if (seconds <= 0) return;
    set((s) => ({
      statusHold: s.statusHold.includes(id)
        ? s.statusHold
        : [...s.statusHold, id],
    }));
    setTimeout(() => {
      set((s) => ({ statusHold: s.statusHold.filter((h) => h !== id) }));
    }, seconds * 1000);
  },
  undo: null,
  setError: (message) => set({ error: message }),
  clearError: () => set({ error: null }),
}));
