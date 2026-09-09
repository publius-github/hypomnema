import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";
import {
  categoryOf,
  clampStyle,
  compareTasks,
  nextStatus,
  priorityPatch,
} from "../lib/tasks";
import { ColorPicker } from "./form";
import TaskModal from "./TaskModal";
import type { List, Task } from "../types";

/**
 * List dialog: rename, favorite, color (used as the card stripe of the
 * list's manual tasks and a dot on the column header), a free-text
 * description, the list type (todo queue vs persistent checklist, with
 * check-all/uncheck-all bulk actions for checklists), a copy of the
 * whole backlog as a Markdown checklist, and the backlog itself - add,
 * check off, star, delete, and open any task (with its subtasks)
 * without leaving the dialog.
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
  const setListStatuses = useAppStore((s) => s.setListStatuses);
  const setListGroup = useAppStore((s) => s.setListGroup);
  const groups = useAppStore((s) => s.groups);
  const createTask = useAppStore((s) => s.createTask);
  const config = useAppStore((s) => s.config);
  const [name, setName] = useState(list.name);
  const [color, setColor] = useState(list.color);
  const [description, setDescription] = useState(list.description);
  const [kind, setKind] = useState(list.kind);
  const [groupId, setGroupId] = useState(list.group_id);
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
  // same done-hold the columns use: a just-clicked row stays in place
  // for a moment instead of flying to the bottom, so the next click of
  // the status cycle (or a misclick fix) is still possible
  const hold = useAppStore(useShallow((s) => s.statusHold));
  const held = new Map(hold.map((h) => [h.id, h.status]));
  const shown = (t: Task) => held.get(t.id) ?? t.status;
  // same order as the list column: optional alphabetical, done sinks
  const alpha = config?.list_tasks_sort_alpha ?? false;
  const sorted = [...listTasks].sort((a, b) => {
    const aDone = shown(a) === "done";
    const bDone = shown(b) === "done";
    if (aDone !== bDone) {
      return aDone ? 1 : -1;
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
    if (
      color !== list.color ||
      description !== list.description ||
      kind !== list.kind
    ) {
      void updateListMeta(list.id, { color, description, kind });
    }
    if (groupId !== list.group_id) {
      void setListGroup(list.id, groupId);
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-content-muted">Type</span>
          <select
            className="input py-1 text-xs"
            value={kind}
            onChange={(e) => setKind(e.target.value as List["kind"])}
            title="Todo: done tasks are swept overnight. Checklist: checked items stay until unchecked, no postponed state."
          >
            <option value="todo">Todo (done clears overnight)</option>
            <option value="checklist">Checklist (checked items stay)</option>
          </select>
          {kind === "checklist" && (
            <>
              <button
                className="rounded-md border border-line px-2 py-1 text-xs hover:border-accent hover:text-accent"
                title="Mark every item of this list as checked"
                onClick={() => void setListStatuses(list.id, true)}
              >
                Check all
              </button>
              <button
                className="rounded-md border border-line px-2 py-1 text-xs hover:border-accent hover:text-accent"
                title="Reset every item of this list to unchecked"
                onClick={() => void setListStatuses(list.id, false)}
              >
                Uncheck all
              </button>
            </>
          )}
        </div>
        {groups.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-content-muted">Group</span>
            <select
              className="input py-1 text-xs"
              value={groupId ?? ""}
              title="A grouped list leaves the panel and lives inside its group"
              onChange={(e) =>
                setGroupId(e.target.value === "" ? null : Number(e.target.value))
              }
            >
              <option value="">No group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}

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
          {sorted.map((task, i) => (
            <div
              key={task.id}
              // the column's {Category} rhythm, so the dialog shows the
              // same blocks the list column does
              style={{
                marginTop:
                  i > 0 &&
                  categoryOf(task.title) !== categoryOf(sorted[i - 1].title)
                    ? (config?.list_category_block_gap ?? 12)
                    : undefined,
              }}
            >
              <ListTaskRow
                task={task}
                checklist={list.kind === "checklist"}
                titleLines={config?.list_dialog_task_lines ?? 3}
                onOpen={() => setOpenTaskId(task.id)}
              />
            </div>
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
 * dialog), star, delete. The title wraps over up to `titleLines` lines
 * (list_dialog_task_lines) - the dialog is the roomy view of a list. */
function ListTaskRow({
  task,
  checklist,
  titleLines,
  onOpen,
}: {
  task: Task;
  /** checklist lists toggle todo <-> done, no postponed step */
  checklist: boolean;
  titleLines: number;
  onOpen: () => void;
}) {
  const updateTask = useAppStore((s) => s.updateTask);
  const holdStatus = useAppStore((s) => s.holdStatus);
  const subtasks = useAppStore(
    useShallow((s) => s.tasks.filter((t) => t.parent_task_id === task.id)),
  );
  const done = task.status === "done";
  const subDone = subtasks.filter((s) => s.status === "done").length;

  return (
    <div className="group flex items-start gap-2 rounded-md border border-line bg-surface-alt px-2 py-1 text-sm">
      {/* the same three-state cycle the task cards use, so a postponed
          task is visible here too, not just done/not-done */}
      <button
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          task.status === "postponed"
            ? "border-warn bg-warn text-white"
            : done
              ? "text-white"
              : "border-content-muted text-content-muted"
        }`}
        style={
          done
            ? {
                backgroundColor: "var(--color-done)",
                borderColor: "var(--color-done)",
              }
            : undefined
        }
        title={`Status: ${task.status} (click: ${nextStatus(task.status, checklist)})`}
        onClick={() => {
          void updateTask(task.id, {
            status: nextStatus(task.status, checklist),
          });
          holdStatus(task.id, task.status);
        }}
      >
        {done && (
          <svg
            viewBox="0 0 12 12"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M2.5 6.5l2.5 2.5l4.5 -5" />
          </svg>
        )}
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
      <button
        className={`min-w-0 flex-1 text-left ${
          titleLines > 1 ? "break-words" : "truncate"
        } ${
          done
            ? "text-content-muted line-through"
            : task.status === "postponed"
              ? "text-warn"
              : ""
        }`}
        style={titleLines > 1 ? clampStyle(titleLines) : undefined}
        title="Open task (subtasks, description, date)"
        onClick={onOpen}
      >
        {task.title}
      </button>
      {subtasks.length > 0 && (
        <span className="mt-0.5 shrink-0 text-[11px] text-content-muted">
          {subDone}/{subtasks.length}
        </span>
      )}
      {task.time && (
        <span className="mt-0.5 shrink-0 text-[11px] text-content-muted">
          {task.time}
        </span>
      )}
      <button
        className={`mt-0.5 shrink-0 text-base leading-none ${
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
        className="mt-0.5 shrink-0 text-base leading-none text-content-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
        title="Delete task"
        onClick={() => void useAppStore.getState().deleteTask(task.id)}
      >
        ×
      </button>
    </div>
  );
}
