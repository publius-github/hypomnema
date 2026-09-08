import { useState } from "react";
import { useAppStore } from "../store";
import { addDaysISO } from "../lib/tasks";
import { useEditTask } from "./editing";
import type { Task } from "../types";

/**
 * One task, sized for a thumb.
 *
 * The whole row toggles done, because that is what a task row is for
 * ninety percent of the time and aiming at a small checkbox on a moving
 * bus is not a design. Everything rarer hides behind the "..." button,
 * which opens actions inline rather than in a dialog - a modal over a
 * phone screen hides the very list the action refers to.
 */
export default function TaskRow({
  task,
  neighbours,
}: {
  task: Task;
  /**
   * The rows above and below within a list, when there is an order to
   * change. Reordering is a list-column concept - a day column sorts
   * itself - so a day view simply does not pass them, and the two
   * actions stay off a screen where they would do nothing.
   */
  neighbours?: { previous?: number; next?: number };
}) {
  const [open, setOpen] = useState(false);
  const updateTask = useAppStore((s) => s.updateTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const tasks = useAppStore((s) => s.tasks);
  const reorderTask = useAppStore((s) => s.reorderTask);
  const { setEditing } = useEditTask();
  const done = task.status === "done";
  const subtasks = tasks.filter((t) => t.parent_task_id === task.id);
  const subtasksDone = subtasks.filter((t) => t.status === "done").length;

  const act = (patch: Parameters<typeof updateTask>[1]) => {
    setOpen(false);
    void updateTask(task.id, patch);
  };

  return (
    <li className="border-b border-line/60">
      <div className="flex items-stretch">
        <button
          onClick={() =>
            void updateTask(task.id, { status: done ? "todo" : "done" })
          }
          className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left"
        >
          <span
            aria-hidden
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
              done
                ? "border-accent bg-accent text-white"
                : "border-line text-transparent"
            }`}
          >
            ✓
          </span>
          <span className="min-w-0">
            <span
              className={`block break-words ${
                done ? "text-content-muted line-through" : ""
              }`}
            >
              {task.title}
            </span>
            <span className="mt-0.5 flex flex-wrap gap-2 text-xs text-content-muted">
              {task.time && <span>{task.time}</span>}
              {subtasks.length > 0 && (
                <span>
                  {subtasksDone}/{subtasks.length}
                </span>
              )}
              {task.overdue && <span className="text-warn">overdue</span>}
              {task.priority && <span className="text-accent">priority</span>}
              {task.status === "postponed" && <span>postponed</span>}
            </span>
          </span>
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Task actions"
          className="px-4 text-content-muted"
        >
          ⋯
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          <Action
            label="Edit"
            onClick={() => {
              setOpen(false);
              setEditing(task.id);
            }}
          />
          {/* Up and down rather than a long-press drag: dragging inside a
              scrolling list on a phone fights the scroll, and the gesture
              that wins is whichever the finger commits to first. Two
              buttons never guess. */}
          {neighbours?.previous !== undefined && (
            <Action
              label="Up"
              onClick={() => {
                setOpen(false);
                void reorderTask(task.id, neighbours.previous!);
              }}
            />
          )}
          {neighbours?.next !== undefined && (
            <Action
              label="Down"
              onClick={() => {
                setOpen(false);
                void reorderTask(task.id, neighbours.next!);
              }}
            />
          )}
          <Action
            label="Tomorrow"
            onClick={() =>
              act({
                scheduled_date: addDaysISO(
                  task.scheduled_date ?? useAppStore.getState().today,
                  1,
                ),
              })
            }
          />
          <Action
            label="Postpone"
            onClick={() => act({ status: "postponed" })}
          />
          <Action
            label={task.priority ? "Unstar" : "Star"}
            onClick={() => act({ priority: !task.priority })}
          />
          <Action
            label="Delete"
            danger
            onClick={() => {
              setOpen(false);
              void deleteTask(task.id);
            }}
          />
        </div>
      )}
    </li>
  );
}

function Action({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm ${
        danger ? "border-danger/50 text-danger" : "border-line"
      }`}
    >
      {label}
    </button>
  );
}
