import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import type { JournalSearchHit, KbSearchHit, Task } from "../types";
import TaskModal from "./TaskModal";
import Icon from "./icons";
import { isClosed } from "../lib/tasks";

const STATUS_GLYPH: Record<string, string> = {
  todo: "○",
  done: "●",
  postponed: "◐",
  waiting: "◷",
  dropped: "✕",
};

// One flattened list drives the keyboard navigation; the group headers
// are rendered between the rows.
type Row =
  | { kind: "task"; task: Task }
  | { kind: "note"; hit: KbSearchHit }
  | { kind: "journal"; hit: JournalSearchHit };

export default function SearchPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<KbSearchHit[]>([]);
  const [journal, setJournal] = useState<JournalSearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const storeTasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // responses can interleave even with the debounce: only the newest
  // request may set the result lists
  const searchSeq = useRef(0);
  const [highlighted, setHighlighted] = useState(0);

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
      invoke<Task[]>("tasks_search", { query: q }).catch((e) => {
        useAppStore.getState().setError(String(e));
        return [] as Task[];
      }),
      invoke<KbSearchHit[]>("kb_search", { query: q }).catch(
        () => [] as KbSearchHit[],
      ),
      invoke<JournalSearchHit[]>("journal_search", { query: q }).catch(
        () => [] as JournalSearchHit[],
      ),
    ]);
    if (seq !== searchSeq.current) return;
    setTasks(taskHits);
    setNotes(noteHits);
    setJournal(journalHits);
    setSearched(true);
    setHighlighted(0);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  // keep the opened task fresh after edits made in the modal: prefer
  // the live store copy (grid window), otherwise refetch by id
  useEffect(() => {
    if (!selected) return;
    const live = storeTasks.find((t) => t.id === selected.id);
    if (live) {
      setSelected(live);
      return;
    }
    invoke<Task>("task_get", { id: selected.id })
      .then(setSelected)
      .catch(() => setSelected(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeTasks]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !selected) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, onClose]);

  const listName = (id: number | null) =>
    id === null ? null : (lists.find((l) => l.id === id)?.name ?? null);

  const rows: Row[] = [
    ...tasks.map((task): Row => ({ kind: "task", task })),
    ...notes.map((hit): Row => ({ kind: "note", hit })),
    ...journal.map((hit): Row => ({ kind: "journal", hit })),
  ];
  const total = rows.length;

  const activate = (row: Row) => {
    if (row.kind === "task") {
      setSelected(row.task);
    } else if (row.kind === "note") {
      useAppStore.getState().openKbNote(row.hit.path);
      onClose();
    } else {
      useAppStore.getState().openJournalDate(row.hit.date);
      onClose();
    }
  };

  const rowButton = (row: Row, index: number, content: React.ReactNode) => (
    <button
      key={`${row.kind}-${index}`}
      ref={(el) => {
        if (index === highlighted) el?.scrollIntoView({ block: "nearest" });
      }}
      className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
        index === highlighted ? "bg-line/40" : "hover:bg-line/30"
      }`}
      onMouseMove={() => setHighlighted(index)}
      onClick={() => activate(row)}
    >
      {content}
    </button>
  );

  const groupHeader = (label: string) => (
    <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
      {label}
    </div>
  );

  // running row index across the groups
  let cursor = 0;

  return (
    <div
      className="fixed inset-0 z-20 flex justify-center bg-black/40 p-6 pt-24"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-fit max-h-[70vh] w-[560px] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Icon name="search" className="h-4 w-4 text-content-muted" />
          <input
            ref={inputRef}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            placeholder="Search tasks, notes and journal..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlighted((i) => Math.min(i + 1, total - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlighted((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && rows[highlighted]) {
                activate(rows[highlighted]);
              }
            }}
          />
          <span className="text-[11px] text-content-muted">Esc</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-1">
          {tasks.length > 0 && groupHeader("Tasks")}
          {tasks.map((task) => {
            const index = cursor++;
            return rowButton({ kind: "task", task }, index, (
              <>
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
                  className={`min-w-0 flex-1 truncate ${
                    isClosed(task.status)
                      ? "text-content-muted line-through"
                      : ""
                  }`}
                >
                  {task.title}
                </span>
                {listName(task.list_id) && (
                  <span className="shrink-0 text-xs text-content-muted">
                    {listName(task.list_id)}
                  </span>
                )}
                <span className="w-20 shrink-0 text-right text-xs text-content-muted">
                  {task.scheduled_date ?? "no date"}
                </span>
              </>
            ));
          })}
          {notes.length > 0 && groupHeader("Notes")}
          {notes.map((hit) => {
            const index = cursor++;
            return rowButton({ kind: "note", hit }, index, (
              <>
                <Icon
                  name="notes"
                  className="h-4 w-4 shrink-0 text-content-muted"
                />
                <span className="shrink-0 font-medium">{hit.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-content-muted">
                  {hit.preview}
                </span>
              </>
            ));
          })}
          {journal.length > 0 && groupHeader("Journal")}
          {journal.map((hit) => {
            const index = cursor++;
            return rowButton({ kind: "journal", hit }, index, (
              <>
                <Icon
                  name="pencil"
                  className="h-4 w-4 shrink-0 text-content-muted"
                />
                <span className="shrink-0 font-medium">{hit.date}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-content-muted">
                  {hit.preview}
                </span>
              </>
            ));
          })}
          {searched && total === 0 && (
            <div className="px-4 py-6 text-center text-sm text-content-muted">
              Nothing found
            </div>
          )}
          {!searched && (
            <div className="px-4 py-6 text-center text-xs text-content-muted">
              Searches every task (title and description), the notes and
              the journal.
            </div>
          )}
        </div>
      </div>
      {selected && (
        <TaskModal
          task={selected}
          onClose={() => {
            setSelected(null);
            void runSearch(query.trim());
          }}
        />
      )}
    </div>
  );
}
