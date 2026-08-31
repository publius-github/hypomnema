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
import { compareTasks, splitDone, tintStyle } from "../lib/tasks";
import TaskCard from "./TaskCard";
import QuickAdd from "./QuickAdd";
import ListModal from "./ListModal";
import { ConfirmModal } from "./dialogs";
import type { List, Task } from "../types";

function ListColumn({
  list,
  onOpenTask,
  fill = false,
  highlight = false,
}: {
  list: List;
  onOpenTask: (id: number) => void;
  /** stretch to the parent's height (Lists page row alignment) */
  fill?: boolean;
  /** flash ring after a jump from the All-lists index */
  highlight?: boolean;
}) {
  const config = useAppStore((s) => s.config);
  const renameList = useAppStore((s) => s.renameList);
  const archiveList = useAppStore((s) => s.archiveList);
  const hold = useAppStore(useShallow((s) => s.statusHold));
  const { setNodeRef, isOver } = useDroppable({ id: `list:${list.id}` });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // A dated or starred manual task lives in BOTH places: on its day
  // column and still here in its list - one row, so closing it anywhere
  // closes it everywhere. Generated tasks (auto lists) stay day-only.
  // Shallow-compared selection, like DayColumn.
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
  // optional alphabetical order for the backlog (timed tasks still pin
  // to the top via compareTasks); manual drag order otherwise
  const alpha = config?.list_tasks_sort_alpha ?? false;
  const sorted = [...listTasks].sort((a, b) => {
    if (alpha) {
      if ((a.time === null) !== (b.time === null)) return a.time === null ? 1 : -1;
      const byTitle = a.title.localeCompare(b.title, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (byTitle !== 0) return byTitle;
    }
    return compareTasks(a, b);
  });
  const { active, postponed, done } = splitDone(
    sorted,
    config?.done_display ?? "inline",
    new Set(hold),
  );
  // priority tasks jump the queue: their own group on top of the column
  const prioritized = active.filter((t) => t.priority);
  const rest = active.filter((t) => !t.priority);

  // configurable vertical rhythm, same tokens the day columns use;
  // Postponed/Done sit behind list-specific gaps, separate from the
  // day-grid ones
  const taskGap = config?.task_gap ?? 6;
  const sectionGap = config?.section_gap ?? 12;

  const card = (task: Task) => (
    <TaskCard key={task.id} task={task} onOpen={onOpenTask} showList={false} />
  );
  // same plate style as the day-column section headers, optional color
  const section = (label: string, items: Task[], plateColor: string, gap: number) =>
    items.length > 0 && (
      <div
        className="flex flex-col"
        style={{ rowGap: taskGap, marginTop: gap }}
      >
        <div
          className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
            plateColor ? "" : "bg-line/40 text-content"
          }`}
          style={plateColor ? tintStyle(plateColor) : undefined}
        >
          <span>{label}</span>
          <span className="h-px flex-1 bg-current opacity-30" />
        </div>
        {items.map(card)}
      </div>
    );

  // double-click on free space (not on a card, button or input) opens
  // the list dialog, same as the ⋯ button
  const openOnFreeSpace = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setDetailsOpen(true);
  };

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-0 flex-col rounded-lg border ${
        isOver ? "border-accent" : "border-line"
      } bg-surface-alt/50 ${fill ? "h-full" : ""} ${
        highlight ? "ring-2 ring-accent" : ""
      }`}
      onDoubleClick={openOnFreeSpace}
    >
      <div
        className="group flex items-center gap-2 px-2.5 py-2"
        onDoubleClick={openOnFreeSpace}
      >
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
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-bold uppercase tracking-wide text-content hover:text-accent"
            onDoubleClick={() => {
              setName(list.name);
              setEditing(true);
            }}
            title={
              list.description
                ? `${list.description}\n\nDouble-click to rename`
                : "Double-click to rename"
            }
          >
            {list.color && (
              <span
                className="h-3 w-1 shrink-0 rounded"
                style={{ backgroundColor: list.color }}
              />
            )}
            <span className="truncate">{list.name}</span>
          </button>
        )}
        {/* the header controls share the star's size (text-base): the
            old mixed xs/sm buttons were too small to hit comfortably */}
        <button
          className="text-base leading-none text-content-muted opacity-0 hover:text-content focus-visible:opacity-100 group-hover:opacity-100"
          title="List settings: tasks, color, description, copy"
          onClick={() => setDetailsOpen(true)}
        >
          ⋯
        </button>
        <button
          className={`text-base leading-none ${
            list.favorite
              ? "text-warn"
              : "text-content-muted opacity-0 hover:text-warn focus-visible:opacity-100 group-hover:opacity-100"
          }`}
          title={
            list.favorite
              ? "Remove from favorites"
              : "Favorite: pin ahead of the other lists"
          }
          onClick={() => void useAppStore.getState().toggleListFavorite(list.id)}
        >
          {list.favorite ? "★" : "☆"}
        </button>
        <button
          className="text-base leading-none text-content-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
          title="Archive list"
          onClick={() => setConfirmArchive(true)}
        >
          ×
        </button>
      </div>
      {detailsOpen && (
        <ListModal list={list} onClose={() => setDetailsOpen(false)} />
      )}
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
      {/* no internal scrollbar: a long list grows past the viewport and
          the dashboard page scrollbar reaches it */}
      <div
        className="flex flex-1 flex-col px-2 pb-2"
        style={{ rowGap: taskGap }}
        onDoubleClick={openOnFreeSpace}
      >
        {/* the add field leads the column: with a long list of checked
            tasks the bottom is a scroll away, the top never is */}
        <QuickAdd target={{ list_id: list.id }} />
        {prioritized.length > 0 && (
          <div className="flex flex-col" style={{ rowGap: taskGap }}>
            <div className="flex items-center gap-1.5 rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-warn">
              <span>Priority</span>
              <span className="h-px flex-1 bg-warn/30" />
            </div>
            {prioritized.map(card)}
          </div>
        )}
        {rest.length > 0 && (
          // section gap after the priority block, so the starred tasks
          // read as their own section; the plain backlog block is
          // drag-sortable (times still pin tasks to the top)
          <div
            className="flex flex-col"
            style={{
              rowGap: taskGap,
              marginTop: prioritized.length > 0 ? sectionGap : undefined,
            }}
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
        {section(
          "Postponed",
          postponed,
          config?.postponed_plate_color ?? "",
          config?.list_postponed_section_gap ?? 12,
        )}
        {section(
          "Done",
          done,
          config?.done_plate_color ?? "",
          config?.list_done_section_gap ?? 12,
        )}
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
