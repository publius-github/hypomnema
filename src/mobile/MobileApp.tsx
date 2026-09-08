import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { todayISO } from "../lib/tasks";
import MobileDay from "./MobileDay";
import MobileLists from "./MobileLists";
import MobileJournal from "./MobileJournal";
import MobileNotes from "./MobileNotes";
import MobileSettings from "./MobileSettings";

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
  const error = useAppStore((s) => s.error);
  const clearError = useAppStore((s) => s.clearError);

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
    </div>
  );
}
