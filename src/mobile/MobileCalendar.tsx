import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { compareTasks, todayISO } from "../lib/tasks";
import TaskRow from "./TaskRow";
import type { OutlookEvent } from "../types";

function monthStart(iso: string): Date {
  const [year, month] = iso.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function isoOf(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Monday-first, so the two weekend cells sit together at the end. */
function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * The month, to look at (REQUIREMENTS.md §6 scopes the phone's calendar
 * to browsing - rescheduling by dragging a card across a month grid is a
 * mouse gesture, and a thumb-sized month cell is not a drop target).
 *
 * Real tasks come from the store's snapshot; the fainter projections come
 * from `calendar_outlook`, the same read-only look-ahead the desktop
 * shows past the end of the generated horizon.
 */
export default function MobileCalendar() {
  const today = useAppStore((s) => s.today) || todayISO();
  const tasks = useAppStore((s) => s.tasks);
  const setError = useAppStore((s) => s.setError);
  const vaultVersion = useAppStore((s) => s.vaultVersion);
  const [cursor, setCursor] = useState(() => monthStart(today));
  const [selected, setSelected] = useState(today);
  const [outlook, setOutlook] = useState<OutlookEvent[]>([]);

  const first = cursor;
  const daysInMonth = new Date(
    first.getFullYear(),
    first.getMonth() + 1,
    0,
  ).getDate();
  const from = isoOf(first);
  const to = isoOf(
    new Date(first.getFullYear(), first.getMonth(), daysInMonth),
  );

  useEffect(() => {
    void invoke<OutlookEvent[]>("calendar_outlook", { from, to })
      .then(setOutlook)
      .catch((e) => setError(String(e)));
  }, [from, to, setError, vaultVersion]);

  const byDay = useMemo(() => {
    const map = new Map<string, { real: number; projected: number }>();
    for (const task of tasks) {
      if (!task.scheduled_date || task.parent_task_id) continue;
      const entry = map.get(task.scheduled_date) ?? { real: 0, projected: 0 };
      entry.real += 1;
      map.set(task.scheduled_date, entry);
    }
    for (const event of outlook) {
      const entry = map.get(event.date) ?? { real: 0, projected: 0 };
      entry.projected += 1;
      map.set(event.date, entry);
    }
    return map;
  }, [tasks, outlook]);

  const dayTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.scheduled_date === selected && !t.parent_task_id)
        .sort(compareTasks),
    [tasks, selected],
  );
  const dayProjections = outlook.filter((event) => event.date === selected);

  const cells: (string | null)[] = [
    ...Array<null>(weekdayIndex(first)).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      isoOf(new Date(first.getFullYear(), first.getMonth(), i + 1)),
    ),
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-line px-2 py-3">
        <button
          onClick={() =>
            setCursor(new Date(first.getFullYear(), first.getMonth() - 1, 1))
          }
          aria-label="Previous month"
          className="px-3 py-1 text-lg text-content-muted"
        >
          ‹
        </button>
        <span className="font-semibold">
          {first.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </span>
        <button
          onClick={() =>
            setCursor(new Date(first.getFullYear(), first.getMonth() + 1, 1))
          }
          aria-label="Next month"
          className="px-3 py-1 text-lg text-content-muted"
        >
          ›
        </button>
      </header>

      <div className="grid grid-cols-7 px-2 pt-2 text-center text-xs text-content-muted">
        {WEEKDAYS.map((day, i) => (
          <span key={`${day}-${i}`}>{day}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 p-2">
        {cells.map((iso, index) => {
          if (!iso) return <span key={`pad-${index}`} />;
          const counts = byDay.get(iso);
          const day = Number(iso.slice(8));
          return (
            <button
              key={iso}
              onClick={() => setSelected(iso)}
              className={`flex aspect-square flex-col items-center justify-center rounded-lg text-sm ${
                iso === selected
                  ? "bg-accent text-white"
                  : iso === today
                    ? "border border-accent"
                    : ""
              }`}
            >
              {day}
              <span className="flex h-1.5 items-center gap-0.5">
                {counts?.real ? (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      iso === selected ? "bg-white" : "bg-accent"
                    }`}
                  />
                ) : null}
                {counts?.projected ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-content-muted/60" />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto border-t border-line">
        {dayTasks.length === 0 && dayProjections.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-content-muted">
            Nothing on {selected}.
          </p>
        )}
        <ul>
          {dayTasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
        {dayProjections.length > 0 && (
          <div className="px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-content-muted">
              Expected
            </p>
            <ul className="mt-1">
              {dayProjections.map((event, index) => (
                <li
                  key={`${event.title}-${index}`}
                  className="break-words py-1 text-sm text-content-muted"
                >
                  {event.title}
                  <span className="ml-2 text-xs">{event.kind}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
