import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useAppStore } from "../store";
import { priorityPatch, sortSubtasks } from "../lib/tasks";
import { wikiTargetFromHref, wikiToMarkdownLinks } from "../lib/wiki";
import type { Task, TaskStatus } from "../types";

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];

const ORIGIN_CONFIG: Record<string, string> = {
  recurring: "recurring.yml",
  scheduled: "scheduled.yml",
  birthday: "birthdays.yml",
};

export default function TaskModal({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const lists = useAppStore((s) => s.lists);
  const config = useAppStore((s) => s.config);
  const updateTask = useAppStore((s) => s.updateTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const createTask = useAppStore((s) => s.createTask);
  const tasks = useAppStore((s) => s.tasks);
  // generated tasks mirror their config file exactly: title, text, date
  // and list are locked here - the config is the only place to change
  // them. Status, priority and color stay local to the instance.
  const generated = task.origin !== "manual";
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description_md);
  const [preview, setPreview] = useState(
    generated || task.description_md.length > 0,
  );
  const [subtaskTitle, setSubtaskTitle] = useState("");

  const subtasksDoneLast = config?.subtasks_done_last ?? true;
  const subtasks = sortSubtasks(
    tasks.filter((t) => t.parent_task_id === task.id),
    subtasksDoneLast,
  );

  const commitTitle = () => {
    if (generated) return;
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      void updateTask(task.id, { title: trimmed });
    }
  };

  const commitDescription = () => {
    if (generated) return;
    if (description !== task.description_md) {
      void updateTask(task.id, { description_md: description });
    }
  };

  // Backdrop and Escape both close through here: the backdrop mousedown
  // fires before the input's blur handler, so closing without an
  // explicit commit would drop an edited title or description.
  const closedRef = useRef(false);
  const commitAndClose = () => {
    closedRef.current = true;
    commitTitle();
    commitDescription();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") commitAndClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description]);

  // The modal can also unmount without any close action - e.g. the task
  // moves outside the snapshot window, or the parent tree goes away.
  // Commit whatever is pending so typed text is never silently lost.
  const pendingRef = useRef({
    id: task.id,
    title,
    baseTitle: task.title,
    description,
    baseDescription: task.description_md,
  });
  pendingRef.current = {
    id: task.id,
    title,
    baseTitle: task.title,
    description,
    baseDescription: task.description_md,
  };
  useEffect(() => {
    if (generated) return;
    return () => {
      if (closedRef.current) return;
      const p = pendingRef.current;
      const trimmed = p.title.trim();
      if (trimmed && trimmed !== p.baseTitle) {
        void updateTask(p.id, { title: trimmed });
      }
      if (p.description !== p.baseDescription) {
        void updateTask(p.id, { description_md: p.description });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) commitAndClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-full w-[560px] flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <input
            className={`input flex-1 text-base font-medium ${
              generated ? "opacity-70" : ""
            }`}
            value={title}
            readOnly={generated}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
          />
          <button
            className="text-lg text-content-muted hover:text-content"
            onClick={commitAndClose}
          >
            ×
          </button>
        </div>

        {generated && (
          <div className="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-xs text-info">
            Generated from{" "}
            <button
              className="font-medium underline"
              onClick={() => {
                closedRef.current = true;
                onClose();
                useAppStore
                  .getState()
                  .openConfigFile(ORIGIN_CONFIG[task.origin] ?? "recurring.yml");
              }}
            >
              {ORIGIN_CONFIG[task.origin] ?? "config"}
            </button>
            . Title, text, date and list follow the config; edit it there.
            <div className="mt-1 select-text text-[11px] text-info/70">
              origin {task.origin}
              {task.cadence ? ` · cadence ${task.cadence}` : ""}
              {task.dow_label ? ` · day ${task.dow_label}` : ""}
              {task.rule_key ? ` · rule ${task.rule_key.slice(0, 8)}` : ""}
              {task.period_key ? ` · period ${task.period_key}` : ""}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-content-muted">Status</span>
            <select
              className="input"
              value={task.status}
              onChange={(e) =>
                void updateTask(task.id, {
                  status: e.target.value as TaskStatus,
                })
              }
            >
              <option value="todo">To Do</option>
              <option value="done">Done</option>
              <option value="postponed">Postponed</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-content-muted">List</span>
            <select
              className="input"
              value={task.list_id ?? ""}
              disabled={generated}
              onChange={(e) =>
                void updateTask(task.id, {
                  list_id: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            >
              <option value="">No list</option>
              {lists
                // engine-created lists ({List} YAML prefixes, Birthdays)
                // are not assignment targets; keep the current one so
                // the value still renders on generated tasks
                .filter((l) => !l.auto || l.id === task.list_id)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-content-muted">Date</span>
            <input
              className="input"
              type="date"
              value={task.scheduled_date ?? ""}
              disabled={generated}
              onChange={(e) =>
                void updateTask(task.id, {
                  scheduled_date: e.target.value || null,
                })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-content-muted">Time</span>
            <input
              className="input"
              type="time"
              value={task.time ?? ""}
              disabled={generated}
              onChange={(e) =>
                void updateTask(task.id, { time: e.target.value || null })
              }
            />
          </label>
        </div>

        <div className="flex items-center gap-4">
          {!generated && (
            <label
              className="flex items-center gap-1.5 text-sm"
              title="Priority pins the task to today's column; it never gets the overdue mark"
            >
              <input
                type="checkbox"
                checked={task.priority}
                onChange={(e) =>
                  void updateTask(
                    task.id,
                    priorityPatch(
                      task,
                      e.target.checked,
                      useAppStore.getState().today,
                    ),
                  )
                }
              />
              <span className="text-warn">★</span> Priority
            </label>
          )}
          <span className="text-xs text-content-muted">Color</span>
          {COLORS.map((c) => (
            <button
              key={c}
              className={`h-5 w-5 rounded-full border-2 ${
                task.color === c ? "border-content" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              onClick={() => void updateTask(task.id, { color: c })}
            />
          ))}
          <button
            className="text-xs text-content-muted hover:text-content"
            onClick={() => void updateTask(task.id, { color: null })}
          >
            none
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-content-muted">
              Description (Markdown)
            </span>
            {!generated && (
              <button
                className="text-xs text-accent"
                onClick={() => {
                  if (!preview) commitDescription();
                  setPreview((v) => !v);
                }}
              >
                {preview ? "Edit" : "Preview"}
              </button>
            )}
          </div>
          {preview ? (
            <div
              className="prose-sm min-h-[80px] max-w-none select-text rounded-md border border-line bg-surface-alt px-3 py-2 text-sm [&_a]:text-accent [&_code]:rounded [&_code]:bg-line/50 [&_code]:px-1 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-4 [&_ol_li]:list-decimal [&_p]:my-1 [&_ul_li]:list-disc"
              onDoubleClick={() => !generated && setPreview(false)}
            >
              <ReactMarkdown
                components={{
                  // [[note]] links jump to the note; the modal closes
                  // (committing pending edits) since Notes takes over
                  a: ({ href, children }) => {
                    const wiki = href ? wikiTargetFromHref(href) : null;
                    if (wiki) {
                      return (
                        <a
                          href={href}
                          className="text-accent underline"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            commitAndClose();
                            void useAppStore
                              .getState()
                              .openKbNoteByName(wiki);
                          }}
                        >
                          {children}
                        </a>
                      );
                    }
                    return <a href={href}>{children}</a>;
                  },
                }}
              >
                {wikiToMarkdownLinks(description || "*No description*")}
              </ReactMarkdown>
            </div>
          ) : (
            <textarea
              className="input min-h-[80px] resize-y font-mono text-xs"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={commitDescription}
            />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-content-muted">Subtasks</span>
          {/* the add field sits above the rows: with a long subtask
              list it stays in view instead of scrolling away */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (subtaskTitle.trim()) {
                void createTask({
                  title: subtaskTitle.trim(),
                  parent_task_id: task.id,
                });
                setSubtaskTitle("");
              }
            }}
          >
            <input
              className="input w-full text-xs"
              placeholder="+ Add subtask"
              value={subtaskTitle}
              onChange={(e) => setSubtaskTitle(e.target.value)}
            />
          </form>
          {subtasks.map((sub) => (
            <SubtaskRow key={sub.id} sub={sub} />
          ))}
        </div>

        <div className="flex justify-between border-t border-line pt-3">
          <button
            className="text-sm text-danger hover:underline"
            onClick={() => {
              closedRef.current = true;
              void deleteTask(task.id);
              onClose();
            }}
          >
            Delete task
          </button>
          <button
            className="btn-primary"
            onClick={commitAndClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SubtaskRow({ sub }: { sub: Task }) {
  const updateTask = useAppStore((s) => s.updateTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(sub.title);

  const commit = () => {
    setEditing(false);
    const trimmed = title.trim();
    if (trimmed && trimmed !== sub.title) {
      void updateTask(sub.id, { title: trimmed });
    }
  };

  return (
    <div className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-1"
        style={{ accentColor: "var(--color-done)" }}
        checked={sub.status === "done"}
        onChange={() =>
          void updateTask(sub.id, {
            status: sub.status === "done" ? "todo" : "done",
          })
        }
      />
      {editing ? (
        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <input
            className="input w-full py-0.5 text-sm"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setTitle(sub.title);
                setEditing(false);
              }
            }}
          />
        </form>
      ) : (
        <span
          className={`flex-1 cursor-text ${
            sub.status === "done"
              ? "text-content-muted line-through"
              : sub.status === "postponed"
                ? "text-warn"
                : ""
          }`}
          title="Click to edit"
          onClick={() => {
            setTitle(sub.title);
            setEditing(true);
          }}
        >
          {sub.title}
        </span>
      )}
      <button
        className={`text-xs ${
          sub.status === "postponed"
            ? "text-warn"
            : "text-content-muted hover:text-warn"
        }`}
        title={sub.status === "postponed" ? "Back to To Do" : "Postpone"}
        onClick={() =>
          void updateTask(sub.id, {
            status: sub.status === "postponed" ? "todo" : "postponed",
          })
        }
      >
        →
      </button>
      <button
        className="text-xs text-content-muted hover:text-danger"
        onClick={() => void deleteTask(sub.id)}
      >
        ×
      </button>
    </div>
  );
}
