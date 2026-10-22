import { useAppStore } from "../store";
import { readable, themeColors } from "../lib/color";
import { currentAndNextBlock } from "../lib/tasks";

/**
 * A day's ambient context from the dashboard context: its day-type
 * reminders and, for today only, the day schedule's current and next
 * block, plus the week's focus phrase. One source for the desktop day
 * column and the phone's day.
 */
export function useDayAmbient(date: string) {
  const dashboard = useAppStore((s) => s.dashboard);
  const today = useAppStore((s) => s.today);
  const reminders =
    dashboard?.days.find((d) => d.date === date)?.reminders ?? [];
  const schedule =
    date === today && dashboard
      ? currentAndNextBlock(dashboard.blocks, new Date())
      : null;
  return { reminders, schedule, focus: dashboard?.focus ?? null };
}

/** The reminder and Now / Next lines of `useDayAmbient`; the caller
 *  owns the box around them (its padding and text size). */
export function DayAmbientLines({
  reminders,
  schedule,
}: Omit<ReturnType<typeof useDayAmbient>, "focus">) {
  const reminderColor = useAppStore((s) => themeColors(s.config)?.reminder_color);
  return (
    <>
      {reminders.map((text, i) => (
        <div
          key={i}
          className="italic"
          style={
            reminderColor
              ? { color: readable(reminderColor, "text") }
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
    </>
  );
}
