import { useMemo, useState } from "react";
import { useAppStore } from "../store";
import {
  addDaysISO,
  cadenceColor,
  categoryOf,
  compareTasks,
  currentAndNextBlock,
  daysBetweenISO,
  groupByCadence,
  splitDone,
  tintStyle,
} from "../lib/tasks";
import { useShallow } from "zustand/react/shallow";
import { useMobileNav } from "./nav";
import TaskRow from "./TaskRow";
import type { Task } from "../types";

function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDaysISO(today, 1)) return "Tomorrow";
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

/**
 * The phone's main screen: one day at a time, swipeable by buttons and a
 * date picker rather than a week-wide grid. The day drives the store's
 * grid offset - the same mechanism the desktop's date jump uses - so the
 * snapshot window follows wherever the day goes, past days included.
 *
 * Overdue tasks ride along with today, since a task that slipped is
 * about today whatever its date says.
 */
export default function MobileDay() {
  const [title, setTitle] = useState("");
  const today = useAppStore((s) => s.today);
  const tasks = useAppStore((s) => s.tasks);
  const createTask = useAppStore((s) => s.createTask);
  const offset = useAppStore((s) => s.gridOffset);
  const setGridOffset = useAppStore((s) => s.setGridOffset);
  const dashboard = useAppStore((s) => s.dashboard);
  const hold = useAppStore(useShallow((s) => s.statusHold));
  const { openSearch } = useMobileNav();

  const config = useAppStore((s) => s.config);
  const lists = useAppStore((s) => s.lists);

  const date = addDaysISO(today, offset);
  const shown = useMemo(
    () =>
      tasks
        .filter((task) => task.scheduled_date === date && !task.parent_task_id)
        .sort(compareTasks),
    [tasks, date],
  );

  // the same Postponed/Done separation the desktop's day column makes
  // (done_display "separate"), with the same brief hold so a just-tapped
  // row does not fly away under the finger
  const { active, postponed, waiting, done } = splitDone(
    shown,
    config?.done_display ?? "inline",
    new Map(hold.map((h) => [h.id, h.status])),
  );

  // the day's ambient context, same sources as the desktop column:
  // weekly focus, this day's reminders, and (today only) the schedule
  const reminders =
    dashboard?.days.find((d) => d.date === date)?.reminders ?? [];
  const schedule =
    date === today && dashboard
      ? currentAndNextBlock(dashboard.blocks, new Date())
      : null;
  const focus = dashboard?.focus ?? null;

  // The same cadence sections the desktop's day column uses, in the same
  // configured order. Without them a day is one undifferentiated column
  // of rows, which is the thing a phone can least afford: less room to
  // scan means the structure has to do more of the work, not less.
  //
  // Generated tasks carry their category as a list, so the grouping
  // label falls back to the list name - same rule as the day column.
  const taskCategory = (task: Task) => {
    const category = categoryOf(task.title);
    if (category) return category;
    return task.list_id === null
      ? null
      : (lists.find((l) => l.id === task.list_id)?.name ?? null);
  };
  const groups = useMemo(
    () => groupByCadence(active, config?.cadence_group_order, taskCategory),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, config?.cadence_group_order, lists],
  );

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    void createTask({ title: trimmed, scheduled_date: date });
    setTitle("");
  };

  const section = (label: string, items: Task[], plate: string | null) =>
    items.length > 0 && (
      <section>
        <h2
          className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wide ${
            plate ? "" : "bg-surface-alt text-content-muted"
          }`}
          style={plate ? tintStyle(plate) : undefined}
        >
          {label}
        </h2>
        <ul>
          {items.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-1 border-b border-line px-2 py-3">
        <button
          onClick={openSearch}
          aria-label="Search"
          className="px-2 py-1 text-lg text-content-muted"
        >
          ⌕
        </button>
        <button
          onClick={() => setGridOffset(offset - 1)}
          aria-label="Previous day"
          className="px-2 py-1 text-lg text-content-muted"
        >
          ‹
        </button>
        <div className="min-w-0 text-center">
          <div className="truncate font-semibold">{dayLabel(date, today)}</div>
          {/* the date doubles as a picker: any day, either direction */}
          <input
            type="date"
            value={date}
            onChange={(e) => {
              if (e.target.value)
                setGridOffset(daysBetweenISO(today, e.target.value));
            }}
            aria-label="Jump to date"
            className="border-none bg-transparent p-0 text-center text-xs text-content-muted outline-none"
          />
        </div>
        <button
          onClick={() => setGridOffset(offset + 1)}
          aria-label="Next day"
          className="px-2 py-1 text-lg text-content-muted"
        >
          ›
        </button>
        <button
          onClick={() => setGridOffset(0)}
          disabled={offset === 0}
          aria-label="Back to today"
          className="px-2 py-1 text-xs text-content-muted disabled:opacity-30"
        >
          Today
        </button>
      </header>

      {(focus || reminders.length > 0 || schedule) && (
        <div className="flex flex-col gap-0.5 border-b border-line px-4 py-2 text-xs text-content-muted">
          {focus && (
            <div>
              <span className="font-semibold uppercase tracking-wide text-accent">
                Focus{" "}
              </span>
              {focus}
            </div>
          )}
          {reminders.map((text, i) => (
            <div
              key={i}
              className="italic"
              style={
                config?.reminder_color
                  ? { color: config.reminder_color }
                  : undefined
              }
            >
              {text}
            </div>
          ))}
          {schedule?.current && (
            <div>
              <span className="font-medium text-accent">Now:</span>{" "}
              {schedule.current.label} (until {schedule.current.to})
            </div>
          )}
          {schedule?.next && (
            <div>
              <span className="font-medium">Next:</span> {schedule.next.label}{" "}
              at {schedule.next.from}
            </div>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        // flex-1 keeps the add row pinned to the bottom, where it sits
        // whenever the day has tasks - an input that jumps to mid-screen
        // on an empty day moves the one control this screen always has
        <p className="min-h-0 flex-1 px-4 py-8 text-center text-sm text-content-muted">
          Nothing scheduled.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {groups.map((group) => {
            const plate = cadenceColor(config, group.key);
            return (
              <section key={group.key}>
                <h2
                  className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wide ${
                    plate ? "" : "bg-surface-alt text-content-muted"
                  }`}
                  style={plate ? tintStyle(plate) : undefined}
                >
                  {group.label}
                </h2>
                <ul>
                  {group.tasks.map((task) => (
                    <TaskRow key={task.id} task={task} />
                  ))}
                </ul>
              </section>
            );
          })}
          {section(
            "Postponed",
            postponed,
            config?.postponed_plate_color || null,
          )}
          {section("Done, waiting", waiting, config?.waiting_plate_color || null)}
          {section("Done", done, config?.done_plate_color || null)}
        </div>
      )}

      {/* the same quiet input row the Lists screen ends with - a
          full-width accent button was the loudest thing on the screen */}
      <div className="flex gap-2 border-t border-line p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={`New task for ${dayLabel(date, today).toLowerCase()}`}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-alt px-3 py-2"
        />
        <button
          onClick={submit}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-white"
        >
          Add
        </button>
      </div>
    </div>
  );
}
