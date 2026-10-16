import { useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import {
  addDaysISO,
  cadenceColor,
  cadenceKeyOf,
  categoryChipColor,
  daysBetweenISO,
  isListExact,
  nextStatus,
  nextWeekTarget,
  priorityPatch,
  sortSubtasks,
  splitCategory,
  STATUS_LABEL,
  tintStyle,
  weekdayShort,
  isClosed,
} from "../lib/tasks";
import {
  StatusIcon,
  statusBoxClass,
  statusBoxStyle,
} from "../components/StatusMark";
import { useEditTask } from "./editing";
import type { Task } from "../types";
import { readable } from "../lib/color";

/** A status badge in the row's right-hand column: small enough not to
 * outweigh the title, narrow enough for the column's fixed width. */
const BADGE =
  "whitespace-nowrap rounded px-1 text-[9px] font-semibold uppercase leading-4";

/**
 * One task, sized for a thumb and legible at a glance.
 *
 * The whole row steps the status the way the desktop card's checkbox
 * does (todo, done, postponed, done-waiting; a checklist toggles todo
 * and done), because that is what a task row is for ninety percent of
 * the time and aiming at a small checkbox on a moving bus is not a
 * design. Everything rarer hides behind the "..." button,
 * which opens actions inline rather than in a dialog - a modal over a
 * phone screen hides the very list the action refers to.
 *
 * It wears the desktop card's signals, in the card's order and with
 * the card's colour rules (`TaskCard` is the reference: a change there
 * lands here too): the colour stripe, the date chips, the list and
 * `{Category}` chips on the alternating palette, the weekday marker,
 * the PRIORITY / OVERDUE / Rate badges and the subtask count that folds
 * the subtasks open. A phone shows fewer tasks at once than a desktop,
 * not less distinguishable ones - only the geometry is the phone's own.
 */
export default function TaskRow({
  task,
  neighbours,
  showList = true,
  reviewWeekStart,
  blockIndex,
  lineAbove = false,
  labelInHeader = false,
}: {
  task: Task;
  /**
   * The rows above and below within a list, when there is an order to
   * change. Reordering is a list-column concept - a day column sorts
   * itself - so a day view simply does not pass them, and the two
   * actions stay off a screen where they would do nothing.
   */
  neighbours?: { previous?: number; next?: number };
  /** Off inside a list, where naming it on every row says nothing. */
  showList?: boolean;
  /**
   * Set by the Review screen: the Monday of the week under review. Its
   * presence adds the desktop Review's own leftover actions - push to
   * next week, drop back to the list backlog - to manual tasks.
   */
  reviewWeekStart?: string;
  /** ordinal of the row's category block, for the alternating palette */
  blockIndex?: number;
  /** a row that opens a block also gets the hairline above it */
  lineAbove?: boolean;
  /** the block header already names the row's category: no chip */
  labelInHeader?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const updateTask = useAppStore((s) => s.updateTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const holdStatus = useAppStore((s) => s.holdStatus);
  const reorderTask = useAppStore((s) => s.reorderTask);
  const tasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);
  const config = useAppStore((s) => s.config);
  const { setEditing } = useEditTask();

  const closed = isClosed(task.status);
  const subtasks = sortSubtasks(
    tasks.filter((t) => t.parent_task_id === task.id),
    config?.subtasks_done_last ?? true,
  );
  const subtasksDone = subtasks.filter((t) => t.status === "done").length;

  // A {Category} prefix is a label, not part of the title.
  const { category, text } = splitCategory(task.title);
  const list =
    task.list_id === null
      ? null
      : (lists.find((l) => l.id === task.list_id) ?? null);
  // checklist lists have no postponed state: plain todo <-> done
  const checklist = list?.kind === "checklist";

  // The card's stripe rule: a hand-picked colour wins, then the list's
  // own (manual tasks), then the cadence palette; a dated list task is
  // marked like the other Exact date tasks on a day, and inside its
  // list only under list_exact_stripe.
  const cadence = cadenceColor(config, cadenceKeyOf(task));
  const listColor = task.origin === "manual" ? (list?.color ?? null) : null;
  const listExact = isListExact(task);
  const exactStripeHere =
    listExact && (showList || (config?.list_exact_stripe ?? false));
  const stripe =
    task.color ??
    (exactStripeHere
      ? (cadence ?? listColor)
      : (listColor ?? (listExact ? null : cadence)));
  const dateChipColor =
    listExact && !showList
      ? config?.list_date_chip_color || cadence
      : cadence;

  const categoryHue = category
    ? categoryChipColor(category, lists, config, blockIndex)
    : null;
  const listHue = list
    ? categoryChipColor(list.name, lists, config, blockIndex)
    : null;
  const chipSize = `${config?.chip_font_scale ?? 100}%`;

  // Scheduled events and birthdays carry the date they came from.
  const exactDate = task.origin === "scheduled" || task.origin === "birthday";

  const dowLabel = (config?.cron_weekday_labels ?? true) ? task.dow_label : null;
  const dowColor = config?.dow_label_color || "";

  // the habit-tracker rate of a recurring item, loud below its threshold
  const habitRate = useAppStore((s) =>
    (s.config?.habit_rate_display ?? "alert") !== "off" &&
    task.origin === "recurring" &&
    task.rule_key
      ? (s.habitRates[task.rule_key] ?? null)
      : null,
  );
  const rateAlertColor = config?.habit_rate_alert_color || "#c95e05";
  const rateAlertOnly = (config?.habit_rate_display ?? "alert") === "alert";
  // a closed row fades everything but its status box
  const dim = closed ? (config?.closed_row_opacity ?? 50) / 100 : 1;

  const dateChip = (date: string, color: string | null | undefined) => (
    <span
      className={`shrink-0 rounded px-1 font-medium ${
        color ? "" : "bg-info/15 text-info"
      }`}
      style={{ ...(color ? tintStyle(color) : {}), fontSize: chipSize }}
    >
      {weekdayShort(date)} {date}
    </span>
  );

  const act = (patch: Parameters<typeof updateTask>[1]) => {
    setOpen(false);
    void updateTask(task.id, patch);
  };

  return (
    <li
      className={
        (config?.row_hairlines ?? false)
          ? `border-b border-line/60 ${lineAbove ? "border-t" : ""}`
          : ""
      }
    >
      <div className="flex items-stretch">
        {/* The stripe is the signal that survives a sideways glance, so
            it runs the full height of the row rather than sitting in it. */}
        <span
          aria-hidden
          className="w-1 shrink-0"
          style={{
            background:
              stripe ? readable(stripe, "mark") : "transparent",
            opacity: dim,
          }}
        />
        <button
          onClick={() => {
            // the hold keeps a just-tapped row in its section for a few
            // seconds (done_display "separate"), so a mistap can be
            // fixed before the row flies away
            holdStatus(task.id, task.status);
            void updateTask(task.id, {
              status: nextStatus(task.status, checklist),
            });
          }}
          aria-label={`Status: ${STATUS_LABEL[task.status]}`}
          className="flex min-w-0 flex-1 items-start gap-2.5 py-2 pl-2.5 pr-1 text-left"
        >
          <span
            aria-hidden
            className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded border ${statusBoxClass(
              task.status,
            )}`}
            style={statusBoxStyle(task.status)}
          >
            <StatusIcon status={task.status} />
          </span>
          <span className="min-w-0 flex-1" style={{ opacity: dim }}>
            <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
              {listExact &&
                task.scheduled_date &&
                dateChip(task.scheduled_date, dateChipColor)}
              {showList && list && listHue && !(labelInHeader && !category) && (
                // the list IS the category for engine-generated tasks,
                // so it reads as loud as the {Category} chip
                <span
                  className="shrink-0 rounded px-1 font-semibold"
                  style={{ ...tintStyle(listHue), fontSize: chipSize }}
                >
                  {list.name}
                </span>
              )}
              {category && categoryHue && !labelInHeader && (
                <span
                  className="shrink-0 rounded px-1 font-semibold"
                  style={{ ...tintStyle(categoryHue), fontSize: chipSize }}
                >
                  {category}
                </span>
              )}
              {exactDate &&
                task.origin_date &&
                dateChip(task.origin_date, cadence)}
              <span
                className={`min-w-0 break-words ${
                  closed ? "text-content-muted line-through" : ""
                }`}
              >
                {dowLabel && (
                  // on a closed row the marker joins the struck-through
                  // muted text instead of keeping its own colour
                  <span
                    className="text-content-muted"
                    style={
                      dowColor && !closed
                        ? { color: readable(dowColor, "text") }
                        : { opacity: (config?.dow_label_opacity ?? 60) / 100 }
                    }
                  >
                    [{dowLabel}]{" "}
                  </span>
                )}
                {text}
              </span>
              {task.priority && !showList && (
                // inside a list the Priority plate already says it, so a
                // star is enough
                <span className="text-warn">★</span>
              )}
              {task.time && (
                <span className="text-xs text-content-muted">{task.time}</span>
              )}
            </span>
          </span>
          {/* status badges sit in a column of their own on the right,
              reserved on every row: a badge riding the title's line
              wrapped under some titles and not others, so rows of the
              same list read differently */}
          <span
            className="ml-auto flex w-[3.25rem] shrink-0 flex-col items-end gap-0.5 pt-0.5"
            style={{ opacity: dim }}
          >
            {task.priority && showList && (
              <span className={`${BADGE} bg-warn/15 text-warn`}>priority</span>
            )}
            {task.overdue && !closed && (
              <span className={`${BADGE} bg-danger/15 text-danger`}>
                overdue
              </span>
            )}
            {habitRate && (habitRate.alert || !rateAlertOnly) && (
              <span
                title="Completion rate"
                className={`${BADGE} ${
                  habitRate.alert ? "" : "bg-line/40 text-content-muted"
                }`}
                style={habitRate.alert ? tintStyle(rateAlertColor) : undefined}
              >
                rate {habitRate.rate}%
              </span>
            )}
          </span>
        </button>
        {subtasks.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Hide subtasks" : "Show subtasks"}
            className="shrink-0 px-2 text-sm text-content-muted"
          >
            {expanded ? "▾" : "▸"} {subtasksDone}/{subtasks.length}
          </button>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Task actions"
          className="px-3 text-content-muted"
        >
          ⋯
        </button>
      </div>
      {expanded && subtasks.length > 0 && (
        <ul className="flex flex-col border-t border-line/60 py-1 pl-10 pr-2">
          {subtasks.map((sub) => (
            <li key={sub.id} className="flex items-center gap-2">
              <button
                onClick={() =>
                  void updateTask(sub.id, {
                    status: sub.status === "done" ? "todo" : "done",
                  })
                }
                className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm"
              >
                <span
                  aria-hidden
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${statusBoxClass(
                    sub.status,
                  )}`}
                  style={statusBoxStyle(sub.status)}
                >
                  <StatusIcon status={sub.status} />
                </span>
                <span
                  className={`min-w-0 break-words ${
                    isClosed(sub.status)
                      ? "text-content-muted line-through"
                      : sub.status === "postponed"
                        ? "text-warn"
                        : sub.status === "waiting"
                          ? "text-waiting"
                          : ""
                  }`}
                >
                  {sub.title}
                </span>
              </button>
              {/* subtasks postpone too, like the card's arrow */}
              <button
                onClick={() =>
                  void updateTask(sub.id, {
                    status: sub.status === "postponed" ? "todo" : "postponed",
                  })
                }
                aria-label={
                  sub.status === "postponed" ? "Back to To Do" : "Postpone"
                }
                className={`shrink-0 px-2 py-2 ${
                  sub.status === "postponed" ? "text-warn" : "text-content-muted"
                }`}
              >
                →
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          <Action
            label="Edit"
            onClick={() => {
              setOpen(false);
              // Calendar and Review rows can sit outside the store's day
              // window, and the editor resolves its task from the store:
              // move the window there first, like a search hit does
              const store = useAppStore.getState();
              if (
                task.scheduled_date &&
                !store.tasks.some((t) => t.id === task.id)
              ) {
                store.setGridOffset(
                  daysBetweenISO(store.today, task.scheduled_date),
                );
              }
              setEditing(task.id);
            }}
          />
          {/* Up and down rather than a long-press drag: dragging inside a
              scrolling list on a phone fights the scroll, and the gesture
              that wins is whichever the finger commits to first. Two
              buttons never guess. */}
          {neighbours?.previous !== undefined && (
            <Action
              label="Up"
              onClick={() => {
                setOpen(false);
                void reorderTask(task.id, neighbours.previous!);
              }}
            />
          )}
          {neighbours?.next !== undefined && (
            <Action
              label="Down"
              onClick={() => {
                setOpen(false);
                void reorderTask(task.id, neighbours.next!);
              }}
            />
          )}
          <Action
            label="Tomorrow"
            onClick={() => {
              // a past-dated leftover goes to the real tomorrow, not to
              // the day after its old date
              const today = useAppStore.getState().today;
              const from =
                task.scheduled_date && task.scheduled_date > today
                  ? task.scheduled_date
                  : today;
              act({ scheduled_date: addDaysISO(from, 1) });
            }}
          />
          {/* Review leftovers get the desktop Review's own two ways out;
              generated tasks keep their rule's date and list by design */}
          {reviewWeekStart && task.origin === "manual" && (
            <>
              <Action
                label="Next week"
                onClick={() =>
                  act({
                    scheduled_date: nextWeekTarget(
                      reviewWeekStart,
                      useAppStore.getState().today,
                    ),
                  })
                }
              />
              <Action
                label="Backlog"
                onClick={() => {
                  setOpen(false);
                  void (async () => {
                    let listId = task.list_id;
                    if (listId === null) {
                      // a listless task needs a home to be a backlog
                      // entry at all: the quick-capture Inbox
                      try {
                        listId = (await invoke("inbox_list")).id;
                      } catch (e) {
                        useAppStore.getState().setError(errorMessage(e));
                        return;
                      }
                    }
                    void updateTask(task.id, {
                      list_id: listId,
                      scheduled_date: null,
                    });
                  })();
                }}
              />
            </>
          )}
          {/* checklist items have no postponed state */}
          {!checklist && (
            <Action
              label="Postpone"
              onClick={() => act({ status: "postponed" })}
            />
          )}
          {/* "not done, dropped": off the plan without pretending it was
              done - the card's ⊘; the hold keeps the row in place */}
          {!closed && !checklist && (
            <Action
              label="Drop"
              onClick={() => {
                holdStatus(task.id, task.status);
                act({ status: "dropped" });
              }}
            />
          )}
          <Action
            label={task.priority ? "Unstar" : "Star"}
            onClick={() =>
              act(
                priorityPatch(
                  task,
                  !task.priority,
                  useAppStore.getState().today,
                ),
              )
            }
          />
          <Action
            label="Delete"
            danger
            onClick={() => {
              setOpen(false);
              void deleteTask(task.id);
            }}
          />
        </div>
      )}
    </li>
  );
}

function Action({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm ${
        danger ? "border-danger/50 text-danger" : "border-line"
      }`}
    >
      {label}
    </button>
  );
}
