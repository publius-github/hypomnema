import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
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
  init: () => Promise<void>;
  selectVault: (path: string) => Promise<void>;
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  setSection: (section: Section) => void;
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

  init: async () => {
    try {
      const vaultPath = await invoke<string | null>("vault_status");
      let config: AppConfig | null = null;
      if (vaultPath) {
        config = await invoke<AppConfig>("config_get");
      }
      applyTheme(config);
      set({ loaded: true, vaultPath, config });
      if (vaultPath) await get().refresh();
    } catch (e) {
      set({ loaded: true, error: String(e) });
    }
  },

  selectVault: async (path: string) => {
    try {
      const config = await invoke<AppConfig>("vault_select", { path });
      applyTheme(config);
      set({ vaultPath: path, config, error: null });
      await get().refresh();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  refresh: async () => {
    const config = get().config;
    if (!config) return;
    const today = todayISO();
    try {
      const [lists, tasks] = await Promise.all([
        invoke<List[]>("lists_all"),
        invoke<Task[]>("tasks_snapshot", {
          startDate: today,
          endDate: addDaysISO(today, config.grid_columns),
        }),
      ]);
      set({ today, lists, tasks });
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
    const previous = get().tasks;
    set({
      tasks: previous.map((t) => {
        if (t.id !== id) return t;
        const merged = { ...t };
        for (const [key, value] of Object.entries(patch)) {
          (merged as unknown as Record<string, unknown>)[key] = value;
        }
        return merged;
      }),
    });
    try {
      await invoke<Task>("task_update", { id, patch });
      await get().refresh();
    } catch (e) {
      set({ tasks: previous, error: String(e) });
    }
  },

  deleteTask: async (id) => {
    try {
      await invoke("task_delete", { id });
      await get().refresh();
    } catch (e) {
      set({ error: String(e) });
    }
  },

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
  clearError: () => set({ error: null }),
}));
