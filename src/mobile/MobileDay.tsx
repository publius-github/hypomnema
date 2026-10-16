import { useState } from "react";
import { useAppStore } from "../store";
import { addDaysISO, daysBetweenISO } from "../lib/tasks";
import { DayAmbientLines, useDayAmbient } from "../components/DayAmbient";
import { useBackStep } from "./back";
import DayHeader, { dayLabel, HeaderButton, SearchIcon } from "./DayHeader";
import { useDaySections } from "../hooks/useColumnSections";
import { useMobileNav } from "./nav";
import Sections from "./Sections";

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
  const { openSearch } = useMobileNav();

  const date = addDaysISO(today, offset);
  const sections = useDaySections(date);
  // hardware back from another day returns to today before the press
  // that closes the app
  useBackStep(offset !== 0, () => setGridOffset(0));

  // the day's ambient context, same sources as the desktop column:
  // weekly focus, this day's reminders, and (today only) the schedule
  const { reminders, schedule, focus } = useDayAmbient(date);

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    void createTask({ title: trimmed, scheduled_date: date });
    setTitle("");
  };

  return (
    <div className="flex h-full flex-col">
      <DayHeader
        date={date}
        today={today}
        onDate={(d) => setGridOffset(daysBetweenISO(today, d))}
        left={
          <HeaderButton label="Search" onClick={openSearch}>
            <SearchIcon />
          </HeaderButton>
        }
      />

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
          <DayAmbientLines reminders={reminders} schedule={schedule} />
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
          className="rounded-lg bg-accent-fill px-4 py-2 font-medium text-white"
        >
          Add
        </button>
      </div>
    </div>
  );
}
