import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import { useBackStep } from "./back";
import DayHeader, { HeaderButton, MenuIcon } from "./DayHeader";
import { settleSave } from "../sections/kb/util";
import SaveIndicator from "../components/SaveIndicator";
import { AUTOSAVE_DELAY_MS, useAutosave } from "../hooks/useAutosave";

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
  const [browsing, setBrowsing] = useState(false);
  const [entries, setEntries] = useState<string[]>([]);
  const contentRef = useRef(content);
  contentRef.current = content;
  // the on-disk text the shown entry derives from: each save sends it,
  // so a sync pass that merged the desktop's edit in under the textarea
  // is merged with the typing instead of overwritten
  const baseRef = useRef<{ date: string; content: string } | null>(null);
  // hardware back leaves the entry browser before leaving the tab
  useBackStep(browsing, () => setBrowsing(false));
  // and from another day returns to today first
  useBackStep(!browsing && date !== today, () => setDate(today));

  // a search hit or the Review's "Weekly note" landed here with a date
  const openDate = useAppStore((s) => s.journalOpenDate);
  useEffect(() => {
    if (!openDate) return;
    setDate(openDate);
    setBrowsing(false);
    useAppStore.setState({ journalOpenDate: null });
  }, [openDate]);

  // Switching days (or leaving, or backgrounding the app - on a phone
  // the common way to leave) must not drop an edit still sitting in the
  // debounce, and the save has to land before the next read or the user
  // types over text that was already stale when it arrived.
  const reportError = useCallback(
    (e: unknown) => setError(errorMessage(e)),
    [setError],
  );
  const {
    saveState,
    savedRef,
    flush,
    loaded: markLoaded,
    schedule,
  } = useAutosave<{ date: string; content: string }>(
    async ({ date: entryDate, content: text }) => {
      const base = baseRef.current;
      const written = await invoke("journal_save", {
        date: entryDate,
        content: text,
        base: base?.date === entryDate ? base.content : null,
      });
      if (loadedDate.current === entryDate) {
        const settled = settleSave(text, written, contentRef.current);
        baseRef.current = { date: entryDate, content: settled.base };
        if (settled.content !== contentRef.current) {
          setContent(settled.content);
        }
      }
    },
    reportError,
    AUTOSAVE_DELAY_MS.mobile,
  );

  const loadedDate = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!(await flush())) {
        // the shown entry's save failed: going to another day would let
        // the next keystroke there replace it - stay on it
        if (!cancelled && loadedDate.current) setDate(loadedDate.current);
        return;
      }
      try {
        const entry = await invoke(
          "journal_open",
          { date },
        );
        if (cancelled) return;
        loadedDate.current = entry.date;
        baseRef.current = { date: entry.date, content: entry.content };
        setContent(entry.content);
        markLoaded();
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
  }, [vaultVersion, savedRef]);

  const edit = (text: string) => {
    // the textarea still shows the previous day's text until the open
    // lands; a keystroke now would queue that text under the new date
    if (loadedDate.current !== date) return;
    setContent(text);
    schedule({ date, content: text });
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
      <DayHeader
        date={date}
        today={today}
        onDate={setDate}
        left={
          <HeaderButton
            label="All entries"
            onClick={() => {
              // newest first: the recent past is what gets reopened
              void invoke("journal_list")
                .then((dates) => {
                  setEntries([...dates].sort((a, b) => b.localeCompare(a)));
                  setBrowsing(true);
                })
                .catch((e) => setError(errorMessage(e)));
            }}
          >
            <MenuIcon />
          </HeaderButton>
        }
        status={saveState === "dirty" && " · Saving..."}
      />
      {/* a failed save is the one state worth a line of its own; a
          steady "Saved" in the header was noise on every entry */}
      {saveState === "failed" && (
        <div className="flex justify-end border-b border-line px-4 py-1">
          <SaveIndicator state={saveState} onRetry={() => void flush()} />
        </div>
      )}
      <textarea
        value={content}
        onChange={(e) => edit(e.target.value)}
        spellCheck
        className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 leading-relaxed outline-hidden"
        placeholder="Write about today..."
      />
    </div>
  );
}
