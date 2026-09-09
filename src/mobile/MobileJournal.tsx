import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { addDaysISO } from "../lib/tasks";

const SAVE_DEBOUNCE_MS = 1200;

/**
 * The journal, one day at a time.
 *
 * A plain textarea rather than the desktop's CodeMirror: on a phone the
 * system keyboard and its autocorrect are the editor, and a code editor
 * fights both. `journal_open` seeds a missing entry from the template,
 * same as on the desktop - so opening today is how a day gets started.
 */
export default function MobileJournal() {
  const today = useAppStore((s) => s.today);
  const setError = useAppStore((s) => s.setError);
  const [date, setDate] = useState(today);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ date: string; content: string } | null>(null);

  const persist = useCallback(
    async (entryDate: string, text: string) => {
      try {
        await invoke("journal_save", { date: entryDate, content: text });
        setSaved(true);
      } catch (e) {
        setError(String(e));
      }
    },
    [setError],
  );

  // Switching days (or leaving) must not drop an edit still sitting in
  // the debounce, and the save has to land before the next read or the
  // user types over text that was already stale when it arrived.
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const outstanding = pending.current;
    if (outstanding) {
      pending.current = null;
      await persist(outstanding.date, outstanding.content);
    }
  }, [persist]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await flush();
      try {
        const entry = await invoke<{ date: string; content: string }>(
          "journal_open",
          { date },
        );
        if (cancelled) return;
        setContent(entry.content);
        setSaved(true);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // flush is stable enough; re-running on date is the point
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Leaving the tab or backgrounding the app must not lose the tail of
  // what was typed - on a phone that is the common way to leave.
  useEffect(() => () => void flush(), [flush]);

  const edit = (text: string) => {
    setContent(text);
    setSaved(false);
    pending.current = { date, content: text };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-line px-2 py-3">
        <button
          onClick={() => setDate((d) => addDaysISO(d, -1))}
          aria-label="Previous day"
          className="px-3 py-1 text-lg text-content-muted"
        >
          ‹
        </button>
        <div className="min-w-0 text-center">
          <div className="truncate font-semibold">
            {date === today ? "Today" : date}
          </div>
          <div className="text-xs text-content-muted">
            {saved ? "Saved" : "Saving..."}
          </div>
        </div>
        <button
          onClick={() => setDate((d) => addDaysISO(d, 1))}
          aria-label="Next day"
          className="px-3 py-1 text-lg text-content-muted"
        >
          ›
        </button>
      </header>
      <textarea
        value={content}
        onChange={(e) => edit(e.target.value)}
        spellCheck
        className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 leading-relaxed outline-none"
        placeholder="Write about today..."
      />
    </div>
  );
}
