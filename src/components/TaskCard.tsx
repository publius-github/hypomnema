import { useDraggable } from "@dnd-kit/core";
import { memo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";
import {
  cadenceColor,
  cadenceKeyOf,
  nextStatus,
  priorityPatch,
  sortSubtasks,
  splitCategory,
  tintStyle,
  weekdayShort,
} from "../lib/tasks";
import type { Task } from "../types";

// done takes the configurable checkbox color via the --color-done var
const STATUS_BUTTON: Record<Task["status"], string> = {
  todo: "border-content-muted text-content-muted",
  done: "text-white",
  postponed: "border-warn bg-warn text-white",
};

const DONE_BUTTON_STYLE = {
  backgroundColor: "var(--color-done)",
  borderColor: "var(--color-done)",
};

function TaskCard({
  task,
  overlay = false,
  onOpen,
  showList = true,
  inert = false,
}: {
  task: Task;
  overlay?: boolean;
  onOpen?: (id: number) => void;
  /** off inside a list column, where the list is the column itself */
  showList?: boolean;
  /** the card registers no drag of its own (a sortable wrapper does) */
  inert?: boolean;
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
  const done = task.status === "done";
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
  const stripe = task.color ?? listColor ?? cadColor;
  const categoryColor = useAppStore(
    (s) => s.config?.category_color ?? "#3b82f6",
  );
  // [SAT#1]-style marker for weekday-pinned recurring rules
  const dowLabel = useAppStore((s) =>
    (s.config?.cron_weekday_labels ?? true) ? task.dow_label : null,
  );
  const dowColor = useAppStore((s) => s.config?.dow_label_color || "");
  const chipStyle = tintStyle(categoryColor);
  const exactDate = task.origin === "scheduled" || task.origin === "birthday";
  const tooltip = [
    task.title,
    listName ? `List: ${listName}` : null,
    exactDate && task.origin_date
      ? `Scheduled for ${task.origin_date}`
      : null,
    task.overdue && !done ? "Overdue" : null,
    task.status === "postponed" ? "Postponed" : null,
  ]
    .filter(Boolean)
    .join("\n");

  const cycleStatus = () => {
    const next = nextStatus(task.status);
    void updateTask(task.id, { status: next });
    // hold a just-completed/postponed card in place for a moment so the
    // next checkbox click (or a fix of a misclick) is still possible
    if (next !== "todo") holdStatus(task.id);
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
      <div className="flex items-center gap-2 px-2 py-1" title={tooltip}>
        {stripe && (
          <span
            className="h-4 w-1 shrink-0 rounded"
            style={{ backgroundColor: stripe }}
          />
        )}
        <button
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${STATUS_BUTTON[task.status]}`}
          style={done ? DONE_BUTTON_STYLE : undefined}
          title={`Status: ${task.status} (click: ${nextStatus(task.status)})`}
          onClick={(e) => {
            e.stopPropagation();
            cycleStatus();
          }}
        >
          {/* an SVG check sits dead-center; the ✓ glyph rode on its
              font baseline and looked shifted inside the box */}
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
        {showList && listName && (
          // the list IS the category for engine-generated tasks, so it
          // reads as loud as the {Category} chip
          <span
            className="shrink-0 rounded px-1 text-[11px] font-semibold"
            style={chipStyle}
          >
            {listName}
          </span>
        )}
        {category && (
          <span
            className="shrink-0 rounded px-1 text-[11px] font-semibold"
            style={chipStyle}
            title={`Category: ${category}`}
          >
            {category}
          </span>
        )}
        {exactDate && task.origin_date && (
          // same color as the Exact date section plate these tasks
          // always live under
          <span
            className={`shrink-0 rounded px-1 text-[11px] font-medium ${
              cadColor ? "" : "bg-info/15 text-info"
            }`}
            style={cadColor ? tintStyle(cadColor) : undefined}
            title={`Scheduled for ${task.origin_date}`}
          >
            {weekdayShort(task.origin_date)} {task.origin_date}
          </span>
        )}
        <div
          className={`min-w-0 flex-1 cursor-pointer truncate leading-snug ${
            done ? "text-content-muted line-through" : ""
          }`}
          onClick={() => onOpen?.(task.id)}
        >
          {dowLabel && (
            <span
              className="text-content-muted"
              style={dowColor ? { color: dowColor } : undefined}
              title="Weekday pinned by the rule's cron"
            >
              [{dowLabel}]{" "}
            </span>
          )}
          {text}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-content-muted">
          {!overlay &&
            // priority is a manual-task concept (custom lists and the
            // General section); generated tasks mirror their config
            task.origin === "manual" &&
            // in a day column priority reads as a loud yellow label; in
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
          {task.overdue && !done && (
            <span className="rounded bg-danger/15 px-1 font-semibold uppercase text-danger">
              overdue
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
          {!overlay && (
            // delete with the undo toast; a deleted generated instance
            // never regenerates for the same period (its next period
            // still fires - that is the rule working as configured)
            <button
              className="text-sm leading-none opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
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
            <label key={sub.id} className="flex items-start gap-1.5 text-xs">
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
                className={
                  sub.status === "done"
                    ? "text-content-muted line-through"
                    : sub.status === "postponed"
                      ? "text-warn"
                      : ""
                }
                title={sub.status === "postponed" ? "Postponed" : undefined}
              >
                {sub.title}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// with targeted store merges, unchanged tasks keep their identity, so
// memo skips re-rendering the rest of the grid on a single-task change
export default memo(TaskCard);
