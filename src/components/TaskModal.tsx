import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useAppStore } from "../store";
import { compareTasks } from "../lib/tasks";
import type { Task, TaskStatus } from "../types";

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];

export default function TaskModal({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const { tasks, lists, updateTask, deleteTask, createTask } = useAppStore();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description_md);
  const [preview, setPreview] = useState(task.description_md.length > 0);
  const [subtaskTitle, setSubtaskTitle] = useState("");

  const subtasks = tasks
    .filter((t) => t.parent_task_id === task.id)
    .sort(compareTasks);

  const commitTitle = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      void updateTask(task.id, { title: trimmed });
    }
  };

  const commitDescription = () => {
    if (description !== task.description_md) {
      void updateTask(task.id, { description_md: description });
    }
  };

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-[560px] flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <input
            className="input flex-1 text-base font-medium"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
          />
          <button
            className="text-lg text-content-muted hover:text-content"
            onClick={onClose}
          >
            ×
          </button>
        </div>

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
              onChange={(e) =>
                void updateTask(task.id, {
                  list_id: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            >
              <option value="">No list</option>
              {lists.map((l) => (
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
              onChange={(e) =>
                void updateTask(task.id, { time: e.target.value || null })
              }
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
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
            <button
              className="text-xs text-accent"
              onClick={() => {
                if (!preview) commitDescription();
                setPreview((v) => !v);
              }}
            >
              {preview ? "Edit" : "Preview"}
            </button>
          </div>
          {preview ? (
            <div
              className="prose-sm min-h-[80px] max-w-none select-text rounded-md border border-line bg-surface-alt px-3 py-2 text-sm [&_a]:text-accent [&_code]:rounded [&_code]:bg-line/50 [&_code]:px-1 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-4 [&_ol_li]:list-decimal [&_p]:my-1 [&_ul_li]:list-disc"
              onDoubleClick={() => setPreview(false)}
            >
              <ReactMarkdown>{description || "*No description*"}</ReactMarkdown>
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
          {subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center gap-2 text-sm">
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
                className={`flex-1 ${
                  sub.status === "done"
                    ? "text-content-muted line-through"
                    : ""
                }`}
              >
                {sub.title}
              </span>
              <button
                className="text-xs text-content-muted hover:text-red-500"
                onClick={() => void deleteTask(sub.id)}
              >
                ×
              </button>
            </div>
          ))}
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
        </div>

        <div className="flex justify-between border-t border-line pt-3">
          <button
            className="text-sm text-red-500 hover:underline"
            onClick={() => {
              void deleteTask(task.id);
              onClose();
            }}
          >
            Delete task
          </button>
          <button
            className="rounded-md bg-accent px-4 py-1.5 text-sm text-white"
            onClick={() => {
              commitTitle();
              commitDescription();
              onClose();
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
