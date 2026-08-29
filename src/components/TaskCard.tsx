import { useDraggable } from "@dnd-kit/core";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";
import {
  compareTasks,
  nextStatus,
  priorityPatch,
  splitCategory,
  weekdayShort,
} from "../lib/tasks";
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
  const holdStatus = useAppStore((s) => s.holdStatus);
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
  // generated tasks mirror their config file: dragging them to another
  // day or list would silently diverge from it, so they don't drag
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task:${task.id}`,
    disabled: overlay || task.origin !== "manual",
  });

  const subtasksDoneLast = useAppStore(
    (s) => s.config?.subtasks_done_last ?? true,
  );
  const subtasks = [...subtasksRaw].sort((a, b) => {
    if (subtasksDoneLast && (a.status === "done") !== (b.status === "done")) {
      return a.status === "done" ? 1 : -1;
    }
    return compareTasks(a, b);
  });
  const done = task.status === "done";
  // a {Category} prefix is a pure text label rendered as a chip
  const { category, text } = splitCategory(task.title);
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

  const cycleStatus = () => {
    const next = nextStatus(task.status);
    void updateTask(task.id, { status: next });
    // hold a just-completed/postponed card in place for a moment so the
    // next checkbox click (or a fix of a misclick) is still possible
    if (next !== "todo") holdStatus(task.id);
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
      <div className="flex items-center gap-2 px-2 py-1" title={tooltip}>
        {task.color && (
          <span
            className="h-4 w-1 shrink-0 rounded"
            style={{ backgroundColor: task.color }}
          />
        )}
        <button
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px] ${STATUS_BUTTON[task.status]}`}
          title={`Status: ${task.status} (click: ${nextStatus(task.status)})`}
          onClick={(e) => {
            e.stopPropagation();
            cycleStatus();
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
        {showList && listName && (
          <span className="shrink-0 rounded bg-line/40 px-1 text-[11px] text-content-muted">
            {listName}
          </span>
        )}
        {category && (
          <span
            className="shrink-0 rounded bg-accent/10 px-1 text-[11px] text-accent"
            title={`Category: ${category}`}
          >
            {category}
          </span>
        )}
        {exactDate && task.origin_date && (
          <span
            className="shrink-0 rounded bg-info/15 px-1 text-[11px] font-medium text-info"
            title={`Scheduled for ${task.origin_date}`}
          >
            {weekdayShort(task.origin_date)} {task.origin_date}
          </span>
        )}
        <div
          className={`min-w-0 flex-1 cursor-pointer truncate leading-snug ${
            done ? "text-content-muted line-through" : ""
          }`}
          onClick={() => onOpen?.(task.id)}
        >
          {text}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-content-muted">
          {!overlay && (
            <button
              className={`${
                task.priority
                  ? "text-warn"
                  : "opacity-0 hover:text-warn focus-visible:opacity-100 group-hover:opacity-100"
              }`}
              title={
                task.priority
                  ? "Remove priority"
                  : "Priority: pin to today's column"
              }
              onClick={(e) => {
                e.stopPropagation();
                void updateTask(
                  task.id,
                  priorityPatch(
                    task,
                    !task.priority,
                    useAppStore.getState().today,
                  ),
                );
              }}
            >
              {task.priority ? "★" : "☆"}
            </button>
          )}
          {task.time && <span>{task.time}</span>}
          {task.overdue && !done && (
            <span className="rounded bg-danger/15 px-1 font-medium text-danger">
              overdue
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
      {expanded && subtasks.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line px-2 py-1.5 pl-7">
          {subtasks.map((sub) => (
            <label key={sub.id} className="flex items-start gap-1.5 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
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
