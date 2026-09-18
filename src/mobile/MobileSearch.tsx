import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import {
  daysBetweenISO,
  isClosed,
} from "../lib/tasks";
import { useEditTask } from "./editing";
import { useMobileNav } from "./nav";
import { useBackStep } from "./back";
import type { JournalSearchHit, KbSearchHit, Task } from "../types";

const STATUS_GLYPH: Record<string, string> = {
  todo: "○",
  done: "●",
  postponed: "◐",
  waiting: "◷",
  dropped: "✕",
};

/**
 * The phone's answer to the desktop's Ctrl+K palette: one query over
 * every task, the notes and the journal, as a whole screen rather than
 * a floating dialog - same commands, same three groups.
 *
 * A task hit opens the task editor; a dated task outside the snapshot
 * window first moves the day window there (the editor binds to the
 * store's copy, and the store only holds the window). Note and journal
 * hits jump to their tabs through the same store fields the desktop's
 * palette uses.
 */
export default function MobileSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<KbSearchHit[]>([]);
  const [journal, setJournal] = useState<JournalSearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lists = useAppStore((s) => s.lists);
  const { setEditing } = useEditTask();
  const { setTab } = useMobileNav();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // the hardware back button closes the overlay, same as the ‹ button
  useBackStep(true, onClose);

  // responses can interleave even with the debounce: only the newest
  // request may set the result lists
  const searchSeq = useRef(0);
  const runSearch = useCallback(async (q: string) => {
    const seq = ++searchSeq.current;
    if (!q) {
      setTasks([]);
      setNotes([]);
      setJournal([]);
      setSearched(false);
      return;
    }
    // tasks failing is an error worth surfacing; notes and journal
    // quietly return nothing when unavailable (KB not configured yet)
    const [taskHits, noteHits, journalHits] = await Promise.all([
      invoke("tasks_search", { query: q }).catch((e) => {
        useAppStore.getState().setError(errorMessage(e));
        return [] as Task[];
      }),
      invoke("kb_search", { query: q }).catch(
        () => [] as KbSearchHit[],
      ),
      invoke("journal_search", { query: q }).catch(
        () => [] as JournalSearchHit[],
      ),
    ]);
    if (seq !== searchSeq.current) return;
    setTasks(taskHits);
    setNotes(noteHits);
    setJournal(journalHits);
    setSearched(true);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const listName = (id: number | null) =>
    id === null ? null : (lists.find((l) => l.id === id)?.name ?? null);

  const openTask = (task: Task) => {
    const store = useAppStore.getState();
    if (
      task.scheduled_date &&
      !store.tasks.some((t) => t.id === task.id)
    ) {
      // outside the snapshot window: move the window there, the editor
      // appears once the refetch lands
      store.setGridOffset(daysBetweenISO(store.today, task.scheduled_date));
      setTab("day");
    }
    setEditing(task.id);
    onClose();
  };

  const openNote = (path: string) => {
    useAppStore.getState().openKbNote(path);
    setTab("notes");
    onClose();
  };

  const openJournal = (date: string) => {
    useAppStore.getState().openJournalDate(date);
    setTab("journal");
    onClose();
  };

  const groupHeader = (label: string) => (
    <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
      {label}
    </div>
  );

  const total = tasks.length + notes.length + journal.length;

  return (
    <div className="safe-area fixed inset-0 z-30 flex flex-col bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-2 py-3">
        <button onClick={onClose} className="px-2 py-1 text-content-muted">
          ‹ Back
        </button>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks, notes and journal..."
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-alt px-3 py-2"
        />
      </header>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {tasks.length > 0 && groupHeader("Tasks")}
        {tasks.map((task) => (
          <button
            key={`task-${task.id}`}
            onClick={() => openTask(task)}
            className="flex w-full items-center gap-3 border-b border-line/60 px-4 py-3 text-left"
          >
            <span
              className={
                isClosed(task.status)
                  ? "text-content-muted"
                  : task.status === "postponed"
                    ? "text-warn"
                    : "text-accent"
              }
            >
              {STATUS_GLYPH[task.status] ?? "○"}
            </span>
            <span
              className={`min-w-0 flex-1 break-words ${
                isClosed(task.status) ? "text-content-muted line-through" : ""
              }`}
            >
              {task.title}
            </span>
            <span className="shrink-0 text-right text-xs text-content-muted">
              {listName(task.list_id) && (
                <span className="block">{listName(task.list_id)}</span>
              )}
              {task.scheduled_date ?? "no date"}
            </span>
          </button>
        ))}
        {notes.length > 0 && groupHeader("Notes")}
        {notes.map((hit, index) => (
          <button
            key={`note-${hit.path}-${index}`}
            onClick={() => openNote(hit.path)}
            className="w-full border-b border-line/60 px-4 py-3 text-left"
          >
            <span className="block break-words font-medium">{hit.name}</span>
            <span className="block break-words text-xs text-content-muted">
              {hit.preview}
            </span>
          </button>
        ))}
        {journal.length > 0 && groupHeader("Journal")}
        {journal.map((hit, index) => (
          <button
            key={`journal-${hit.date}-${index}`}
            onClick={() => openJournal(hit.date)}
            className="w-full border-b border-line/60 px-4 py-3 text-left"
          >
            <span className="block font-medium">{hit.date}</span>
            <span className="block break-words text-xs text-content-muted">
              {hit.preview}
            </span>
          </button>
        ))}
        {searched && total === 0 && (
          <p className="px-4 py-8 text-center text-sm text-content-muted">
            Nothing found.
          </p>
        )}
        {!searched && (
          <p className="px-4 py-8 text-center text-xs text-content-muted">
            Searches every task (title and description), the notes and the
            journal.
          </p>
        )}
      </div>
    </div>
  );
}
