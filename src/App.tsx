import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "./store";
import { todayISO } from "./lib/tasks";
import type { AppConfig, ConfigError } from "./types";
import TabBar from "./components/TabBar";
import SearchPalette from "./components/SearchPalette";
import VaultPicker from "./components/VaultPicker";
import Dashboard from "./sections/Dashboard";
import Upcoming from "./sections/Upcoming";
import Calendar from "./sections/Calendar";
import Journal from "./sections/Journal";
import KnowledgeBase from "./sections/KnowledgeBase";
import Settings from "./sections/Settings";

export default function App() {
  const { loaded, vaultPath, section, error, init, clearError } =
    useAppStore();
  const configErrors = useAppStore((s) => s.configErrors);

  useEffect(() => {
    void init();
    void import("./lib/updater").then((m) => m.checkForUpdates());
  }, [init]);

  // keep the native titlebar (traffic lights / min-max-close strip) in
  // sync with the app theme
  const theme = useAppStore((s) => s.config?.theme);
  useEffect(() => {
    if (!theme) return;
    getCurrentWindow()
      .setTheme(theme === "light" ? "light" : "dark")
      .catch(() => {
        // theme permission missing or platform unsupported; cosmetic only
      });
  }, [theme]);

  // config watcher: backend reloaded YAML and re-ran the engine
  useEffect(() => {
    const unlisten = listen<ConfigError[]>("vault-updated", async (event) => {
      const store = useAppStore.getState();
      store.setConfigErrors(event.payload);
      useAppStore.setState((s) => ({ vaultVersion: s.vaultVersion + 1 }));
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

  // in-app reminders for timed tasks while the window is open (req. from
  // Key features; no background service in phase 1)
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const notifiedRef = useRef(new Set<number>());
  const notifiedDayRef = useRef(todayISO());
  const toastTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timer = setInterval(() => {
      const { tasks, today } = useAppStore.getState();
      // a task carried over to the next day may keep its id and time;
      // it deserves a fresh notification on the new day
      if (notifiedDayRef.current !== today) {
        notifiedDayRef.current = today;
        notifiedRef.current.clear();
      }
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
        now.getMinutes(),
      ).padStart(2, "0")}`;
      for (const task of tasks) {
        if (
          task.scheduled_date === today &&
          task.time !== null &&
          task.time <= hhmm &&
          task.status === "todo" &&
          !notifiedRef.current.has(task.id)
        ) {
          notifiedRef.current.add(task.id);
          const toast = { id: task.id, text: `${task.time} ${task.title}` };
          setToasts((prev) => [...prev, toast]);
          const timers = toastTimersRef.current;
          const dismiss = setTimeout(() => {
            timers.delete(dismiss);
            setToasts((prev) => prev.filter((t) => t.id !== toast.id));
          }, 15_000);
          timers.add(dismiss);
        }
      }
    }, 30_000);
    const timers = toastTimersRef.current;
    return () => {
      clearInterval(timer);
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  // undo toast for deleted tasks, auto-dismissed after 6s
  const undo = useAppStore((s) => s.undo);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => {
      const store = useAppStore.getState();
      if (store.undo === undo) store.dismissUndo();
    }, 6000);
    return () => clearTimeout(timer);
  }, [undo]);

  // Ctrl/Cmd+K opens the task search palette from anywhere
  const searchOpen = useAppStore((s) => s.searchOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const store = useAppStore.getState();
        if (store.vaultPath) store.setSearchOpen(!store.searchOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
          <div className="flex items-center justify-between border-b border-danger/40 bg-danger/15 px-4 py-2 text-sm text-danger">
            <span>{error}</span>
            <button className="font-semibold" onClick={clearError}>
              Dismiss
            </button>
          </div>
        )}
        {configErrors.length > 0 && (
          <div className="border-b border-warn/40 bg-warn/15 px-4 py-2 text-sm text-warn">
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
        {section === "calendar" && <Calendar />}
        {section === "journal" && <Journal />}
        {section === "kb" && <KnowledgeBase />}
        {section === "settings" && <Settings />}
      </main>
      {searchOpen && (
        <SearchPalette
          onClose={() => useAppStore.getState().setSearchOpen(false)}
        />
      )}
      {undo && (
        <div className="fixed bottom-4 left-20 z-20 flex items-center gap-3 rounded-lg border border-line bg-surface-alt px-4 py-2 text-sm shadow-lg">
          <span className="max-w-[320px] truncate">{undo.message}</span>
          <button
            className="font-semibold text-accent hover:underline"
            onClick={() => void useAppStore.getState().undoDelete()}
          >
            Undo
          </button>
          <button
            className="text-content-muted hover:text-content"
            onClick={() => useAppStore.getState().dismissUndo()}
          >
            ×
          </button>
        </div>
      )}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-20 flex flex-col gap-2">
          {toasts.map((toast) => (
            <button
              key={toast.id}
              className="rounded-lg border border-line bg-surface-alt px-4 py-2 text-left text-sm shadow-lg"
              onClick={() =>
                setToasts((prev) => prev.filter((t) => t.id !== toast.id))
              }
            >
              <span className="font-medium text-accent">Task due</span>
              <br />
              {toast.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
