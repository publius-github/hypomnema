import type { StateCreator } from "zustand";
import { errorMessage, invoke } from "../lib/ipc";
import type { AppConfig, ConfigError, EngineOutcome } from "../types";
import type { AppState } from "../store";
import { applyTheme } from "./theme";

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

/** The open vault, its settings and the engine: what every view reads
 *  first, and the error banner they all report to. */
export interface VaultSlice {
  loaded: boolean;
  vaultPath: string | null;
  config: AppConfig | null;
  /// factory defaults, fetched once - drives "is this at its default?"
  /// (settings group disclosure, the per-group Reset)
  defaults: AppConfig | null;
  error: string | null;
  configErrors: ConfigError[];
  /// bumped after every engine pass (manual or watcher-triggered) so
  /// sections holding YAML-derived local state know to reload
  vaultVersion: number;
  init: () => Promise<void>;
  runEngine: () => Promise<EngineOutcome | null>;
  setConfigErrors: (errors: ConfigError[]) => void;
  selectVault: (path: string) => Promise<void>;
  /// opens a new vault in an empty folder, filled with example content
  createExampleVault: (path: string) => Promise<void>;
  updateConfig: (patch: Partial<AppConfig>) => Promise<void>;
  /// opens a web/mail link from a note or description in the system
  /// browser (the webview would navigate the app itself)
  openExternal: (url: string) => Promise<void>;
  setError: (message: string) => void;
  clearError: () => void;
}

export const createVaultSlice: StateCreator<AppState, [], [], VaultSlice> = (
  set,
  get,
) => ({
  loaded: false,
  vaultPath: null,
  config: null,
  defaults: null,
  error: null,
  configErrors: [],
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

  createExampleVault: async (path: string) => {
    try {
      const config = await invoke("vault_create_example", { path });
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

  setError: (message) => set({ error: message }),
  clearError: () => set({ error: null }),
});
