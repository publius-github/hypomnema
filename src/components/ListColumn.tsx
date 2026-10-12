import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { memo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";
import {
  categoryBlockIndex,
  categoryOf,
  compareTasks,
  sortClosedAlpha,
  splitDone,
  listViewPlateStyle,
  tintStyle,
} from "../lib/tasks";
import TaskCard from "./TaskCard";
import QuickAdd from "./QuickAdd";
import GapHatch from "./GapHatch";
import ListModal from "./ListModal";
import { ConfirmModal } from "./dialogs";
import type { List, ListGroup, Task } from "../types";

function ListColumn({
  list,
  group = null,
  onOpenTask,
  onOpenGroup,
  fill = false,
  highlight = false,
  flat = false,
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
  /** tasks as hairline-separated list rows instead of boxed cards */
  flat?: boolean;
}) {
  const config = useAppStore((s) => s.config);
  const renameList = useAppStore((s) => s.renameList);
  const archiveList = useAppStore((s) => s.archiveList);
  const hold = useAppStore(useShallow((s) => s.statusHold));
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
  const split = splitDone(
    sorted,
    config?.done_display ?? "inline",
    new Map(hold.map((h) => [h.id, h.status])),
  );
  const { active } = split;
  const closedOrder = (items: Task[]) =>
    (config?.closed_sections_sort_alpha ?? true)
      ? sortClosedAlpha(items)
      : items;
  const postponed = closedOrder(split.postponed);
  const waiting = closedOrder(split.waiting);
  const done = closedOrder(split.done);
  // priority tasks jump the queue: their own group on top of the column
  const prioritized = active.filter((t) => t.priority);
  const rest = active.filter((t) => !t.priority);

  // configurable vertical rhythm, same tokens the day columns use;
  // Postponed/Done and the {Category} blocks sit behind list-specific
  // gaps, separate from the day-grid ones
  // list rows sit flush: the hairline under each one is the separator
  const taskGap = flat ? 0 : (config?.task_gap ?? 6);
  const sectionGap = config?.section_gap ?? 12;
  const categoryGap = config?.list_category_block_gap ?? 12;
  // list view: category and section gaps are hatched instead of left
  // empty, so a break reads apart from the hairline between rows
  const hatchGaps = flat && (config?.lists_gap_hatch ?? true);
  // list view: section plates, label included, grow to
  // list_view_plate_scale % of their normal size
  const plateSize = listViewPlateStyle(config, flat);

  // extra air where one {Category} block ends and the next begins, the
  // same rule the day columns follow; inside a list every task shares
  // the list, so only the {X} title prefix separates the blocks
  const gapBefore = (items: Task[], i: number) =>
    i > 0 && categoryOf(items[i].title) !== categoryOf(items[i - 1].title)
      ? categoryGap
      : undefined;

  // multi-line task titles in list columns (list_task_lines); the day
  // grid keeps its single truncated line
  const titleLines = config?.list_task_lines ?? 1;

  // one running counter for the alternating chip palette, over every
  // card of the column in render order (priority block, backlog,
  // Postponed, Waiting, Done) - inside a list only the {X} prefix is a category
  const blockIndex = categoryBlockIndex(
    [...prioritized, ...rest, ...postponed, ...waiting, ...done],
    (t: Task) => categoryOf(t.title),
  );

  const card = (task: Task, i: number, items: Task[], cadenceStripe = true) => {
    const gap = gapBefore(items, i);
    return (
      <div key={task.id} style={{ marginTop: hatchGaps ? undefined : gap }}>
        {hatchGaps && gap !== undefined && <GapHatch height={gap} />}
        <TaskCard
          task={task}
          onOpen={onOpenTask}
          showList={false}
          titleLines={titleLines}
          blockIndex={blockIndex.get(task.id)}
          flat={flat}
          // a block's first row also gets the line above it
          flatTop={i === 0 || gap !== undefined}
          cadenceStripe={cadenceStripe}
        />
      </div>
    );
  };
  // same plate style as the day-column section headers, optional color
  const section = (
    label: string,
    items: Task[],
    plateColor: string,
    gap: number,
    cadenceStripe: boolean,
  ) =>
    items.length > 0 && (
      <div
        className="flex flex-col"
        style={{ rowGap: taskGap, marginTop: hatchGaps ? undefined : gap }}
      >
        {hatchGaps && <GapHatch height={gap} />}
        <div
          className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
            plateColor ? "" : "bg-line/40 text-content"
          }`}
          style={{
            ...(plateColor ? tintStyle(plateColor) : {}),
            ...plateSize,
          }}
        >
          <span>{label}</span>
          <span className="h-px flex-1 bg-current opacity-30" />
        </div>
        {items.map((task, i) => card(task, i, items, cadenceStripe))}
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
      } ${flat ? "bg-surface-alt" : "bg-surface-alt/50"} ${fill ? "h-full" : ""} ${
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
                style={{ backgroundColor: list.color }}
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
        style={{ rowGap: taskGap }}
        onDoubleClick={openOnFreeSpace}
      >
        {/* the add field leads the column: with a long list of checked
            tasks the bottom is a scroll away, the top never is */}
        <QuickAdd target={{ list_id: list.id }} />
        {prioritized.length > 0 && (
          <div className="flex flex-col" style={{ rowGap: taskGap }}>
            <div
              className="flex items-center gap-1.5 rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-warn"
              style={plateSize}
            >
              <span>Priority</span>
              <span className="h-px flex-1 bg-warn/30" />
            </div>
            {prioritized.map((task, i) => card(task, i, prioritized))}
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
              marginTop:
                prioritized.length > 0 && !hatchGaps ? sectionGap : undefined,
            }}
          >
            {prioritized.length > 0 && hatchGaps && (
              <GapHatch height={sectionGap} />
            )}
            <SortableContext
              items={rest.map((t) => `task:${t.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {rest.map((task, i) => (
                <SortableCard
                  key={task.id}
                  task={task}
                  onOpenTask={onOpenTask}
                  titleLines={titleLines}
                  gapBefore={gapBefore(rest, i)}
                  blockIndex={blockIndex.get(task.id)}
                  flat={flat}
                  first={i === 0}
                  hatch={hatchGaps}
                />
              ))}
            </SortableContext>
          </div>
        )}
        {section(
          "Postponed",
          postponed,
          config?.postponed_plate_color ?? "",
          config?.list_postponed_section_gap ?? 12,
          config?.cadence_colors_postponed ?? true,
        )}
        {section(
          "Done, waiting",
          waiting,
          config?.waiting_plate_color ?? "",
          config?.list_waiting_section_gap ?? 12,
          config?.cadence_colors_waiting ?? true,
        )}
        {section(
          "Done",
          done,
          config?.done_plate_color ?? "",
          config?.list_done_section_gap ?? 12,
          config?.cadence_colors_done ?? true,
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
  titleLines,
  gapBefore,
  blockIndex,
  flat,
  first,
  hatch,
}: {
  task: Task;
  onOpenTask: (id: number) => void;
  titleLines: number;
  /** px of extra air before a new {Category} block */
  gapBefore?: number;
  /** ordinal of the card's category block, for the alternating palette */
  blockIndex?: number;
  /** list-row look, see TaskCard */
  flat: boolean;
  /** first row of the backlog block */
  first: boolean;
  /** draw the category gap as a hatch instead of empty space */
  hatch: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: `task:${task.id}`,
      disabled: task.origin !== "manual",
    });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        marginTop: hatch ? undefined : gapBefore,
      }}
      className={isDragging ? "opacity-30" : ""}
      {...attributes}
      {...listeners}
    >
      {hatch && gapBefore !== undefined && <GapHatch height={gapBefore} />}
      <TaskCard
        task={task}
        onOpen={onOpenTask}
        showList={false}
        inert
        titleLines={titleLines}
        blockIndex={blockIndex}
        flat={flat}
        flatTop={first || gapBefore !== undefined}
      />
    </div>
  );
}

export default memo(ListColumn);
