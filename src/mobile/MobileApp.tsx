import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import { todayISO } from "../lib/tasks";
import MobileDay from "./MobileDay";
import MobileLists from "./MobileLists";
import MobileJournal from "./MobileJournal";
import MobileNotes from "./MobileNotes";
import MobileMore from "./MobileMore";
import MobileTaskEditor from "./MobileTaskEditor";
import MobileSearch from "./MobileSearch";
import DueToasts from "../components/DueToasts";
import { LockScreen } from "./MobileLock";
import { EditingTaskContext } from "./editing";
import { MobileNavContext } from "./nav";
import { useBackStep } from "./back";
import type { LockState } from "../types";

export type MobileTab = "day" | "lists" | "journal" | "notes" | "more";

const TABS: { id: MobileTab; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "lists", label: "Lists" },
  { id: "journal", label: "Journal" },
  { id: "notes", label: "Notes" },
  { id: "more", label: "More" },
];

// Drawn icons rather than text glyphs: a glyph's shape and weight are the
// system font's to decide, and ☀ or ❑ can render as an emoji, a hollow
// box or nothing at all depending on the device. Strokes in currentColor
// inherit the active/muted tint the same way the label does.
const ICON_PROPS = {
  viewBox: "0 0 24 24",
  width: 22,
  height: 22,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const TAB_ICONS: Record<MobileTab, ReactElement> = {
  day: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  ),
  lists: (
    <svg {...ICON_PROPS}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  ),
  journal: (
    <svg {...ICON_PROPS}>
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  ),
  notes: (
    <svg {...ICON_PROPS}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M16 13H8M16 17H8" />
    </svg>
  ),
  more: (
    <svg {...ICON_PROPS}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  ),
};

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
  const [searchOpen, setSearchOpen] = useState(false);
  // Null until asked. A device with no passphrase never sees this
  // screen, and one that has been unlocked this session does not either.
  const [lock, setLock] = useState<LockState | null>(null);
  const [lockSkipped, setLockSkipped] = useState(false);
  useEffect(() => {
    void invoke("app_lock_state")
      .then(setLock)
      .catch(() => setLock({ enabled: false, unlocked: true }));
  }, []);
  const error = useAppStore((s) => s.error);
  const clearError = useAppStore((s) => s.clearError);
  const undoEntry = useAppStore((s) => s.undoEntry);
  const tasks = useAppStore((s) => s.tasks);
  // The task can leave the snapshot while its editor is open - an engine
  // pass moves a date, or the task is deleted from inside the editor -
  // and an editor bound to a row that no longer exists would render an
  // empty screen with no way back.
  const editingTask = tasks.find((task) => task.id === editing) ?? null;

  // hardware back: a non-Day tab is one step away from home. Overlays
  // (search, the task editor) register their own steps on mount, and
  // screens with inner navigation register theirs, so the presses undo
  // steps in reverse order before this one returns to Day.
  useBackStep(tab !== "day", () => setTab("day"));

  // The engine runs when the app comes back to the foreground. A phone
  // spends most of its life asleep, so "on launch" alone would leave a
  // day's recurring tasks unmade until the app was killed and reopened.
  useEffect(() => {
    const runIfStale = () => {
      const store = useAppStore.getState();
      if (!store.vaultPath || document.visibilityState !== "visible") return;
      void store.runEngine();
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
    // A locked device has no reachable token, so an automatic pass
    // would be a request that cannot be made, once a minute.
    if (!syncAuto || (lock?.enabled && !lock.unlocked)) return;
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
    // Coming back onto a network is the fourth moment, and the one that
    // makes offline editing whole rather than merely tolerated: whatever
    // was written on the underground goes up as soon as there is signal,
    // without waiting for the heartbeat or for the app to be reopened.
    const onOnline = () => void pass();
    void pass();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void pass();
    }, syncEvery * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [syncAuto, syncOnLeave, syncEvery, lock]);

  // Crossing midnight with the app open should move "today" with it.
  const today = useAppStore((s) => s.today);
  useEffect(() => {
    const timer = setInterval(() => {
      const store = useAppStore.getState();
      if (store.vaultPath && todayISO() !== store.today) {
        void store.runEngine();
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [today]);

  if (lock?.enabled && !lock.unlocked && !lockSkipped) {
    return (
      <LockScreen onUnlocked={setLock} onSkip={() => setLockSkipped(true)} />
    );
  }

  return (
    <EditingTaskContext.Provider value={{ editing, setEditing }}>
      <MobileNavContext.Provider
        value={{ setTab, openSearch: () => setSearchOpen(true) }}
      >
      <div className="safe-area flex h-full flex-col">
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
          {tab === "more" && <MobileMore />}
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
              {TAB_ICONS[entry.id]}
              {entry.label}
            </button>
          ))}
        </nav>
        {/* above the tab bar, where a thumb can still reach it; delete
            on a phone is one tap with no confirm, so the way back has
            to be just as reachable */}
        {undoEntry && (
          <div className="absolute bottom-20 left-1/2 z-20 flex max-w-[92%] -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-surface-alt px-4 py-2 text-sm shadow-lg">
            <span className="min-w-0 truncate">{undoEntry.label}</span>
            <button
              className="shrink-0 font-semibold text-accent"
              onClick={() => void useAppStore.getState().undoLast()}
            >
              Undo
            </button>
            <button
              className="shrink-0 text-content-muted"
              aria-label="Dismiss"
              onClick={() => useAppStore.getState().dismissUndo()}
            >
              ✕
            </button>
          </div>
        )}
        <DueToasts position="bottom-24 right-3" />
        {searchOpen && <MobileSearch onClose={() => setSearchOpen(false)} />}
        {editingTask && (
          <MobileTaskEditor
            task={editingTask}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
      </MobileNavContext.Provider>
    </EditingTaskContext.Provider>
  );
}
