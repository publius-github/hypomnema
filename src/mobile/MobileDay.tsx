import { useState } from "react";
import { useAppStore } from "../store";
import { addDaysISO, currentAndNextBlock, daysBetweenISO } from "../lib/tasks";
import { useDaySections } from "../hooks/useColumnSections";
import { useMobileNav } from "./nav";
import Sections from "./Sections";

function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDaysISO(today, 1)) return "Tomorrow";
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

/** The date under the day's name: "Wed, 14 Oct". */
function dateLine(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
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
 * The task list is the desktop day column's own layout
 * (`useDaySections`): the same cadence sections, plates, separator
 * stripes and Postponed / Done blocks, so a day reads the same on both.
 */
export default function MobileDay() {
  const [title, setTitle] = useState("");
  const today = useAppStore((s) => s.today);
  const createTask = useAppStore((s) => s.createTask);
  const offset = useAppStore((s) => s.gridOffset);
  const setGridOffset = useAppStore((s) => s.setGridOffset);
  const dashboard = useAppStore((s) => s.dashboard);
  const { openSearch } = useMobileNav();

  const config = useAppStore((s) => s.config);

  const date = addDaysISO(today, offset);
  const sections = useDaySections(date);

  // the day's ambient context, same sources as the desktop column:
  // weekly focus, this day's reminders, and (today only) the schedule
  const reminders =
    dashboard?.days.find((d) => d.date === date)?.reminders ?? [];
  const schedule =
    date === today && dashboard
      ? currentAndNextBlock(dashboard.blocks, new Date())
      : null;
  const focus = dashboard?.focus ?? null;

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    void createTask({ title: trimmed, scheduled_date: date });
    setTitle("");
  };

  return (
    <div className="flex h-full flex-col">
      {/* Three columns with equal side slots, so the day sits in the
          true centre whatever the side buttons hold */}
      <header className="grid grid-cols-[3rem_1fr_3rem] items-center border-b border-line px-1 py-1.5">
        <button
          onClick={openSearch}
          aria-label="Search"
          className="h-10 text-lg text-content-muted"
        >
          ⌕
        </button>
        <div className="flex min-w-0 items-center justify-center">
          <button
            onClick={() => setGridOffset(offset - 1)}
            aria-label="Previous day"
            className="h-10 w-10 shrink-0 text-xl text-content-muted"
          >
            ‹
          </button>
          {/* the label doubles as a picker: a transparent date input laid
              over it opens the system calendar, without the input's own
              mm/dd/yyyy field and dropdown arrow showing */}
          <label className="relative min-w-0 flex-1 text-center">
            <div className="truncate font-semibold leading-tight">
              {dayLabel(date, today)}
            </div>
            <div className="truncate text-xs leading-tight text-content-muted">
              {dateLine(date)}
            </div>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value)
                  setGridOffset(daysBetweenISO(today, e.target.value));
              }}
              aria-label="Jump to date"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
          <button
            onClick={() => setGridOffset(offset + 1)}
            aria-label="Next day"
            className="h-10 w-10 shrink-0 text-xl text-content-muted"
          >
            ›
          </button>
        </div>
        {/* only away from today; the slot stays so nothing shifts */}
        {offset !== 0 ? (
          <button
            onClick={() => setGridOffset(0)}
            aria-label="Back to today"
            className="h-10 text-xs font-medium text-accent"
          >
            Today
          </button>
        ) : (
          <span />
        )}
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

      {sections.length === 0 ? (
        // flex-1 keeps the add row pinned to the bottom, where it sits
        // whenever the day has tasks - an input that jumps to mid-screen
        // on an empty day moves the one control this screen always has
        <p className="min-h-0 flex-1 px-4 py-8 text-center text-sm text-content-muted">
          Nothing scheduled.
        </p>
      ) : (
        <Sections sections={sections} />
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
