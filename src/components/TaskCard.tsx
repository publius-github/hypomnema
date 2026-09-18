import { useDraggable } from "@dnd-kit/core";
import { memo, useState } from "react";
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

function TaskCard({
  task,
  overlay = false,
  onOpen,
  showList = true,
  inert = false,
  titleLines = 1,
  blockIndex,
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
    (s) => s.config?.list_date_chip_color || "",
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
  // [SAT#1]-style marker for weekday-pinned recurring rules; rules
  // firing every day carry [EVERYDAY] behind its own toggle
  const dowLabel = useAppStore((s) =>
    (s.config?.cron_weekday_labels ?? true) &&
    (task.dow_label !== "EVERYDAY" || (s.config?.cron_everyday_label ?? true))
      ? task.dow_label
      : null,
  );
  const dowColor = useAppStore((s) => s.config?.dow_label_color || "");
  // habit-tracker view of a recurring item: its completion rate, loud
  // once it falls below the rule's threshold
  const habitRate = useAppStore((s) =>
    (s.config?.habit_rate_chip ?? true) &&
    task.origin === "recurring" &&
    task.rule_key
      ? (s.habitRates[task.rule_key] ?? null)
      : null,
  );
  const rateAlertColor = useAppStore(
    (s) => s.config?.habit_rate_alert_color || "#f97316",
  );

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
      className={`group rounded-md border border-line bg-surface-alt text-sm shadow-sm ${
        isDragging ? "opacity-30" : ""
      } ${overlay ? "shadow-lg" : ""}`}
    >
      {/* with a multi-line title everything else hugs the first line
          instead of centering against the whole block */}
      <div
        className={`flex gap-2 px-2 py-1 ${
          multiline ? "items-start" : "items-center"
        }`}
        title={tooltip}
      >
        {stripe && (
          <span
            className={`h-4 w-1 shrink-0 rounded ${multiline ? "mt-0.5" : ""}`}
            style={{ backgroundColor: stripe }}
          />
        )}
        <button
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
            multiline ? "mt-0.5" : ""
          } ${statusBoxClass(task.status)}`}
          style={statusBoxStyle(task.status)}
          title={`Status: ${STATUS_LABEL[task.status]} (click: ${STATUS_LABEL[nextStatus(task.status, checklist)]})`}
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
          <span
            className={`shrink-0 rounded px-1 font-medium ${
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
        {showList && listName && (
          // the list IS the category for engine-generated tasks, so it
          // reads as loud as the {Category} chip
          <span
            className="shrink-0 rounded px-1 font-semibold"
            style={{ ...tintStyle(listHue!), fontSize: chipSize }}
          >
            {listName}
          </span>
        )}
        {category && !multiline && (
          <span
            className="shrink-0 rounded px-1 font-semibold"
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
            className={`shrink-0 rounded px-1 font-medium ${
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
          className={`min-w-0 flex-1 cursor-pointer leading-snug ${
            multiline ? "break-words" : "truncate"
          } ${closed ? "text-content-muted line-through" : ""}`}
          // multi-line titles clamp at the configured line count
          // instead of truncating on the first line
          style={multiline ? clampStyle(titleLines) : undefined}
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
          {category && multiline && (
            <span
              className="inline-block rounded px-1 font-semibold"
              style={{ ...tintStyle(categoryHue!), fontSize: chipSize }}
              title={`Category: ${category}`}
            >
              {category}
            </span>
          )}
          {category && multiline && " "}
          {dowLabel && (
            // on a closed card the marker joins the struck-through muted
            // text instead of keeping its own bright color
            <span
              className="text-content-muted"
              style={dowColor && !closed ? { color: dowColor } : undefined}
              title="Weekday pinned by the rule's cron"
            >
              [{dowLabel}]{" "}
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
          {!overlay &&
            // any task can carry priority, generated ones included; in
            // a day column priority reads as a loud yellow label, in
            // a list column it stays a star toggle
            (task.priority && showList ? (
              <button
                className="rounded bg-warn/15 px-1 font-semibold uppercase text-warn"
                title="Remove priority"
                onClick={(e) => {
                  e.stopPropagation();
                  void updateTask(
                    task.id,
                    priorityPatch(task, false, useAppStore.getState().today),
                  );
                }}
              >
                priority
              </button>
            ) : (
              <button
                className={`text-base leading-none ${
                  task.priority
                    ? "text-warn"
                    : "opacity-0 hover:text-warn focus-visible:opacity-100 group-hover:opacity-100"
                }`}
                title={
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
            ))}
          {task.time && <span>{task.time}</span>}
          {task.overdue && !closed && (
            <span className="rounded bg-danger/15 px-1 font-semibold uppercase text-danger">
              overdue
            </span>
          )}
          {habitRate && (
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
          {!overlay && !closed && !checklist && (
            // "not done, dropped": off the plan without pretending it
            // was done - the review counts it as not done. The hold
            // keeps the card in place long enough to undo a misclick.
            <button
              className="text-base leading-none opacity-0 hover:text-content focus-visible:opacity-100 group-hover:opacity-100"
              title="Not done, drop it"
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
              className="text-base leading-none opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              title="Delete task"
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
      {expanded && subtasks.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line px-2 py-1.5 pl-7">
          {subtasks.map((sub) => (
            <div key={sub.id} className="group/sub flex items-start gap-1.5 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                style={{ accentColor: "var(--color-done)" }}
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
                onClick={(e) => {
                  e.stopPropagation();
                  void updateTask(sub.id, {
                    status: sub.status === "postponed" ? "todo" : "postponed",
                  });
                }}
              >
                →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// with targeted store merges, unchanged tasks keep their identity, so
// memo skips re-rendering the rest of the grid on a single-task change
export default memo(TaskCard);
