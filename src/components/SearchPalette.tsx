import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import type { Task } from "../types";
import TaskModal from "./TaskModal";
import Icon from "./icons";

const STATUS_GLYPH: Record<string, string> = {
  todo: "○",
  done: "●",
  postponed: "◐",
};

export default function SearchPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Task[]>([]);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const storeTasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // responses can interleave even with the debounce: only the newest
  // request may set the result list
  const searchSeq = useRef(0);
  const [highlighted, setHighlighted] = useState(0);

  const runSearch = useCallback(async (q: string) => {
    const seq = ++searchSeq.current;
    if (!q) {
      setResults([]);
      setSearched(false);
      return;
    }
    try {
      const found = await invoke<Task[]>("tasks_search", { query: q });
      if (seq !== searchSeq.current) return;
      setResults(found);
      setSearched(true);
      setHighlighted(0);
    } catch (e) {
      useAppStore.setState({ error: String(e) });
    }
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
            placeholder="Search tasks by title..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlighted((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlighted((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && results[highlighted]) {
                setSelected(results[highlighted]);
              }
            }}
          />
          <span className="text-[11px] text-content-muted">Esc</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {results.map((task, index) => (
            <button
              key={task.id}
              ref={(el) => {
                if (index === highlighted)
                  el?.scrollIntoView({ block: "nearest" });
              }}
              className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                index === highlighted ? "bg-line/40" : "hover:bg-line/30"
              }`}
              onMouseMove={() => setHighlighted(index)}
              onClick={() => setSelected(task)}
            >
              <span
                className={
                  task.status === "done"
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
                  task.status === "done"
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
            </button>
          ))}
          {searched && results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-content-muted">
              Nothing found
            </div>
          )}
          {!searched && (
            <div className="px-4 py-6 text-center text-xs text-content-muted">
              Searches every task ever created, including days outside the
              grid window.
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
