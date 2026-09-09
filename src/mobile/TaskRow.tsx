import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import {
  addDaysISO,
  cadenceColor,
  cadenceKeyOf,
  categoryChipColor,
  isListExact,
  nextWeekTarget,
  splitCategory,
  tintStyle,
  weekdayShort,
} from "../lib/tasks";
import { useEditTask } from "./editing";
import type { List, Task } from "../types";

/**
 * One task, sized for a thumb and legible at a glance.
 *
 * The whole row toggles done, because that is what a task row is for
 * ninety percent of the time and aiming at a small checkbox on a moving
 * bus is not a design. Everything rarer hides behind the "..." button,
 * which opens actions inline rather than in a dialog - a modal over a
 * phone screen hides the very list the action refers to.
 *
 * It wears the desktop's signals rather than quieter ones of its own:
 * the colour stripe (a hand-picked colour, else the list's, else the
 * cadence palette), the `{Category}` chip, the list chip, the date chip
 * and the weekday marker. A phone shows fewer tasks at once than a
 * desktop, not less distinguishable ones - a wall of identical rows is
 * harder to read on a small screen, not easier.
 */
export default function TaskRow({
  task,
  neighbours,
  showList = true,
  reviewWeekStart,
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
}) {
  const [open, setOpen] = useState(false);
  const updateTask = useAppStore((s) => s.updateTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const holdStatus = useAppStore((s) => s.holdStatus);
  const reorderTask = useAppStore((s) => s.reorderTask);
  const tasks = useAppStore((s) => s.tasks);
  const lists = useAppStore((s) => s.lists);
  const config = useAppStore((s) => s.config);
  const { setEditing } = useEditTask();

  const done = task.status === "done";
  const subtasks = tasks.filter((t) => t.parent_task_id === task.id);
  const subtasksDone = subtasks.filter((t) => t.status === "done").length;

  // A {Category} prefix is a label, not part of the title.
  const { category, text } = splitCategory(task.title);
  const list =
    task.list_id === null
      ? null
      : (lists.find((l) => l.id === task.list_id) ?? null);

  // Same precedence the desktop card uses: a hand-picked colour wins,
  // then the list's own, then the cadence palette.
  const cadence = cadenceColor(config, cadenceKeyOf(task));
  const listColor = task.origin === "manual" ? (list?.color ?? null) : null;
  const stripe = task.color ?? listColor ?? cadence;

  const categoryHue = category
    ? categoryChipColor(category, lists, config)
    : null;
  const listHue = list ? categoryChipColor(list.name, lists, config) : null;
  const chipSize = `${config?.chip_font_scale ?? 100}%`;

  // Scheduled events and birthdays carry the date they came from; a
  // dated list task wears the same label wherever it is shown.
  const dateLabel =
    task.origin === "scheduled" || task.origin === "birthday"
      ? task.origin_date
      : isListExact(task)
        ? task.scheduled_date
        : null;

  const dowLabel =
    (config?.cron_weekday_labels ?? true) &&
    (task.dow_label !== "EVERYDAY" || (config?.cron_everyday_label ?? true))
      ? task.dow_label
      : null;

  const act = (patch: Parameters<typeof updateTask>[1]) => {
    setOpen(false);
    void updateTask(task.id, patch);
  };

  return (
    <li className="border-b border-line/60">
      <div className="flex items-stretch">
        {/* The stripe is the signal that survives a sideways glance, so
            it runs the full height of the row rather than sitting in it. */}
        <span
          aria-hidden
          className="w-1 shrink-0"
          style={{ background: stripe ?? "transparent" }}
        />
        <button
          onClick={() => {
            // the hold keeps a just-tapped row in its section for a few
            // seconds (done_display "separate"), so a mistap can be
            // fixed before the row flies away
            holdStatus(task.id, task.status);
            void updateTask(task.id, { status: done ? "todo" : "done" });
          }}
          className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-3 pr-1 text-left"
        >
          <span
            aria-hidden
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
              done
                ? "border-accent bg-accent text-white"
                : "border-line text-transparent"
            }`}
          >
            ✓
          </span>
          <span className="min-w-0">
            <span
              className={`flex flex-wrap items-baseline gap-x-1.5 gap-y-1 ${
                done ? "text-content-muted line-through" : ""
              }`}
            >
              {dowLabel && (
                <span
                  className="shrink-0 font-medium"
                  style={{
                    color: config?.dow_label_color || undefined,
                    fontSize: chipSize,
                  }}
                >
                  [{dowLabel}]
                </span>
              )}
              {dateLabel && (
                <span
                  className={`shrink-0 rounded px-1 font-medium ${
                    cadence ? "" : "bg-info/15 text-info"
                  }`}
                  style={{
                    ...(cadence ? tintStyle(cadence) : {}),
                    fontSize: chipSize,
                  }}
                >
                  {weekdayShort(dateLabel)} {dateLabel}
                </span>
              )}
              {category && categoryHue && (
                <span
                  className="shrink-0 rounded px-1 font-semibold"
                  style={{ ...tintStyle(categoryHue), fontSize: chipSize }}
                >
                  {category}
                </span>
              )}
              {showList && list && listHue && (
                <span
                  className="shrink-0 rounded px-1 font-semibold"
                  style={{ ...tintStyle(listHue), fontSize: chipSize }}
                >
                  {list.name}
                </span>
              )}
              <span className="min-w-0 break-words">{text}</span>
            </span>
            <span className="mt-0.5 flex flex-wrap gap-2 text-xs text-content-muted">
              {task.time && <span>{task.time}</span>}
              {subtasks.length > 0 && (
                <span>
                  {subtasksDone}/{subtasks.length}
                </span>
              )}
              {task.overdue && !done && (
                <span className="text-warn">overdue</span>
              )}
              {task.priority && <span className="text-accent">★</span>}
              {task.status === "postponed" && <span>postponed</span>}
            </span>
          </span>
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Task actions"
          className="px-4 text-content-muted"
        >
          ⋯
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          <Action
            label="Edit"
            onClick={() => {
              setOpen(false);
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
            onClick={() =>
              act({
                scheduled_date: addDaysISO(
                  task.scheduled_date ?? useAppStore.getState().today,
                  1,
                ),
              })
            }
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
                        listId = (await invoke<List>("inbox_list")).id;
                      } catch (e) {
                        useAppStore.getState().setError(String(e));
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
          {list?.kind !== "checklist" && (
            <Action
              label="Postpone"
              onClick={() => act({ status: "postponed" })}
            />
          )}
          <Action
            label={task.priority ? "Unstar" : "Star"}
            onClick={() => act({ priority: !task.priority })}
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
