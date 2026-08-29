import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";
import { compareTasks, splitDone } from "../lib/tasks";
import TaskCard from "./TaskCard";
import QuickAdd from "./QuickAdd";
import { ConfirmModal } from "./dialogs";
import type { List, Task } from "../types";

function ListColumn({
  list,
  onOpenTask,
}: {
  list: List;
  onOpenTask: (id: number) => void;
}) {
  const config = useAppStore((s) => s.config);
  const renameList = useAppStore((s) => s.renameList);
  const archiveList = useAppStore((s) => s.archiveList);
  const hold = useAppStore(useShallow((s) => s.statusHold));
  const { setNodeRef, isOver } = useDroppable({ id: `list:${list.id}` });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // A starred task lives in BOTH places: pinned to today's column and
  // still here in its list - one row, so closing it anywhere closes it
  // everywhere. Shallow-compared selection, like DayColumn.
  const listTasks = useAppStore(
    useShallow((s) =>
      s.tasks.filter(
        (t) =>
          t.list_id === list.id &&
          (t.scheduled_date === null || t.priority) &&
          t.parent_task_id === null,
      ),
    ),
  );
  const sorted = [...listTasks].sort(compareTasks);
  const { active, postponed, done } = splitDone(
    sorted,
    config?.done_display ?? "inline",
    new Set(hold),
  );
  // priority tasks jump the queue: their own group on top of the column
  const prioritized = active.filter((t) => t.priority);
  const rest = active.filter((t) => !t.priority);

  const card = (task: Task) => (
    <TaskCard key={task.id} task={task} onOpen={onOpenTask} showList={false} />
  );
  const section = (label: string, items: Task[]) =>
    items.length > 0 && (
      <div className="flex flex-col gap-1.5 border-t border-line pt-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-content-muted">
          {label}
        </div>
        {items.map(card)}
      </div>
    );

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-0 flex-col rounded-lg border ${
        isOver ? "border-accent" : "border-line"
      } bg-surface-alt/50`}
    >
      <div className="group flex items-center gap-1 px-2.5 py-2">
        {editing ? (
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void renameList(list.id, name);
              setEditing(false);
            }}
          >
            <input
              className="input w-full py-0.5 text-xs"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setEditing(false)}
            />
          </form>
        ) : (
          <button
            className="flex-1 truncate text-left text-sm font-bold uppercase tracking-wide text-content hover:text-accent"
            onDoubleClick={() => {
              setName(list.name);
              setEditing(true);
            }}
            title="Double-click to rename"
          >
            {list.name}
          </button>
        )}
        <button
          className="text-xs text-content-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
          title="Archive list"
          onClick={() => setConfirmArchive(true)}
        >
          ×
        </button>
      </div>
      {confirmArchive && (
        <ConfirmModal
          title={`Archive list "${list.name}"?`}
          message="The column disappears from the dashboard; its tasks stay in the database. Restore it from Settings > Maintenance."
          onConfirm={() => {
            setConfirmArchive(false);
            void archiveList(list.id);
          }}
          onCancel={() => setConfirmArchive(false)}
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
        {prioritized.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-warn">
              <span>Priority</span>
              <span className="h-px flex-1 bg-warn/30" />
            </div>
            {prioritized.map(card)}
          </div>
        )}
        {rest.length > 0 && (
          // double gap after the priority block, so the starred tasks
          // read as their own section; the plain backlog block is
          // drag-sortable (times still pin tasks to the top)
          <div
            className={`flex flex-col gap-1.5 ${
              prioritized.length > 0 ? "mt-3" : ""
            }`}
          >
            <SortableContext
              items={rest.map((t) => `task:${t.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {rest.map((task) => (
                <SortableCard key={task.id} task={task} onOpenTask={onOpenTask} />
              ))}
            </SortableContext>
          </div>
        )}
        {section("Postponed", postponed)}
        {section("Done", done)}
        <QuickAdd target={{ list_id: list.id }} />
      </div>
    </div>
  );
}

/**
 * Sortable wrapper owning the drag registration for a backlog card:
 * dragging reorders within the column, and dropping on a day column or
 * another list still moves the task (handled in Dashboard.onDragEnd).
 * Generated tasks stay non-draggable.
 */
function SortableCard({
  task,
  onOpenTask,
}: {
  task: Task;
  onOpenTask: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: `task:${task.id}`,
      disabled: task.origin !== "manual",
    });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-30" : ""}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} onOpen={onOpenTask} showList={false} inert />
    </div>
  );
}

export default memo(ListColumn);
