import { useEffect, useState } from "react";
import { invoke } from "../../lib/ipc";
import { addDaysISO, splitCategory } from "../../lib/tasks";
import { useAppStore } from "../../store";
import TaskModal from "../../components/TaskModal";
import type { Task } from "../../types";

const MARK: Record<string, string> = {
  done: "✓",
  dropped: "✕",
  waiting: "◔",
  postponed: "»",
};

/**
 * The tasks of a Journal entry's day under its header, done first: an
 * entry is usually written against how the day went. Collapsed to one
 * line until opened; a row opens the task dialog.
 */
export default function DayTasks({ date }: { date: string }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  // the store's task array is replaced on every change: refetch then
  const storeTasks = useAppStore((s) => s.tasks);

  useEffect(() => {
    let cancelled = false;
    void invoke("tasks_snapshot", {
      startDate: date,
      endDate: addDaysISO(date, 1),
    })
      .then((all) => {
        if (cancelled) return;
        setTasks(
          all
            .filter((t) => t.scheduled_date === date && t.parent_task_id === null)
            .sort(
              (a, b) =>
                Number(b.status === "done") - Number(a.status === "done") ||
                (a.time ?? "").localeCompare(b.time ?? ""),
            ),
        );
      })
      .catch(() => {
        if (!cancelled) setTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [date, storeTasks]);

  if (!tasks || tasks.length === 0) return null;
  const done = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="border-b border-line px-4 py-1.5 text-sm">
      <button
        className="flex w-full items-center gap-2 text-left text-xs text-content-muted hover:text-content"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="w-3">{open ? "▾" : "▸"}</span>
        Tasks that day: {done} done
        {tasks.length > done && `, ${tasks.length - done} not`}
      </button>
      {open && (
        <ul className="flex max-h-40 flex-col overflow-y-auto py-1">
          {tasks.map((task) => (
            <li key={task.id}>
              <button
                className="flex w-full items-baseline gap-2 rounded-sm px-2 py-0.5 text-left hover:bg-line/40"
                onClick={() => setEditing(task)}
              >
                <span className="w-3 shrink-0 text-center text-content-muted">
                  {MARK[task.status] ?? "○"}
                </span>
                {task.time && (
                  <span className="shrink-0 text-xs text-content-muted">
                    {task.time}
                  </span>
                )}
                <span
                  className={`min-w-0 truncate ${
                    task.status === "dropped" ? "line-through opacity-60" : ""
                  }`}
                >
                  {splitCategory(task.title).text}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <TaskModal task={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
