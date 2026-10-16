import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo, useState } from "react";
import { useAppStore } from "../store";
import {
  useListSections,
  type ColumnRow,
} from "../hooks/useColumnSections";
import TaskCard from "./TaskCard";
import QuickAdd from "./QuickAdd";
import SectionBlock, {
  labelInHeader,
  RowLead,
} from "./ColumnSection";
import ListModal from "./ListModal";
import { ConfirmModal } from "./dialogs";
import type { List, ListGroup } from "../types";
import { readable } from "../lib/color";

function ListColumn({
  list,
  group = null,
  onOpenTask,
  onOpenGroup,
  fill = false,
  highlight = false,
}: {
  list: List;
  /**
   * The list's group, when the panel is showing grouped lists as their
   * own columns (`lists_group_display: flat`): the header wears it as a
   * chip, so a flat panel still says where a list belongs.
   */
  group?: ListGroup | null;
  onOpenTask: (id: number) => void;
  /** drill into the chip's group; absent = the chip is not clickable */
  onOpenGroup?: (groupId: number) => void;
  /** stretch to the parent's height (Lists page row alignment) */
  fill?: boolean;
  /** flash ring after a jump from the All-lists index */
  highlight?: boolean;
}) {
  const config = useAppStore((s) => s.config);
  const renameList = useAppStore((s) => s.renameList);
  const archiveList = useAppStore((s) => s.archiveList);
  const { setNodeRef, isOver } = useDroppable({ id: `list:${list.id}` });
  // the header's grip drags the whole list, not a task: dropping it on a
  // group tile (or on the group view's back bar) changes its membership.
  // Its own draggable id keeps the two kinds of drag apart in onDragEnd.
  const grip = useDraggable({ id: `listmove:${list.id}`, disabled: list.auto });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // A dated or starred manual task lives in BOTH places: on its day
  // column and still here in its list - one row, so closing it anywhere
  // closes it everywhere. Generated tasks (auto lists) stay day-only.
  // Shallow-compared selection, like DayColumn.
  // Priority, the backlog, Postponed / Done, waiting / Done / Dropped with the
  // List view's stripes - the same layout the phone's list screen renders
  const sections = useListSections(list);
  const titleLines = config?.list_task_lines ?? 1;

  const card = (row: ColumnRow) => (
    <div key={row.task.id}>
      <RowLead row={row} />
      <TaskCard
        task={row.task}
        onOpen={onOpenTask}
        showList={false}
        titleLines={titleLines}
        blockIndex={row.blockIndex}
        lineAbove={row.lineAbove}
        labelInHeader={labelInHeader(config, row)}
      />
    </div>
  );

  const openOnFreeSpace = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setDetailsOpen(true);
  };

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-0 flex-col rounded-lg border ${
        isOver ? "border-accent" : "border-line"
      } bg-surface-alt ${fill ? "h-full" : ""} ${
        highlight ? "ring-2 ring-accent" : ""
      } ${grip.isDragging ? "opacity-40" : ""}`}
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
                style={{ backgroundColor: readable(list.color, "mark") }}
              />
            )}
            <span className="truncate">{list.name}</span>
          </button>
        )}
        {group && (
          <button
            className="max-w-[45%] shrink-0 truncate rounded border border-line px-1 py-px text-[10px] uppercase tracking-wide text-content-muted hover:border-accent hover:text-accent"
            title={`In group "${group.name}"${onOpenGroup ? " - click to open it" : ""}`}
            onClick={() => onOpenGroup?.(group.id)}
          >
            {group.name}
          </button>
        )}
        {/* the header controls share the star's size (text-base): the
            old mixed xs/sm buttons were too small to hit comfortably */}
        {!list.auto && (
          <button
            ref={grip.setNodeRef}
            {...grip.attributes}
            {...grip.listeners}
            className="cursor-grab text-base leading-none text-content-muted opacity-0 hover:text-content focus-visible:opacity-100 group-hover:opacity-100"
            title="Drag onto a group to move this list into it"
          >
            ⠿
          </button>
        )}
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
          onClick={() =>
            void useAppStore.getState().toggleListFavorite(list.id)
          }
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
          message="The column disappears from the dashboard; its tasks stay in the database. Restore it from Settings > Data."
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
        onDoubleClick={openOnFreeSpace}
      >
        {/* the add field leads the column: with a long list of checked
            tasks the bottom is a scroll away, the top never is */}
        <QuickAdd target={{ list_id: list.id }} />
        {sections.map((section) => (
          <SectionBlock key={section.key} section={section}>
            {section.key === "rest" ? (
              // the backlog is the one block a drag reorders
              <SortableContext
                items={section.rows.map((r) => `task:${r.task.id}`)}
                strategy={verticalListSortingStrategy}
              >
                {section.rows.map((row) => (
                  <SortableCard
                    key={row.task.id}
                    row={row}
                    onOpenTask={onOpenTask}
                    titleLines={titleLines}
                    labelInHeader={labelInHeader(config, row)}
                  />
                ))}
              </SortableContext>
            ) : (
              section.rows.map(card)
            )}
          </SectionBlock>
        ))}
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
  row,
  onOpenTask,
  titleLines,
  labelInHeader,
}: {
  row: ColumnRow;
  onOpenTask: (id: number) => void;
  titleLines: number;
  labelInHeader: boolean;
}) {
  const { task, blockIndex, lineAbove } = row;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `task:${task.id}`,
    disabled: task.origin !== "manual",
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={isDragging ? "opacity-30" : ""}
      {...attributes}
      {...listeners}
    >
      <RowLead row={row} />
      <TaskCard
        task={task}
        onOpen={onOpenTask}
        showList={false}
        inert
        titleLines={titleLines}
        blockIndex={blockIndex}
        lineAbove={lineAbove}
        labelInHeader={labelInHeader}
      />
    </div>
  );
}

export default memo(ListColumn);
