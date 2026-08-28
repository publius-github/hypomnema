import { useDraggable } from "@dnd-kit/core";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
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
  showList = true,
}: {
  task: Task;
  overlay?: boolean;
  onOpen?: (id: number) => void;
  /** off inside a list column, where the list is the column itself */
  showList?: boolean;
}) {
  // selector subscriptions: with a whole-store subscribe, every toast or
  // banner change re-rendered every card on the grid
  const updateTask = useAppStore((s) => s.updateTask);
  const subtasksRaw = useAppStore(
    useShallow((s) => s.tasks.filter((t) => t.parent_task_id === task.id)),
  );
  // day columns group by cadence, so the list membership shows as a chip
  const listName = useAppStore((s) =>
    task.list_id === null
      ? null
      : (s.lists.find((l) => l.id === task.list_id)?.name ?? null),
  );
  const [expanded, setExpanded] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task:${task.id}`,
    disabled: overlay,
  });

  const subtasks = [...subtasksRaw].sort(compareTasks);
  const done = task.status === "done";
  const exactDate = task.origin === "scheduled" || task.origin === "birthday";
  const tooltip = [
    task.title,
    listName ? `List: ${listName}` : null,
    exactDate && task.origin_date
      ? `Scheduled for ${task.origin_date}`
      : null,
    task.overdue && !done ? "Overdue" : null,
    task.status === "postponed" ? "Postponed" : null,
  ]
    .filter(Boolean)
    .join("\n");

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
      <div className="flex items-center gap-2 p-2" title={tooltip}>
        {task.color && (
          <span
            className="h-4 w-1 shrink-0 rounded"
            style={{ backgroundColor: task.color }}
          />
        )}
        <button
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px] ${STATUS_BUTTON[task.status]}`}
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
        {exactDate && task.origin_date && (
          <span
            className="shrink-0 rounded bg-info/15 px-1 text-[11px] font-medium text-info"
            title={`Scheduled for ${task.origin_date}`}
          >
            {task.origin_date}
          </span>
        )}
        <div
          className={`min-w-0 flex-1 cursor-pointer truncate leading-snug ${
            done ? "text-content-muted line-through" : ""
          }`}
          onClick={() => onOpen?.(task.id)}
        >
          {task.title}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-content-muted">
          {task.time && <span>{task.time}</span>}
          {task.overdue && !done && (
            <span className="rounded bg-danger/15 px-1 font-medium text-danger">
              overdue
            </span>
          )}
          {task.status === "postponed" && (
            <span
              className="rounded bg-warn/15 px-1 font-medium text-warn"
              title="Postponed"
            >
              →
            </span>
          )}
          {showList && listName && (
            <span className="max-w-[72px] truncate rounded bg-line/40 px-1">
              {listName}
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
        {!overlay && !done && task.scheduled_date && (
          <button
            className="shrink-0 text-content-muted opacity-0 hover:text-warn focus-visible:opacity-100 group-hover:opacity-100"
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
