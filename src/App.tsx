import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "./store";
import { todayISO } from "./lib/tasks";
import type { AppConfig, ConfigError } from "./types";
import TabBar from "./components/TabBar";
import VaultPicker from "./components/VaultPicker";
import Dashboard from "./sections/Dashboard";
import Upcoming from "./sections/Upcoming";
import Journal from "./sections/Journal";
import KnowledgeBase from "./sections/KnowledgeBase";
import Settings from "./sections/Settings";

export default function App() {
  const { loaded, vaultPath, section, error, init, clearError } =
    useAppStore();
  const configErrors = useAppStore((s) => s.configErrors);

  useEffect(() => {
    void init();
  }, [init]);

  // config watcher: backend reloaded YAML and re-ran the engine
  useEffect(() => {
    const unlisten = listen<ConfigError[]>("vault-updated", async (event) => {
      const store = useAppStore.getState();
      store.setConfigErrors(event.payload);
      try {
        const config = await invoke<AppConfig>("config_get");
        useAppStore.setState({ config });
      } catch {
        // vault temporarily unavailable; keep the current config
      }
      await store.refresh();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // day rollover while the app stays open: re-run the engine at midnight
  useEffect(() => {
    const timer = setInterval(() => {
      const store = useAppStore.getState();
      if (store.vaultPath && todayISO() !== store.today) {
        void store.runEngine().then(() => store.refresh());
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-content-muted">
        Loading...
      </div>
    );
  }

  if (!vaultPath) {
    return <VaultPicker />;
  }

  return (
    <div className="flex h-full">
      <TabBar />
      <main className="min-w-0 flex-1 overflow-auto">
        {error && (
          <div className="flex items-center justify-between bg-red-600/90 px-4 py-2 text-sm text-white">
            <span>{error}</span>
            <button className="font-semibold" onClick={clearError}>
              Dismiss
            </button>
          </div>
        )}
        {configErrors.length > 0 && (
          <div className="border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
            {configErrors.map((err, i) => (
              <div key={i}>
                {err.file}
                {err.line !== null ? ` line ${err.line}` : ""}: {err.message}
              </div>
            ))}
          </div>
        )}
        {section === "dashboard" && <Dashboard />}
        {section === "upcoming" && <Upcoming />}
        {section === "journal" && <Journal />}
        {section === "kb" && <KnowledgeBase />}
        {section === "settings" && <Settings />}
      </main>
    </div>
  );
}
