import { useDraggable } from "@dnd-kit/core";
import { useState } from "react";
import { useAppStore } from "../store";
import { addDaysISO, compareTasks, nextStatus } from "../lib/tasks";
import type { Task } from "../types";

const STATUS_BUTTON: Record<Task["status"], string> = {
  todo: "border-content-muted text-content-muted",
  done: "border-accent bg-accent text-white",
  postponed: "border-warn bg-warn text-white",
};

export default function TaskCard({
  task,
  overlay = false,
  onOpen,
}: {
  task: Task;
  overlay?: boolean;
  onOpen?: (id: number) => void;
}) {
  const { tasks, updateTask } = useAppStore();
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task:${task.id}`,
    disabled: overlay,
  });

  const subtasks = tasks
    .filter((t) => t.parent_task_id === task.id)
    .sort(compareTasks);
  const done = task.status === "done";

  // postpone = move one day forward with the postponed mark, counted
  // from the task's own day (or today for a stale date)
  const postpone = () => {
    const today = useAppStore.getState().today;
    const base =
      task.scheduled_date && task.scheduled_date > today
        ? task.scheduled_date
        : today;
    void updateTask(task.id, {
      scheduled_date: addDaysISO(base, 1),
      status: "postponed",
    });
  };

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      className={`group rounded-md border border-line bg-surface-alt text-sm shadow-sm ${
        isDragging ? "opacity-30" : ""
      } ${overlay ? "shadow-lg" : ""}`}
    >
      <div className="flex items-start gap-2 p-2">
        {task.color && (
          <span
            className="mt-0.5 h-4 w-1 shrink-0 rounded"
            style={{ backgroundColor: task.color }}
          />
        )}
        <button
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px] ${STATUS_BUTTON[task.status]}`}
          title={`Status: ${task.status}`}
          onClick={(e) => {
            e.stopPropagation();
            void updateTask(task.id, { status: nextStatus(task.status) });
          }}
        >
          {done && "✓"}
          {task.status === "postponed" && (
            <svg
              viewBox="0 0 12 12"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M1.5 6h8" />
              <path d="M6.5 3l3 3-3 3" />
            </svg>
          )}
        </button>
        <div
          className="min-w-0 flex-1 cursor-pointer"
          onClick={() => onOpen?.(task.id)}
        >
          <div
            className={`break-words leading-snug ${
              done ? "text-content-muted line-through" : ""
            }`}
          >
            {task.title}
          </div>
          <div className="flex flex-wrap gap-1.5 pt-0.5 text-[11px] text-content-muted">
            {task.time && <span>{task.time}</span>}
            {task.overdue && task.status !== "done" && (
              <span className="rounded bg-danger/15 px-1 font-medium text-danger">
                overdue
              </span>
            )}
            {task.status === "postponed" && (
              <span className="rounded bg-warn/15 px-1 font-medium text-warn">
                postponed
              </span>
            )}
            {(task.origin === "scheduled" || task.origin === "birthday") && (
              <span className="rounded bg-info/15 px-1 font-medium text-info">
                exact date
              </span>
            )}
            {subtasks.length > 0 && (
              <button
                className="hover:text-content"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
              >
                {expanded ? "▾" : "▸"}{" "}
                {subtasks.filter((s) => s.status === "done").length}/
                {subtasks.length}
              </button>
            )}
          </div>
        </div>
        {!overlay && !done && task.scheduled_date && (
          <button
            className="mt-0.5 hidden shrink-0 text-content-muted hover:text-warn group-hover:block"
            title="Postpone to the next day"
            onClick={(e) => {
              e.stopPropagation();
              postpone();
            }}
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M2 8h9" />
              <path d="M8 4.5 11.5 8 8 11.5" />
              <path d="M14 3.5v9" />
            </svg>
          </button>
        )}
      </div>
      {expanded && subtasks.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line px-2 py-1.5 pl-7">
          {subtasks.map((sub) => (
            <label key={sub.id} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={sub.status === "done"}
                onChange={() =>
                  void updateTask(sub.id, {
                    status: sub.status === "done" ? "todo" : "done",
                  })
                }
              />
              <span
                className={
                  sub.status === "done"
                    ? "text-content-muted line-through"
                    : ""
                }
              >
                {sub.title}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
