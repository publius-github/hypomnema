import { useDraggable } from "@dnd-kit/core";
import { taskCardKeyboard } from "./taskDnd";
import { memo, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";
import {
  cadenceColor,
  categoryChipColor,
  cadenceKeyOf,
  clampStyle,
  isClosed,
  isListExact,
  nextStatus,
  STATUS_LABEL,
  priorityPatch,
  sortSubtasks,
  splitCategory,
  tintStyle,
  weekdayShort,
} from "../lib/tasks";
import type { Task } from "../types";
import { StatusIcon, statusBoxClass, statusBoxStyle } from "./StatusMark";
import { readable, themeColors } from "../lib/color";
import DowLabelText from "./DowLabelText";

// Hover actions (priority star, drop, delete) are out of the layout until
// the card is hovered or focused; a card at least 17rem wide reserves
// their room instead, so the time and badges never shift on hover. A
// narrower one (the default 200px day column) cannot spare it from the
// title.
const HOVER_ACTION =
  "hidden group-focus-within:inline group-hover:inline @[17rem]:inline @[17rem]:invisible @[17rem]:group-focus-within:visible @[17rem]:group-hover:visible";

function TaskCard({
  task,
  overlay = false,
  onOpen,
  showList = true,
  inert = false,
  titleLines = 1,
  blockIndex,
  lineAbove = false,
  labelInHeader = false,
}: {
  task: Task;
  overlay?: boolean;
  onOpen?: (id: number) => void;
  /** off inside a list column, where the list is the column itself */
  showList?: boolean;
  /** the card registers no drag of its own (a sortable wrapper does) */
  inert?: boolean;
  /** how many lines the title may wrap to before it is cut off */
  titleLines?: number;
  /**
   * Ordinal of this card's category block in its column, counted by
   * the column itself (`categoryBlockIndex`). Only the alternating
   * chip palette uses it; a card outside a column leaves it unset.
   */
  blockIndex?: number;
  /** a row that opens a block also gets the hairline above it */
  lineAbove?: boolean;
  /**
   * The block's category header already names this row's category
   * (its {Category}, else its list), so the row drops that chip.
   */
  labelInHeader?: boolean;
}) {
  // selector subscriptions: with a whole-store subscribe, every toast or
  // banner change re-rendered every card on the grid
  const updateTask = useAppStore((s) => s.updateTask);
  const holdStatus = useAppStore((s) => s.holdStatus);
  const subtasksRaw = useAppStore(
    useShallow((s) => s.tasks.filter((t) => t.parent_task_id === task.id)),
  );
  // day columns group by cadence, so the list membership shows as a chip
  const listName = useAppStore((s) =>
    task.list_id === null
      ? null
      : (s.lists.find((l) => l.id === task.list_id)?.name ?? null),
  );
  // checklist lists have no postponed state: plain todo <-> done toggle
  const checklist = useAppStore((s) =>
    task.list_id !== null &&
    s.lists.find((l) => l.id === task.list_id)?.kind === "checklist",
  );
  const [expanded, setExpanded] = useState(false);
  const [subDraft, setSubDraft] = useState("");
  // generated tasks mirror their config file: dragging them to another
  // day or list would silently diverge from it, so they don't drag.
  // An inert card must not claim the shared task id: its sortable
  // wrapper owns it.
  const passive = overlay || inert;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: passive ? `task-static:${task.id}` : `task:${task.id}`,
    disabled: passive || task.origin !== "manual",
  });

  const subtasksDoneLast = useAppStore(
    (s) => s.config?.subtasks_done_last ?? true,
  );
  const subtasks = sortSubtasks(subtasksRaw, subtasksDoneLast);
  const closed = isClosed(task.status);
  // a {Category} prefix is a pure text label rendered as a chip
  const { category, text } = splitCategory(task.title);
  // cadence coloring reuses the manual color stripe; a manual color
  // wins, then the list's own color (manual tasks), then the cadence
  const cadColor = useAppStore((s) =>
    cadenceColor(s.config, cadenceKeyOf(task)),
  );
  const listColor = useAppStore((s) =>
    task.origin === "manual" && task.list_id !== null
      ? (s.lists.find((l) => l.id === task.list_id)?.color ?? null)
      : null,
  );
  // A dated list task is marked like the other Exact date tasks on its
  // DAY column. Inside its list the red signal is optional: the stripe
  // keeps the list color unless list_exact_stripe is on, and the date
  // chip color can be overridden (list_date_chip_color).
  const listExact = isListExact(task);
  const listExactStripe = useAppStore(
    (s) => s.config?.list_exact_stripe ?? false,
  );
  const listChipColor = useAppStore(
    (s) => themeColors(s.config)?.list_date_chip_color || "",
  );
  const exactStripeHere = listExact && (showList || listExactStripe);
  const stripe =
    task.color ??
    (exactStripeHere
      ? (cadColor ?? listColor)
      : (listColor ?? (listExact ? null : cadColor)));
  const dateChipColor =
    listExact && !showList ? listChipColor || cadColor : cadColor;
  // one hue per category (a list keeps the color of its own column)
  // unless the setting puts them all back on a single color. Both
  // selectors return a plain string, so memo still holds.
  const categoryHue = useAppStore((s) =>
    category ? categoryChipColor(category, s.lists, s.config, blockIndex) : null,
  );
  const listHue = useAppStore((s) =>
    listName ? categoryChipColor(listName, s.lists, s.config, blockIndex) : null,
  );
  // chips read at the size of the text they sit next to; 100% is
  // exactly the card's own text size (Settings > Task cards)
  const chipSize = useAppStore((s) => `${s.config?.chip_font_scale ?? 100}%`);
  // [SAT#1]-style marker for weekday-pinned recurring rules, and
  // [EVERYDAY] for rules firing every day
  const dowLabel = useAppStore((s) =>
    (s.config?.cron_weekday_labels ?? true) ? task.dow_label : null,
  );
  const dowColor = useAppStore((s) => themeColors(s.config)?.dow_label_color || "");
  // habit-tracker view of a recurring item: its completion rate, loud
  // once it falls below the rule's threshold
  const habitRate = useAppStore((s) =>
    (s.config?.habit_rate_display ?? "alert") !== "off" &&
    task.origin === "recurring" &&
    task.rule_key
      ? (s.habitRates[task.rule_key] ?? null)
      : null,
  );
  const rateAlertColor = useAppStore(
    (s) => themeColors(s.config)?.habit_rate_alert_color || "#c95e05",
  );
  const rateAlertOnly = useAppStore(
    (s) => (s.config?.habit_rate_display ?? "alert") === "alert",
  );
  const dowOpacity = useAppStore((s) => (s.config?.dow_label_opacity ?? 60) / 100);
  const hairlines = useAppStore((s) => s.config?.row_hairlines ?? false);
  // a closed row fades everything but its status box, which keeps
  // showing the status at full strength
  const closedOpacity = useAppStore((s) =>
    closed ? (s.config?.closed_row_opacity ?? 50) / 100 : 1,
  );
  const showListChip = showList && listName && !(labelInHeader && !category);
  const showCategoryChip = category && !labelInHeader;

  const exactDate = task.origin === "scheduled" || task.origin === "birthday";
  const tooltip = [
    task.title,
    listName ? `List: ${listName}` : null,
    exactDate && task.origin_date
      ? `Scheduled for ${task.origin_date}`
      : null,
    task.overdue && !closed ? "Overdue" : null,
    task.status !== "todo" && task.status !== "done"
      ? STATUS_LABEL[task.status]
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const multiline = titleLines > 1;

  const cycleStatus = () => {
    void updateTask(task.id, { status: nextStatus(task.status, checklist) });
    // hold the card in its current section for a moment so the next
    // checkbox click (or a fix of a misclick) is still possible
    holdStatus(task.id, task.status);
  };

  return (
    <div
      ref={passive ? undefined : setNodeRef}
      {...(passive ? {} : attributes)}
      {...(passive ? {} : listeners)}
      // a focused card opens on Enter, like a click on its title; Space
      // picks it up to move with the arrow keys (useTaskDnd's sensor)
      {...(passive
        ? {}
        : taskCardKeyboard(
            task.title,
            () => onOpen?.(task.id),
            listeners,
          ))}
      className={`group @container text-sm ${
        overlay
          ? // the drag overlay floats over the page, so it keeps a
            // frame and fill of its own
            "rounded-md border border-line bg-surface-alt shadow-lg"
          : // a plain list row, transparent: the column itself wears
            // the card fill, so rows and gaps share one work surface
            hairlines
            ? `border-b border-row-line ${lineAbove ? "border-t" : ""}`
            : ""
      } ${isDragging ? "opacity-30" : ""}`}
    >
      {/* with a multi-line title everything else hugs the first line
          instead of centering against the whole block */}
      <div
        className={`closed-dim flex gap-2 px-2 py-1 ${
          multiline ? "items-start" : "items-center"
        }`}
        style={{ "--closed-opacity": closedOpacity } as CSSProperties}
        title={tooltip}
      >
        {stripe && (
          <span
            className={`h-4 w-1 shrink-0 rounded-sm ${multiline ? "mt-0.5" : ""}`}
            style={{ backgroundColor: readable(stripe, "mark") }}
          />
        )}
        <button
          className={`status-box flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
            multiline ? "mt-0.5" : ""
          } ${statusBoxClass(task.status)}`}
          style={statusBoxStyle(task.status)}
          title={`Status: ${STATUS_LABEL[task.status]} (click: ${STATUS_LABEL[nextStatus(task.status, checklist)]})`}
          aria-label={`Status: ${STATUS_LABEL[task.status]} (click: ${STATUS_LABEL[nextStatus(task.status, checklist)]})`}
          onClick={(e) => {
            e.stopPropagation();
            cycleStatus();
          }}
        >
          <StatusIcon status={task.status} />
        </button>
        {listExact && task.scheduled_date && !multiline && (
          // the same date label the scheduled/birthday cards wear, ahead
          // of the list chip - in the day column AND in the list column
          // the one chip that gives way in a narrow column: it cuts off
          // (the full date stays in the tooltip) instead of pushing the
          // Overdue mark and the hover actions past the card edge
          <span
            className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded px-1 font-medium ${
              dateChipColor ? "" : "bg-info/15 text-info"
            }`}
            style={{
              ...(dateChipColor ? tintStyle(dateChipColor) : {}),
              fontSize: chipSize,
            }}
            title={`Scheduled for ${task.scheduled_date}`}
          >
            {weekdayShort(task.scheduled_date)} {task.scheduled_date}
          </span>
        )}
        {showListChip && (
          // the list IS the category for engine-generated tasks, so it
          // reads as loud as the {Category} chip
          <span
            className="shrink-0 rounded-sm px-1 font-semibold"
            style={{ ...tintStyle(listHue!), fontSize: chipSize }}
          >
            {listName}
          </span>
        )}
        {showCategoryChip && !multiline && (
          <span
            className="shrink-0 rounded-sm px-1 font-semibold"
            style={{ ...tintStyle(categoryHue!), fontSize: chipSize }}
            title={`Category: ${category}`}
          >
            {category}
          </span>
        )}
        {exactDate && task.origin_date && (
          // same color as the Exact date section plate these tasks
          // always live under
          <span
            className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded px-1 font-medium ${
              cadColor ? "" : "bg-info/15 text-info"
            }`}
            style={{
              ...(cadColor ? tintStyle(cadColor) : {}),
              fontSize: chipSize,
            }}
            title={`Scheduled for ${task.origin_date}`}
          >
            {weekdayShort(task.origin_date)} {task.origin_date}
          </span>
        )}
        <div
          // the floor keeps the hover actions from squeezing the title
          // to nothing in a narrow column (zero width is also where a
          // click stops reaching it)
          className={`min-w-12 flex-1 cursor-pointer leading-snug ${
            multiline ? "wrap-break-word" : "truncate"
          } ${closed ? "text-content-muted line-through" : ""}`}
          // multi-line titles clamp at the configured line count
          // instead of truncating on the first line
          style={multiline ? clampStyle(titleLines) : undefined}
          // the mouse path; the keyboard opens the card itself (Enter)
          role="presentation"
          onClick={() => onOpen?.(task.id)}
        >
          {/* on a wrapping title the chips flow inline with the text,
              so the second line wraps to the card edge instead of
              hanging indented by the chips' width */}
          {listExact && task.scheduled_date && multiline && (
            <span
              className={`inline-block rounded px-1 font-medium ${
                dateChipColor ? "" : "bg-info/15 text-info"
              }`}
              style={{
                ...(dateChipColor ? tintStyle(dateChipColor) : {}),
                fontSize: chipSize,
              }}
              title={`Scheduled for ${task.scheduled_date}`}
            >
              {weekdayShort(task.scheduled_date)} {task.scheduled_date}
            </span>
          )}
          {listExact && task.scheduled_date && multiline && " "}
          {showCategoryChip && multiline && (
            <span
              className="inline-block rounded-sm px-1 font-semibold"
              style={{ ...tintStyle(categoryHue!), fontSize: chipSize }}
              title={`Category: ${category}`}
            >
              {category}
            </span>
          )}
          {showCategoryChip && multiline && " "}
          {dowLabel && (
            // on a closed card the marker joins the struck-through muted
            // text instead of keeping its own bright color
            <span
              className="text-content-muted"
              // a picked color shows as picked; only the default muted
              // tone fades to dow_label_opacity
              style={
                dowColor && !closed
                  ? { color: readable(dowColor, "text") }
                  : { opacity: dowOpacity }
              }
              title="Weekday pinned by the rule's cron"
            >
              [<DowLabelText label={dowLabel} task={task} />]{" "}
            </span>
          )}
          {text}
        </div>
        <div
          className={`flex shrink-0 items-center gap-1.5 text-content-muted ${
            multiline ? "mt-0.5" : ""
          }`}
          style={{ fontSize: chipSize }}
        >
          {!overlay && task.priority && showList && (
            // in a day column priority reads as a loud yellow label
            <button
              className="rounded-sm bg-priority-plate px-1 text-sm font-semibold text-priority"
              title="Remove priority"
              onClick={(e) => {
                e.stopPropagation();
                void updateTask(
                  task.id,
                  priorityPatch(task, false, useAppStore.getState().today),
                );
              }}
            >
              Priority
            </button>
          )}
          {task.time && <span>{task.time}</span>}
          {task.overdue && !closed && (
            // a card narrower than 17rem has no room for the word once
            // the hover actions come in, so it shrinks to "!" meanwhile
            <span
              className="rounded-sm bg-danger/15 px-1 text-sm font-semibold text-danger"
              title="Overdue"
            >
              <span className="group-focus-within:@max-[17rem]:hidden group-hover:@max-[17rem]:hidden">
                Overdue
              </span>
              <span className="hidden group-focus-within:@max-[17rem]:inline group-hover:@max-[17rem]:inline">
                !
              </span>
            </span>
          )}
          {habitRate && (habitRate.alert || !rateAlertOnly) && (
            <span
              className={`whitespace-nowrap rounded px-1 ${
                habitRate.alert ? "font-semibold" : "bg-line/40"
              }`}
              style={
                habitRate.alert ? tintStyle(rateAlertColor) : undefined
              }
              title={`Done ${habitRate.done} of the last ${habitRate.total}; alert below ${habitRate.threshold}%`}
            >
              Rate: {habitRate.rate}%
            </span>
          )}
          {subtasks.length > 0 && (
            <button
              className="hover:text-content"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              {expanded ? "▾" : "▸"}{" "}
              {subtasks.filter((s) => s.status === "done").length}/
              {subtasks.length}
            </button>
          )}
          {/* hover actions close the row; in a card wide enough they
              keep their room while unseen, so nothing shifts on hover */}
          {!overlay && !(task.priority && showList) && (
            // a day column shows priority as the label above; a list
            // column keeps a star toggle
            <button
              className={`text-base leading-none ${
                task.priority
                  ? "text-priority"
                  : `${HOVER_ACTION} hover:text-priority`
              }`}
              title={
                task.priority
                  ? "Remove priority"
                  : "Priority: pin to today's column"
              }
              aria-label={
                task.priority
                  ? "Remove priority"
                  : "Priority: pin to today's column"
              }
              onClick={(e) => {
                e.stopPropagation();
                void updateTask(
                  task.id,
                  priorityPatch(
                    task,
                    !task.priority,
                    useAppStore.getState().today,
                  ),
                );
              }}
            >
              {task.priority ? "★" : "☆"}
            </button>
          )}
          {!overlay && !closed && !checklist && (
            // "not done, dropped": off the plan without pretending it
            // was done - the review counts it as not done. The hold
            // keeps the card in place long enough to undo a misclick.
            <button
              className={`${HOVER_ACTION} text-base leading-none hover:text-content`}
              title="Not done, drop it"
              aria-label="Not done, drop it"
              onClick={(e) => {
                e.stopPropagation();
                void updateTask(task.id, { status: "dropped" });
                holdStatus(task.id, task.status);
              }}
            >
              ⊘
            </button>
          )}
          {!overlay && (
            // hard delete, gone from the database; a deleted generated
            // instance of a still-live rule regenerates on the next
            // engine run - the config file is where a rule dies
            <button
              className={`${HOVER_ACTION} text-base leading-none hover:text-danger`}
              title="Delete task"
              aria-label="Delete task"
              onClick={(e) => {
                e.stopPropagation();
                void useAppStore.getState().deleteTask(task.id);
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="flex flex-col gap-1 border-t border-line px-2 py-1.5 pl-7">
          {subtasks.map((sub) => (
            <div key={sub.id} className="group/sub flex items-start gap-1.5 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                style={{ accentColor: "var(--hex-done)" }}
                checked={sub.status === "done"}
                onChange={() =>
                  void updateTask(sub.id, {
                    status: sub.status === "done" ? "todo" : "done",
                  })
                }
              />
              <span
                className={`flex-1 ${
                  isClosed(sub.status)
                    ? "text-content-muted line-through"
                    : sub.status === "postponed"
                      ? "text-warn"
                      : sub.status === "waiting"
                        ? "text-waiting"
                        : ""
                }`}
                title={
                  sub.status === "todo" ? undefined : STATUS_LABEL[sub.status]
                }
              >
                {sub.title}
              </span>
              {/* subtasks postpone too, same semantics as the task
                  dialog's arrow */}
              <button
                className={`shrink-0 px-1 text-base leading-none ${
                  sub.status === "postponed"
                    ? "text-warn"
                    : "text-content-muted opacity-0 hover:text-warn focus-visible:opacity-100 group-hover/sub:opacity-100"
                }`}
                title={
                  sub.status === "postponed" ? "Back to To Do" : "Postpone"
                }
                aria-label={
                  sub.status === "postponed" ? "Back to To Do" : "Postpone"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  void updateTask(sub.id, {
                    status: sub.status === "postponed" ? "todo" : "postponed",
                  });
                }}
              >
                →
              </button>
              {/* a subtask that is no longer needed goes entirely
                  (undone from the toast, like a task) */}
              <button
                className="shrink-0 px-1 text-base leading-none text-content-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover/sub:opacity-100"
                title="Delete subtask"
                aria-label={`Delete subtask ${sub.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void useAppStore.getState().deleteTask(sub.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
          {/* a subtask carries no list of its own; the parent's decides.
              Enter adds and keeps the field for the next one. */}
          <input
            value={subDraft}
            onChange={(e) => setSubDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key !== "Enter") return;
              const title = subDraft.trim();
              if (!title) return;
              void useAppStore
                .getState()
                .createTask({ title, parent_task_id: task.id });
              setSubDraft("");
            }}
            placeholder="+ Add subtask"
            aria-label="New subtask"
            className="mt-0.5 w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs placeholder:text-content-muted hover:border-line focus:border-line"
          />
        </div>
      )}
    </div>
  );
}

// with targeted store merges, unchanged tasks keep their identity, so
// memo skips re-rendering the rest of the grid on a single-task change
export default memo(TaskCard);
