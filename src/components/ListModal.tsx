import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";
import { compareTasks, priorityPatch } from "../lib/tasks";
import { ColorPicker } from "./form";
import TaskModal from "./TaskModal";
import type { List, Task } from "../types";

/**
 * List dialog: rename, favorite, color (used as the card stripe of the
 * list's manual tasks and a dot on the column header), a free-text
 * description, a copy of the whole backlog as a Markdown checklist, and
 * the backlog itself - add, check off, star, delete, and open any task
 * (with its subtasks) without leaving the dialog.
 */
export default function ListModal({
  list,
  onClose,
}: {
  list: List;
  onClose: () => void;
}) {
  const renameList = useAppStore((s) => s.renameList);
  const updateListMeta = useAppStore((s) => s.updateListMeta);
  const toggleListFavorite = useAppStore((s) => s.toggleListFavorite);
  const createTask = useAppStore((s) => s.createTask);
  const config = useAppStore((s) => s.config);
  const [name, setName] = useState(list.name);
  const [color, setColor] = useState(list.color);
  const [description, setDescription] = useState(list.description);
  const [copied, setCopied] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);

  const listTasks = useAppStore(
    useShallow((s) =>
      s.tasks.filter(
        (t) =>
          t.list_id === list.id &&
          (t.scheduled_date === null || t.priority || t.origin === "manual") &&
          t.parent_task_id === null,
      ),
    ),
  );
  // same order as the list column: optional alphabetical, done sinks
  const alpha = config?.list_tasks_sort_alpha ?? false;
  const sorted = [...listTasks].sort((a, b) => {
    if ((a.status === "done") !== (b.status === "done")) {
      return a.status === "done" ? 1 : -1;
    }
    if (alpha) {
      const byTitle = a.title.localeCompare(b.title, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (byTitle !== 0) return byTitle;
    }
    return compareTasks(a, b);
  });
  const openTask = sorted.find((t) => t.id === openTaskId) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // with the task dialog open on top, Escape belongs to it: let the
      // event through to its own listener and keep this dialog up
      if (openTaskId !== null) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, openTaskId]);

  const save = () => {
    if (name.trim() && name.trim() !== list.name) {
      void renameList(list.id, name.trim());
    }
    if (color !== list.color || description !== list.description) {
      void updateListMeta(list.id, { color, description });
    }
    onClose();
  };

  const addTask = () => {
    const title = newTitle.trim();
    if (!title) return;
    void createTask({ title, list_id: list.id });
    setNewTitle("");
  };

  const copyTasks = async () => {
    const text = sorted
      .map((t) => `- [${t.status === "done" ? "x" : " "}] ${t.title}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-full w-[560px] flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">List</span>
          <button
            className={`ml-auto text-base leading-none ${
              list.favorite ? "text-warn" : "text-content-muted hover:text-warn"
            }`}
            title={list.favorite ? "Remove from favorites" : "Favorite"}
            onClick={() => void toggleListFavorite(list.id)}
          >
            {list.favorite ? "★" : "☆"}
          </button>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-content-muted">Name</span>
          <input
            className="input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-content-muted">Color</span>
          <ColorPicker
            value={color ?? "#3b82f6"}
            onChange={(c) => setColor(c)}
          />
          {color ? (
            <button
              className="text-xs text-content-muted hover:text-content"
              onClick={() => setColor(null)}
            >
              clear
            </button>
          ) : (
            <span className="text-xs text-content-muted">none</span>
          )}
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-content-muted">Description</span>
          <textarea
            className="input min-h-[72px] w-full resize-y"
            value={description}
            placeholder="What this list is for"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-content-muted">
            Tasks ({sorted.length})
          </span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addTask();
            }}
          >
            <input
              className="input w-full text-xs"
              placeholder="+ Add task"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </form>
          {sorted.map((task) => (
            <ListTaskRow
              key={task.id}
              task={task}
              onOpen={() => setOpenTaskId(task.id)}
            />
          ))}
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent"
            title="Copy the backlog as a Markdown checklist"
            onClick={() => void copyTasks()}
          >
            {copied ? "Copied" : "Copy tasks"}
          </button>
          <div className="flex gap-2">
            <button
              className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-content-muted"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="btn-primary px-3" onClick={save}>
              Save
            </button>
          </div>
        </div>
      </div>
      {openTask && (
        <TaskModal task={openTask} onClose={() => setOpenTaskId(null)} />
      )}
    </div>
  );
}

/** Compact backlog row: check off, open (subtasks live in the task
 * dialog), star, delete. */
function ListTaskRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const updateTask = useAppStore((s) => s.updateTask);
  const subtasks = useAppStore(
    useShallow((s) => s.tasks.filter((t) => t.parent_task_id === task.id)),
  );
  const done = task.status === "done";
  const subDone = subtasks.filter((s) => s.status === "done").length;

  return (
    <div className="group flex items-center gap-2 rounded-md border border-line bg-surface-alt px-2 py-1 text-sm">
      <input
        type="checkbox"
        style={{ accentColor: "var(--color-done)" }}
        checked={done}
        onChange={() =>
          void updateTask(task.id, { status: done ? "todo" : "done" })
        }
      />
      <button
        className={`min-w-0 flex-1 truncate text-left ${
          done ? "text-content-muted line-through" : ""
        }`}
        title="Open task (subtasks, description, date)"
        onClick={onOpen}
      >
        {task.title}
      </button>
      {subtasks.length > 0 && (
        <span className="shrink-0 text-[11px] text-content-muted">
          {subDone}/{subtasks.length}
        </span>
      )}
      {task.time && (
        <span className="shrink-0 text-[11px] text-content-muted">
          {task.time}
        </span>
      )}
      <button
        className={`shrink-0 text-base leading-none ${
          task.priority
            ? "text-warn"
            : "text-content-muted opacity-0 hover:text-warn focus-visible:opacity-100 group-hover:opacity-100"
        }`}
        title={task.priority ? "Remove priority" : "Priority: pin to today"}
        onClick={() =>
          void updateTask(
            task.id,
            priorityPatch(task, !task.priority, useAppStore.getState().today),
          )
        }
      >
        {task.priority ? "★" : "☆"}
      </button>
      <button
        className="shrink-0 text-base leading-none text-content-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
        title="Delete task"
        onClick={() => void useAppStore.getState().deleteTask(task.id)}
      >
        ×
      </button>
    </div>
  );
}
