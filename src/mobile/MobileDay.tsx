import { useMemo, useState } from "react";
import { useAppStore } from "../store";
import { addDaysISO, compareTasks } from "../lib/tasks";
import TaskRow from "./TaskRow";

/** How many days ahead the day view offers. */
const DAYS_AHEAD = 7;

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
 * The phone's main screen: one day at a time, swipeable by buttons rather
 * than a week-wide grid. Overdue tasks ride along with today, since a
 * task that slipped is about today whatever its date says.
 */
export default function MobileDay() {
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const today = useAppStore((s) => s.today);
  const tasks = useAppStore((s) => s.tasks);
  const createTask = useAppStore((s) => s.createTask);

  const date = addDaysISO(today, offset);
  const shown = useMemo(
    () =>
      tasks
        .filter((task) => task.scheduled_date === date && !task.parent_task_id)
        .sort(compareTasks),
    [tasks, date],
  );

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    void createTask({ title: trimmed, scheduled_date: date });
    setTitle("");
    setAdding(false);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <button
          onClick={() => setOffset((o) => o - 1)}
          aria-label="Previous day"
          className="px-2 py-1 text-lg text-content-muted"
        >
          ‹
        </button>
        <div className="min-w-0 text-center">
          <div className="truncate font-semibold">{dayLabel(date, today)}</div>
          <div className="text-xs text-content-muted">{date}</div>
        </div>
        <button
          onClick={() => setOffset((o) => Math.min(o + 1, DAYS_AHEAD))}
          aria-label="Next day"
          className="px-2 py-1 text-lg text-content-muted"
        >
          ›
        </button>
      </header>

      {shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-content-muted">
          Nothing scheduled.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto">
          {shown.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      )}

      <div className="border-t border-line p-3">
        {adding ? (
          <div className="flex gap-2">
            <input
              autoFocus
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
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-white"
          >
            + Add task
          </button>
        )}
      </div>
    </div>
  );
}
