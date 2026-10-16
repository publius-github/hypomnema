import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { useTaskTextDraft } from "../hooks/useTaskTextDraft";
import { priorityPatch, sortSubtasks } from "../lib/tasks";
import { useBackStep } from "./back";
import { Toggle } from "./controls";
import type { Task, TaskStatus } from "../types";

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];

const STATUSES: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "postponed", label: "Postponed" },
  { id: "waiting", label: "Done, waiting" },
  { id: "done", label: "Done" },
  { id: "dropped", label: "Dropped" },
];

/**
 * One task, in full, on a phone.
 *
 * A whole screen rather than the desktop's modal: a dialog over a
 * 6-inch display is a screen with a border drawn around it, and the
 * border costs the room the keyboard is about to take.
 *
 * Text commits on blur and on close rather than per keystroke
 * (`useTaskTextDraft`, shared with the desktop dialog): a half-typed
 * value committing as it goes wiped the field mid-typing there, and a
 * phone keyboard makes the problem worse, not better.
 */
export default function MobileTaskEditor({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const lists = useAppStore((s) => s.lists);
  const config = useAppStore((s) => s.config);
  const today = useAppStore((s) => s.today);
  const tasks = useAppStore((s) => s.tasks);
  const updateTask = useAppStore((s) => s.updateTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const createTask = useAppStore((s) => s.createTask);

  // A generated task mirrors its config file: title, text, date and list
  // are the file's to change, not this screen's. Status, priority and
  // colour are instance-local and survive an engine pass, so they stay
  // editable here - same rule as the desktop's task dialog.
  const generated = task.origin !== "manual";

  const { title, setTitle, description, setDescription, commit, discard } =
    useTaskTextDraft(task, updateTask);
  const [date, setDate] = useState(task.scheduled_date ?? "");
  const [time, setTime] = useState(task.time ?? "");
  // Priority and Unstar change the date behind these fields
  useEffect(() => {
    setDate(task.scheduled_date ?? "");
  }, [task.scheduled_date]);
  useEffect(() => {
    setTime(task.time ?? "");
  }, [task.time]);
  const [subtaskTitle, setSubtaskTitle] = useState("");

  const subtasks = sortSubtasks(
    tasks.filter((t) => t.parent_task_id === task.id),
    config?.subtasks_done_last ?? true,
  );

  const close = () => {
    commit();
    onClose();
  };
  // the hardware back button is the same gesture as the header's ‹ Back
  useBackStep(true, close);

  return (
    // The scrolling happens *inside* the safe area, not on it: a scroll
    // container carrying the top inset as padding scrolls that padding
    // away, and a sticky header sticks to the padding box - which is
    // under the status bar. The wrapper stays put and only the body moves.
    <div className="safe-area fixed inset-0 z-20 flex flex-col bg-surface">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-2 py-3">
        <button onClick={close} className="px-2 py-1 text-content-muted">
          ‹ Back
        </button>
        <span className="text-sm text-content-muted">
          {generated ? `from ${task.origin}` : "Task"}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-4 py-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-content-muted">
            Title
          </span>
          <textarea
            value={title}
            readOnly={generated}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commit}
            rows={2}
            className="resize-none rounded-lg border border-line bg-surface-alt px-3 py-2 read-only:opacity-70"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-content-muted">
            Notes
          </span>
          <textarea
            value={description}
            readOnly={generated}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={commit}
            rows={4}
            placeholder={generated ? "" : "Markdown"}
            className="resize-none rounded-lg border border-line bg-surface-alt px-3 py-2 read-only:opacity-70"
          />
        </label>

        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-content-muted">
              Date
            </span>
            <input
              type="date"
              value={date}
              disabled={generated}
              onChange={(e) => {
                setDate(e.target.value);
                void updateTask(task.id, {
                  scheduled_date: e.target.value || null,
                });
              }}
              className="rounded-lg border border-line bg-surface-alt px-3 py-2 disabled:opacity-70"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-content-muted">
              Time
            </span>
            <input
              type="time"
              value={time}
              disabled={generated}
              onChange={(e) => {
                setTime(e.target.value);
                void updateTask(task.id, { time: e.target.value || null });
              }}
              className="rounded-lg border border-line bg-surface-alt px-3 py-2"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-content-muted">
            List
          </span>
          <select
            value={task.list_id ?? ""}
            disabled={generated}
            onChange={(e) =>
              void updateTask(task.id, {
                list_id: e.target.value ? Number(e.target.value) : null,
              })
            }
            className="rounded-lg border border-line bg-surface-alt px-3 py-2 disabled:opacity-70"
          >
            <option value="">No list</option>
            {lists
              .filter((list) => !list.archived)
              .map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
          </select>
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wide text-content-muted">
            Status
          </span>
          <div className="flex flex-wrap gap-2">
            {/* checklist lists are a plain todo <-> done toggle; a
                leftover row in another state keeps its button so it can
                be reset */}
            {STATUSES.filter(
              (entry) =>
                entry.id === "todo" ||
                entry.id === "done" ||
                task.status === entry.id ||
                lists.find((l) => l.id === task.list_id)?.kind !==
                  "checklist",
            ).map((entry) => (
              <button
                key={entry.id}
                onClick={() => void updateTask(task.id, { status: entry.id })}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm ${
                  task.status === entry.id
                    ? "border-accent text-accent"
                    : "border-line"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Priority</span>
          <Toggle
            checked={task.priority}
            onChange={(next) =>
              void updateTask(task.id, priorityPatch(task, next, today))
            }
            label="Priority"
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wide text-content-muted">
            Colour
          </span>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => void updateTask(task.id, { color: null })}
              className={`h-9 w-9 rounded-full border ${
                task.color ? "border-line" : "border-accent border-2"
              }`}
              aria-label="No colour"
            />
            {COLORS.map((color) => (
              <button
                key={color}
                onClick={() => void updateTask(task.id, { color })}
                style={{ background: color }}
                className={`h-9 w-9 rounded-full ${
                  task.color === color ? "ring-2 ring-accent ring-offset-2" : ""
                }`}
                aria-label={`Colour ${color}`}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wide text-content-muted">
            Subtasks
          </span>
          <ul className="flex flex-col">
            {subtasks.map((sub) => (
              <li
                key={sub.id}
                className="flex items-center gap-2 border-b border-line/60 py-2"
              >
                <button
                  onClick={() =>
                    void updateTask(sub.id, {
                      status: sub.status === "done" ? "todo" : "done",
                    })
                  }
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
                      sub.status === "done"
                        ? "border-accent bg-accent text-white"
                        : "border-line text-transparent"
                    }`}
                  >
                    ✓
                  </span>
                  <span
                    className={`min-w-0 wrap-break-word ${
                      sub.status === "done"
                        ? "text-content-muted line-through"
                        : ""
                    }`}
                  >
                    {sub.title}
                  </span>
                </button>
                <button
                  onClick={() => void deleteTask(sub.id)}
                  aria-label={`Delete subtask ${sub.title}`}
                  className="px-2 text-content-muted"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              value={subtaskTitle}
              onChange={(e) => setSubtaskTitle(e.target.value)}
              placeholder="New subtask"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface-alt px-3 py-2"
            />
            <button
              onClick={() => {
                const trimmed = subtaskTitle.trim();
                if (!trimmed) return;
                // a subtask carries no list of its own; the parent's
                // list decides (same as the desktop dialog)
                void createTask({
                  title: trimmed,
                  parent_task_id: task.id,
                });
                setSubtaskTitle("");
              }}
              className="rounded-lg border border-line px-4 py-2"
            >
              Add
            </button>
          </div>
        </div>

        <button
          onClick={() => {
            discard();
            void deleteTask(task.id);
            onClose();
          }}
          className="rounded-lg border border-danger/50 px-4 py-3 text-danger"
        >
          Delete task
        </button>
      </div>
    </div>
  );
}
