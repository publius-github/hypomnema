import { useCallback, useEffect, useRef, useState } from "react";
import SaveIndicator from "../components/SaveIndicator";
import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import { addDaysISO, dayLabel, todayISO } from "../lib/tasks";
import EntryList from "./journal/EntryList";
import DayTasks from "./journal/DayTasks";
import { serialSaves, settleSave, type SaveState } from "./kb/util";
import { lazy, Suspense } from "react";
import NavArrow from "../components/NavArrow";
import { DatePick } from "../components/DateJump";

// CodeMirror and its language packs are the biggest thing in the bundle
// and only two sections need them; the chunk loads on first use
const MarkdownEditor = lazy(() => import("../components/MarkdownEditor"));

interface OpenDoc {
  date: string;
  content: string;
}

/** An edit waiting to be saved, numbered so a save that lands knows
 * whether anything was typed after it. */
interface PendingSave extends OpenDoc {
  gen: number;
}

export default function Journal() {
  const setError = useCallback(
    (e: unknown) => useAppStore.getState().setError(errorMessage(e)),
    [],
  );
  const [dates, setDates] = useState<string[]>([]);
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const saved = saveState === "saved";
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PendingSave | null>(null);
  // bumped by every keystroke: a save only marks the entry saved when
  // nothing was typed after the text it carried
  const editGen = useRef(0);
  const queueSave = useRef(serialSaves()).current;
  const docRef = useRef<OpenDoc | null>(null);
  docRef.current = doc;
  const savedRef = useRef(true);
  savedRef.current = saved;
  // the on-disk text the open entry's editor text derives from: each
  // save sends it, so a sync pass that merged the phone's edit in under
  // the editor gets merged with the typing instead of overwritten
  const baseRef = useRef<OpenDoc | null>(null);

  const loadDates = useCallback(async () => {
    try {
      setDates(await invoke("journal_list"));
    } catch (e) {
      setError(e);
    }
  }, [setError]);

  const persist = useCallback(
    (pending: PendingSave) =>
      queueSave(async () => {
        const { date, content, gen } = pending;
        try {
          const base = baseRef.current;
          const written = await invoke("journal_save", {
            date,
            content,
            base: base?.date === date ? base.content : null,
          });
          if (gen === editGen.current) setSaveState("saved");
          const cur = docRef.current;
          if (cur?.date === date) {
            const settled = settleSave(content, written, cur.content);
            baseRef.current = { date, content: settled.base };
            if (settled.content !== cur.content) {
              setDoc((prev) =>
                prev?.date === date
                  ? { ...prev, content: settled.content }
                  : prev,
              );
            }
          }
        } catch (e) {
          // kept for the next flush (entry switch, leaving, Retry) unless
          // newer typing already replaced it
          if (!pendingRef.current) pendingRef.current = pending;
          if (gen === editGen.current) setSaveState("failed");
          setError(e);
        }
      }),
    [queueSave, setError],
  );

  // saves the debounced edit immediately (tab switch, entry switch);
  // awaited before reopening, or the read could return the pre-save
  // file and the user would keep typing over stale text
  const flushPending = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      await persist(pending);
    }
  }, [persist]);

  // two quick clicks race their reads: only the latest open may land
  const openSeq = useRef(0);

  const openEntry = useCallback(
    async (date: string) => {
      const seq = ++openSeq.current;
      await flushPending();
      try {
        const entry = await invoke(
          "journal_open",
          { date },
        );
        if (seq !== openSeq.current) return;
        baseRef.current = { date: entry.date, content: entry.content };
        setDoc({ date: entry.date, content: entry.content });
        editGen.current++;
        setSaveState("saved");
        await loadDates();
      } catch (e) {
        setError(e);
      }
    },
    [flushPending, loadDates, setError],
  );

  useEffect(() => {
    // open Today once on mount, unless the palette asked for a date
    if (!useAppStore.getState().journalOpenDate) void openEntry(todayISO());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a sync pass (or anything else) changed the vault: an entry with no
  // unsaved typing shows what is on disk now; one with typing keeps it,
  // and its next save merges the two
  const vaultVersion = useAppStore((s) => s.vaultVersion);
  useEffect(() => {
    const open = docRef.current;
    if (!open || !savedRef.current || vaultVersion === 0) return;
    void (async () => {
      try {
        const entry = await invoke("journal_open", { date: open.date });
        if (!savedRef.current || docRef.current?.date !== entry.date) return;
        if (entry.content === docRef.current.content) return;
        baseRef.current = { date: entry.date, content: entry.content };
        setDoc({ date: entry.date, content: entry.content });
      } catch {
        // the vault is mid-reopen; the next update tries again
      }
    })();
  }, [vaultVersion]);

  // navigation requests from the search palette
  const journalOpenDate = useAppStore((s) => s.journalOpenDate);
  useEffect(() => {
    if (!journalOpenDate) return;
    useAppStore.setState({ journalOpenDate: null });
    void openEntry(journalOpenDate);
  }, [journalOpenDate, openEntry]);

  // autosave with debounce; flush on unmount and on entry switch
  const scheduleSave = (content: string) => {
    if (!doc) return;
    setDoc({ ...doc, content });
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const target = { ...doc, content, gen: ++editGen.current };
    pendingRef.current = target;
    saveTimer.current = setTimeout(() => {
      pendingRef.current = null;
      void persist(target);
    }, 800);
  };

  useEffect(() => {
    return () => void flushPending();
  }, [flushPending]);

  const today = todayISO();
  const config = useAppStore((s) => s.config);

  // Alt+Left / Alt+Right step through the days, from the editor too
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const open = docRef.current;
      if (!open) return;
      e.preventDefault();
      void openEntry(addDaysISO(open.date, e.key === "ArrowLeft" ? -1 : 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openEntry]);

  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-surface-alt/50">
        {/* the day stepper (arrows, date picker, back to today) lives
            in the entry header, like the day grid's; the rail is only
            the list of written entries */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <EntryList
            dates={dates}
            current={doc?.date ?? null}
            today={today}
            onOpen={(date) => void openEntry(date)}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {doc ? (
          <>
            <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-sm">
              {/* the same day stepper as the Dashboard and Days headers:
                  arrows, the date picker, a way back to today */}
              <div className="flex items-center gap-1">
                <NavArrow
                  dir={-1}
                  title="Previous day (Alt+←)"
                  onClick={() => void openEntry(addDaysISO(doc.date, -1))}
                />
                <NavArrow
                  dir={1}
                  title="Next day (Alt+→)"
                  onClick={() => void openEntry(addDaysISO(doc.date, 1))}
                />
                <DatePick
                  value={doc.date}
                  onPick={(date) => void openEntry(date)}
                />
                {doc.date !== today && (
                  <button
                    className="btn-ghost px-2 py-0.5 text-xs"
                    onClick={() => void openEntry(today)}
                  >
                    Back to today
                  </button>
                )}
              </div>
              <span className="ml-2 text-base font-semibold">
                {dayLabel(doc.date, today)}
              </span>
              <span className="ml-auto">
                <SaveIndicator
                  state={saveState}
                  onRetry={() => void flushPending()}
                />
              </span>
            </div>
            {(config?.journal_day_tasks ?? true) && (
              <DayTasks date={doc.date} />
            )}
            <div className="min-h-0 flex-1">
              <Suspense fallback={null}>
                <MarkdownEditor
                  docKey={`entry:${doc.date}`}
                  value={doc.content}
                  onChange={scheduleSave}
                  onWikiLink={(name) =>
                    void useAppStore.getState().openKbNoteByName(name)
                  }
                />
              </Suspense>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-content-muted">
            Loading...
          </div>
        )}
      </div>
    </div>
  );
}
