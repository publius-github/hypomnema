import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  ConfigError,
  DashboardContext,
  EngineOutcome,
  List,
  NewTask,
  Section,
  Task,
  TaskPatch,
} from "./types";
import { addDaysISO, todayISO } from "./lib/tasks";

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
  init: () => Promise<void>;
  runEngine: () => Promise<EngineOutcome | null>;
  setConfigErrors: (errors: ConfigError[]) => void;
  selectVault: (path: string) => Promise<void>;
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  setSection: (section: Section) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  /// last soft-deleted task, restorable until the toast expires
  undo: { message: string; taskId: number } | null;
  undoDelete: () => Promise<void>;
  dismissUndo: () => void;
  clearError: () => void;
  refresh: () => Promise<void>;
  createTask: (task: NewTask) => Promise<void>;
  updateTask: (id: number, patch: TaskPatch) => Promise<void>;
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

  createTask: async (task) => {
    try {
      await invoke<Task>("task_create", { new: task });
      await get().refresh();
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
      await invoke<Task>("task_update", { id, patch });
      await get().refresh();
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

  deleteTask: async (id) => {
    try {
      const title = get().tasks.find((t) => t.id === id)?.title;
      await invoke("task_delete", { id });
      set({
        undo: {
          message: title ? `Deleted "${title}"` : "Task deleted",
          taskId: id,
        },
      });
      await get().refresh();
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
      await invoke<List>("list_create", { name, color: null });
      await get().refresh();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  renameList: async (id, name) => {
    try {
      await invoke("list_rename", { id, name });
      await get().refresh();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  archiveList: async (id) => {
    try {
      await invoke("list_archive", { id });
      await get().refresh();
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
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  undo: null,
  clearError: () => set({ error: null }),
}));
