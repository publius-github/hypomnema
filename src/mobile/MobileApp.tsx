import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { todayISO } from "../lib/tasks";
import MobileDay from "./MobileDay";
import MobileLists from "./MobileLists";
import MobileJournal from "./MobileJournal";
import MobileNotes from "./MobileNotes";
import MobileSettings from "./MobileSettings";
import MobileTaskEditor from "./MobileTaskEditor";
import { EditingTaskContext } from "./editing";

export type MobileTab = "day" | "lists" | "journal" | "notes" | "settings";

const TABS: { id: MobileTab; label: string; glyph: string }[] = [
  { id: "day", label: "Day", glyph: "☀" },
  { id: "lists", label: "Lists", glyph: "≡" },
  { id: "journal", label: "Journal", glyph: "✎" },
  { id: "notes", label: "Notes", glyph: "❑" },
  { id: "settings", label: "Settings", glyph: "⚙" },
];

/**
 * The phone shell (docs/android/ROADMAP.md Phase 2).
 *
 * Deliberately not a responsive squeeze of the desktop layout. The desktop
 * app is a multi-column grid built for a mouse and a wide window; on a
 * phone that is a worse version of both. This is a single column with a
 * bottom tab bar, because the bottom is where a thumb reaches.
 */
export default function MobileApp() {
  const [tab, setTab] = useState<MobileTab>("day");
  const [editing, setEditing] = useState<number | null>(null);
  const error = useAppStore((s) => s.error);
  const clearError = useAppStore((s) => s.clearError);
  const tasks = useAppStore((s) => s.tasks);
  // The task can leave the snapshot while its editor is open - an engine
  // pass moves a date, or the task is deleted from inside the editor -
  // and an editor bound to a row that no longer exists would render an
  // empty screen with no way back.
  const editingTask = tasks.find((task) => task.id === editing) ?? null;

  // The engine runs when the app comes back to the foreground. A phone
  // spends most of its life asleep, so "on launch" alone would leave a
  // day's recurring tasks unmade until the app was killed and reopened.
  useEffect(() => {
    const runIfStale = () => {
      const store = useAppStore.getState();
      if (!store.vaultPath || document.visibilityState !== "visible") return;
      void store.runEngine().then(() => store.refresh());
    };
    runIfStale();
    document.addEventListener("visibilitychange", runIfStale);
    return () => document.removeEventListener("visibilitychange", runIfStale);
  }, []);

  // Automatic sync (ROADMAP.md Phase 3).
  //
  // The three moments that matter on a phone, and none of them is a
  // timer alone: coming back to the app (someone else may have written
  // to the vault since), leaving it (Android freezes a backgrounded app,
  // so anything done just before the screen locks would sit here until
  // the app is opened again), and a slow heartbeat for a session left
  // open on a desk. All three are one function, and a pass in flight
  // never starts a second one.
  const config = useAppStore((s) => s.config);
  const syncing = useRef(false);
  const syncAuto = config?.sync_auto ?? false;
  const syncOnLeave = config?.sync_on_leave ?? false;
  const syncEvery = config?.sync_interval_minutes ?? 15;
  useEffect(() => {
    if (!syncAuto) return;
    const pass = async () => {
      const store = useAppStore.getState();
      if (!store.vaultPath || syncing.current) return;
      syncing.current = true;
      try {
        await invoke("dropbox_sync");
        await store.refresh();
      } catch {
        // Unlinked, offline, mid-flight token refresh: an automatic
        // pass that cannot run is not an error worth a banner. The
        // Sync now button reports properly when someone asks for it.
      } finally {
        syncing.current = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void pass();
      else if (syncOnLeave) void pass();
    };
    void pass();
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void pass();
    }, syncEvery * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, [syncAuto, syncOnLeave, syncEvery]);

  // Crossing midnight with the app open should move "today" with it.
  const today = useAppStore((s) => s.today);
  useEffect(() => {
    const timer = setInterval(() => {
      const store = useAppStore.getState();
      if (store.vaultPath && todayISO() !== store.today) {
        void store.runEngine().then(() => store.refresh());
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [today]);

  return (
    <EditingTaskContext.Provider value={{ editing, setEditing }}>
      <div className="flex h-full flex-col">
        {error && (
          <div className="flex items-start justify-between gap-3 border-b border-danger/40 bg-danger/15 px-4 py-2 text-sm text-danger">
            <span className="min-w-0 break-words">{error}</span>
            <button className="shrink-0 font-semibold" onClick={clearError}>
              Dismiss
            </button>
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-auto">
          {tab === "day" && <MobileDay />}
          {tab === "lists" && <MobileLists />}
          {tab === "journal" && <MobileJournal />}
          {tab === "notes" && <MobileNotes />}
          {tab === "settings" && <MobileSettings />}
        </main>
        <nav className="flex shrink-0 border-t border-line bg-surface-alt">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setTab(entry.id)}
              // Tall enough to hit without aiming, and padded for the
              // gesture bar that sits under it on modern Android.
              className={`flex flex-1 flex-col items-center gap-0.5 px-1 pb-3 pt-2 text-xs ${
                tab === entry.id ? "text-accent" : "text-content-muted"
              }`}
            >
              <span className="text-lg leading-none">{entry.glyph}</span>
              {entry.label}
            </button>
          ))}
        </nav>
        {editingTask && (
          <MobileTaskEditor
            task={editingTask}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
    </EditingTaskContext.Provider>
  );
}
