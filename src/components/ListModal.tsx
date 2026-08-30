import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { compareTasks } from "../lib/tasks";
import { ColorPicker } from "./form";
import type { List } from "../types";

/**
 * List dialog: rename, favorite, color (used as the card stripe of the
 * list's manual tasks and a dot on the column header), a free-text
 * description, and a copy of the whole backlog as a Markdown checklist.
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
  const [name, setName] = useState(list.name);
  const [color, setColor] = useState(list.color);
  const [description, setDescription] = useState(list.description);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const save = () => {
    if (name.trim() && name.trim() !== list.name) {
      void renameList(list.id, name.trim());
    }
    if (color !== list.color || description !== list.description) {
      void updateListMeta(list.id, { color, description });
    }
    onClose();
  };

  const copyTasks = async () => {
    const tasks = useAppStore
      .getState()
      .tasks.filter(
        (t) =>
          t.list_id === list.id &&
          (t.scheduled_date === null || t.priority) &&
          t.parent_task_id === null,
      )
      .sort(compareTasks);
    const text = tasks
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
        className="flex w-[440px] flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-xl"
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
    </div>
  );
}
