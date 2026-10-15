import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import { addDaysISO } from "../lib/tasks";
import { useBackStep } from "./back";
import {
  serialSaves,
  settleSave,
  type SaveState,
} from "../sections/kb/util";
import SaveIndicator from "../components/SaveIndicator";

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
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const saved = saveState === "saved";
  const [browsing, setBrowsing] = useState(false);
  const [entries, setEntries] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ date: string; content: string; gen: number } | null>(
    null,
  );
  // bumped by every keystroke: a save only marks the entry saved when
  // nothing was typed after the text it carried
  const editGen = useRef(0);
  const queueSave = useRef(serialSaves()).current;
  const contentRef = useRef(content);
  contentRef.current = content;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  // the on-disk text the shown entry derives from: each save sends it,
  // so a sync pass that merged the desktop's edit in under the textarea
  // is merged with the typing instead of overwritten
  const baseRef = useRef<{ date: string; content: string } | null>(null);
  // hardware back leaves the entry browser before leaving the tab
  useBackStep(browsing, () => setBrowsing(false));

  // a search hit or the Review's "Weekly note" landed here with a date
  const openDate = useAppStore((s) => s.journalOpenDate);
  useEffect(() => {
    if (!openDate) return;
    setDate(openDate);
    setBrowsing(false);
    useAppStore.setState({ journalOpenDate: null });
  }, [openDate]);

  const persist = useCallback(
    (save: { date: string; content: string; gen: number }) =>
      queueSave(async () => {
        const { date: entryDate, content: text, gen } = save;
        try {
          const base = baseRef.current;
          const written = await invoke("journal_save", {
            date: entryDate,
            content: text,
            base: base?.date === entryDate ? base.content : null,
          });
          if (gen === editGen.current) setSaveState("saved");
          if (loadedDate.current === entryDate) {
            const settled = settleSave(text, written, contentRef.current);
            baseRef.current = { date: entryDate, content: settled.base };
            if (settled.content !== contentRef.current) {
              setContent(settled.content);
            }
          }
        } catch (e) {
          // kept for the next flush (day switch, leaving, Retry) unless
          // newer typing already replaced it
          if (!pending.current) pending.current = save;
          if (gen === editGen.current) setSaveState("failed");
          setError(errorMessage(e));
        }
      }),
    [queueSave, setError],
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
      await persist(outstanding);
    }
  }, [persist]);

  const loadedDate = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await flush();
      try {
        const entry = await invoke(
          "journal_open",
          { date },
        );
        if (cancelled) return;
        loadedDate.current = entry.date;
        baseRef.current = { date: entry.date, content: entry.content };
        setContent(entry.content);
        editGen.current++;
        setSaveState("saved");
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // flush is stable enough; re-running on date is the point
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // A sync pass changed the vault: an entry with no unsaved typing shows
  // what is on disk now; typing is kept, and its save merges the two.
  const vaultVersion = useAppStore((s) => s.vaultVersion);
  useEffect(() => {
    const shown = loadedDate.current;
    if (!shown || !savedRef.current || vaultVersion === 0) return;
    void (async () => {
      try {
        const entry = await invoke("journal_open", { date: shown });
        if (!savedRef.current || loadedDate.current !== entry.date) return;
        if (entry.content === contentRef.current) return;
        baseRef.current = { date: entry.date, content: entry.content };
        setContent(entry.content);
      } catch {
        // the vault is mid-reopen; the next update tries again
      }
    })();
  }, [vaultVersion]);

  // Leaving the tab or backgrounding the app must not lose the tail of
  // what was typed - on a phone that is the common way to leave.
  useEffect(() => () => void flush(), [flush]);

  const edit = (text: string) => {
    // the textarea still shows the previous day's text until the open
    // lands; a keystroke now would queue that text under the new date
    if (loadedDate.current !== date) return;
    setContent(text);
    setSaveState("dirty");
    pending.current = { date, content: text, gen: ++editGen.current };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  };

  if (browsing) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-3">
          <button
            onClick={() => setBrowsing(false)}
            className="px-2 py-1 text-content-muted"
          >
            ‹ Back
          </button>
          <span className="font-semibold">Entries</span>
        </header>
        <ul className="min-h-0 flex-1 overflow-auto">
          {entries.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-content-muted">
              No entries yet.
            </li>
          )}
          {entries.map((entry) => (
            <li key={entry} className="border-b border-line/60">
              <button
                onClick={() => {
                  setDate(entry);
                  setBrowsing(false);
                }}
                className="w-full px-4 py-3 text-left"
              >
                {entry}
                {entry === today && (
                  <span className="ml-2 text-xs text-content-muted">today</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-1 border-b border-line px-2 py-3">
        <button
          onClick={() => {
            // newest first: the recent past is what gets reopened
            void invoke("journal_list")
              .then((dates) => {
                setEntries([...dates].sort((a, b) => b.localeCompare(a)));
                setBrowsing(true);
              })
              .catch((e) => setError(errorMessage(e)));
          }}
          aria-label="All entries"
          className="px-2 py-1 text-lg text-content-muted"
        >
          ≡
        </button>
        <button
          onClick={() => setDate((d) => addDaysISO(d, -1))}
          aria-label="Previous day"
          className="px-2 py-1 text-lg text-content-muted"
        >
          ‹
        </button>
        <div className="min-w-0 text-center">
          <div className="truncate font-semibold">
            {date === today ? "Today" : date}
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-content-muted">
            {/* the date doubles as a picker, same as the day view's */}
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              aria-label="Jump to date"
              className="border-none bg-transparent p-0 text-center text-xs text-content-muted outline-none"
            />
            <SaveIndicator state={saveState} onRetry={() => void flush()} />
          </div>
        </div>
        <button
          onClick={() => setDate((d) => addDaysISO(d, 1))}
          aria-label="Next day"
          className="px-2 py-1 text-lg text-content-muted"
        >
          ›
        </button>
        <button
          onClick={() => setDate(today)}
          disabled={date === today}
          aria-label="Back to today"
          className="px-2 py-1 text-xs text-content-muted disabled:opacity-30"
        >
          Today
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
