import { useDraggable } from "@dnd-kit/core";
import { useState } from "react";
import { useAppStore } from "../store";
import { compareTasks, nextStatus } from "../lib/tasks";
import type { Task } from "../types";

const STATUS_GLYPH: Record<Task["status"], string> = {
  todo: "",
  done: "✓",
  postponed: "→",
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
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
            done
              ? "border-accent bg-accent text-white"
              : "border-content-muted text-content-muted"
          }`}
          title={`Status: ${task.status}`}
          onClick={(e) => {
            e.stopPropagation();
            void updateTask(task.id, { status: nextStatus(task.status) });
          }}
        >
          {STATUS_GLYPH[task.status]}
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
              <span className="rounded bg-red-500/15 px-1 font-medium text-red-500">
                overdue
              </span>
            )}
            {task.status === "postponed" && <span>postponed</span>}
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
