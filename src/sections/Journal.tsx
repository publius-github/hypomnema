import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import { todayISO } from "../lib/tasks";
import { settleSave } from "./kb/util";
import { lazy, Suspense } from "react";

// CodeMirror and its language packs are the biggest thing in the bundle
// and only two sections need them; the chunk loads on first use
const MarkdownEditor = lazy(() => import("../components/MarkdownEditor"));

interface OpenDoc {
  date: string;
  content: string;
}

export default function Journal() {
  const setError = useCallback(
    (e: unknown) => useAppStore.getState().setError(errorMessage(e)),
    [],
  );
  const [dates, setDates] = useState<string[]>([]);
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  const [saved, setSaved] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<OpenDoc | null>(null);
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
    async (date: string, content: string) => {
      try {
        const base = baseRef.current;
        const written = await invoke("journal_save", {
          date,
          content,
          base: base?.date === date ? base.content : null,
        });
        setSaved(true);
        const cur = docRef.current;
        if (cur?.date === date) {
          const settled = settleSave(content, written, cur.content);
          baseRef.current = { date, content: settled.base };
          if (settled.content !== cur.content) {
            setDoc((prev) =>
              prev?.date === date ? { ...prev, content: settled.content } : prev,
            );
          }
        }
      } catch (e) {
        setError(e);
      }
    },
    [setError],
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
      await persist(pending.date, pending.content);
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
        setSaved(true);
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
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const target = { ...doc, content };
    pendingRef.current = target;
    saveTimer.current = setTimeout(() => {
      pendingRef.current = null;
      void persist(target.date, target.content);
    }, 800);
  };

  useEffect(() => {
    return () => void flushPending();
  }, [flushPending]);

  const today = todayISO();

  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-surface-alt/50">
        <div className="flex flex-col gap-1 p-3">
          <button
            className="btn-primary px-3 text-left"
            onClick={() => void openEntry(today)}
          >
            Today
          </button>
          <input
            type="date"
            className="input px-2 py-1 text-xs"
            title="Open the entry for any date"
            value={doc?.date ?? ""}
            onChange={(e) => {
              if (e.target.value) void openEntry(e.target.value);
            }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <div className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
            Entries
          </div>
          {dates.map((date) => (
            <button
              key={date}
              className={`block w-full rounded px-2 py-1 text-left text-sm ${
                doc?.date === date
                  ? "bg-accent/15 text-accent"
                  : "text-content hover:bg-line/40"
              }`}
              onClick={() => void openEntry(date)}
            >
              {date}
              {date === today && " (today)"}
            </button>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {doc ? (
          <>
            <div className="flex items-center justify-between border-b border-line px-4 py-2 text-sm">
              <span className="text-base font-semibold">{doc.date}</span>
              <span className="text-xs text-content-muted">
                {saved ? "Saved" : "Saving..."}
              </span>
            </div>
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
