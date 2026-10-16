import { useEffect, useRef, useState } from "react";
import { invoke } from "./lib/ipc";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "./store";
import { todayISO } from "./lib/tasks";
import type { ConfigError, Section } from "./types";
import TabBar from "./components/TabBar";
import SearchPalette from "./components/SearchPalette";
import DueToasts from "./components/DueToasts";
import VaultPicker from "./components/VaultPicker";
import MobileApp from "./mobile/MobileApp";
import Dashboard from "./sections/Dashboard";
import Lists from "./sections/Lists";
import Days from "./sections/Days";
import Upcoming from "./sections/Upcoming";
import Reminders from "./sections/Reminders";
import Calendar from "./sections/Calendar";
import History from "./sections/History";
import Review from "./sections/Review";
import Journal from "./sections/Journal";
import KnowledgeBase from "./sections/KnowledgeBase";
import Settings from "./sections/Settings";
import { warn } from "./lib/log";

export default function App() {
  const loaded = useAppStore((s) => s.loaded);
  // null until the backend answers. The desktop layout below is built for
  // a wide window and a mouse; rendering it on a phone even briefly is
  // worse than waiting a beat for the answer.
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const vaultPath = useAppStore((s) => s.vaultPath);
  const section = useAppStore((s) => s.section);
  const error = useAppStore((s) => s.error);
  const init = useAppStore((s) => s.init);
  const clearError = useAppStore((s) => s.clearError);
  const configErrors = useAppStore((s) => s.configErrors);

  useEffect(() => {
    void init();
    void invoke("platform_is_mobile")
      .then(setIsMobile)
      .catch(() => setIsMobile(/Android/i.test(navigator.userAgent)));
  }, [init]);

  // The safe-area floors reach CSS through the document root rather than
  // a wrapper's inline style: the screens that need them include
  // position:fixed overlays and the pre-vault setup screen, none of
  // which share an ancestor to inherit from.
  const safeTop = useAppStore((s) => s.config?.mobile_safe_area_top ?? 0);
  const safeBottom = useAppStore((s) => s.config?.mobile_safe_area_bottom ?? 0);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--safe-top", `${safeTop}px`);
    root.style.setProperty("--safe-bottom", `${safeBottom}px`);
  }, [safeTop, safeBottom]);

  // Desktop-only: there is no updater on Android. Once
  // per start, after the config is known, unless switched off in Settings.
  const updateCheck = useAppStore((s) => s.config?.update_check);
  const updateChecked = useRef(false);
  useEffect(() => {
    if (isMobile !== false || updateCheck === undefined || updateChecked.current) return;
    updateChecked.current = true;
    if (updateCheck) {
      void import("./lib/updater").then((m) => m.checkForUpdates());
    }
  }, [isMobile, updateCheck]);

  // keep the native titlebar (traffic lights / min-max-close strip) in
  // sync with the app theme
  const theme = useAppStore((s) => s.config?.theme);
  useEffect(() => {
    if (!theme) return;
    getCurrentWindow()
      .setTheme(theme === "light" ? "light" : "dark")
      .catch((e) => {
        // theme permission missing or platform unsupported; cosmetic only
        warn("window theme", e);
      });
  }, [theme]);

  // config watcher: backend reloaded YAML and re-ran the engine
  useEffect(() => {
    const unlisten = listen<ConfigError[]>("vault-updated", async (event) => {
      const store = useAppStore.getState();
      store.setConfigErrors(event.payload);
      // the bump reaches the sections that read YAML-backed views; the
      // task views refetch on the `tasks` reference refresh() replaces
      useAppStore.setState((s) => ({ vaultVersion: s.vaultVersion + 1 }));
      try {
        const config = await invoke("config_get");
        useAppStore.setState({ config });
      } catch (e) {
        // vault temporarily unavailable; keep the current config
        warn("config reload", e);
      }
      await store.refresh();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // global shortcuts: Ctrl/Cmd+K search palette, Ctrl/Cmd+1..6 sections
  const searchOpen = useAppStore((s) => s.searchOpen);
  const undoEntry = useAppStore((s) => s.undoEntry);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const store = useAppStore.getState();
      // Ctrl+1..9 follow the rail: the configured tab order minus the
      // hidden sections, settings last
      const hidden = store.config?.section_hidden ?? [];
      const sections = [
        ...(
          store.config?.section_order ?? [
            "dashboard",
            "lists",
            "days",
            "upcoming",
            "reminders",
            "calendar",
            "history",
            "review",
            "journal",
            "kb",
          ]
        ).filter((id) => !hidden.includes(id)),
        "settings",
      ] as Section[];
      // physical key, so the shortcut survives non-Latin layouts
      if (e.code === "KeyK") {
        e.preventDefault();
        if (store.vaultPath) store.setSearchOpen(!store.searchOpen);
      } else if (e.key >= "1" && e.key <= "9") {
        // not while typing: editors and inputs own Ctrl+digits there
        const el = e.target as HTMLElement | null;
        if (
          el &&
          (el.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
        ) {
          return;
        }
        e.preventDefault();
        const target = sections[Number(e.key) - 1];
        if (store.vaultPath && target) store.setSection(target);
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
        void store.runEngine();
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!loaded || isMobile === null) {
    return (
      <div className="flex h-full items-center justify-center text-content-muted">
        Loading...
      </div>
    );
  }

  if (!vaultPath) {
    return <VaultPicker />;
  }

  if (isMobile) {
    return <MobileApp />;
  }

  return (
    <div className="flex h-full">
      <TabBar />
      {/* the scrollbar's lane is always reserved: a page that grows a
          scrollbar (a long list zone on the dashboard) must not push its
          header controls left, or they stop lining up with the same
          controls on the Days and Lists pages */}
      <main className="min-w-0 flex-1 overflow-auto scrollbar-gutter-stable">
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
            {configErrors.map((err, i) => {
              const editable = err.file !== "app.yml";
              const text = `${err.file}${
                err.line !== null ? ` line ${err.line}` : ""
              }: ${err.message}`;
              return editable ? (
                <button
                  key={i}
                  className="block w-full truncate text-left hover:underline"
                  title="Open the file in Notes"
                  onClick={() =>
                    useAppStore.getState().openConfigFile(err.file)
                  }
                >
                  {text}
                </button>
              ) : (
                <div key={i}>{text}</div>
              );
            })}
          </div>
        )}
        {section === "dashboard" && <Dashboard />}
        {section === "lists" && <Lists />}
        {section === "days" && <Days />}
        {section === "upcoming" && <Upcoming />}
        {section === "reminders" && <Reminders />}
        {section === "calendar" && <Calendar />}
        {section === "history" && <History />}
        {section === "review" && <Review />}
        {section === "journal" && <Journal />}
        {section === "kb" && <KnowledgeBase />}
        {section === "settings" && <Settings />}
      </main>
      {searchOpen && (
        <SearchPalette
          onClose={() => useAppStore.getState().setSearchOpen(false)}
        />
      )}
      {undoEntry && (
        <div className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-surface-alt px-4 py-2 text-sm shadow-lg">
          <span className="max-w-md truncate">{undoEntry.label}</span>
          <button
            className="font-semibold text-accent"
            onClick={() => void useAppStore.getState().undoLast()}
          >
            Undo
          </button>
          <button
            className="text-content-muted"
            title="Dismiss"
            aria-label="Dismiss"
            onClick={() => useAppStore.getState().dismissUndo()}
          >
            ✕
          </button>
        </div>
      )}
      <DueToasts />
    </div>
  );
}
