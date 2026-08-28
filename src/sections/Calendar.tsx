import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { todayISO } from "../lib/tasks";
import type { Task } from "../types";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function Calendar() {
  const { lists } = useAppStore();
  const today = todayISO();
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)) - 1);
  const [selected, setSelected] = useState(today);
  const [monthTasks, setMonthTasks] = useState<Task[]>([]);

  const monthStart = iso(year, month, 1);
  const nextMonthStart =
    month === 11 ? iso(year + 1, 0, 1) : iso(year, month + 1, 1);

  useEffect(() => {
    let cancelled = false;
    void invoke<Task[]>("tasks_snapshot", {
      startDate: monthStart,
      endDate: nextMonthStart,
    })
      .then((tasks) => {
        if (!cancelled) {
          setMonthTasks(
            tasks.filter(
              (t) =>
                t.parent_task_id === null &&
                t.scheduled_date !== null &&
                t.scheduled_date >= monthStart &&
                t.scheduled_date < nextMonthStart,
            ),
          );
        }
      })
      .catch((e) => useAppStore.setState({ error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [monthStart, nextMonthStart]);

  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of monthTasks) {
      const date = task.scheduled_date as string;
      map.set(date, [...(map.get(date) ?? []), task]);
    }
    return map;
  }, [monthTasks]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-first offset of the 1st
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const shiftMonth = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  const selectedTasks = byDate.get(selected) ?? [];
  const listName = (id: number | null) =>
    lists.find((l) => l.id === id)?.name ?? null;

  return (
    <div className="flex h-full">
      <div className="flex w-[380px] shrink-0 flex-col gap-3 border-r border-line p-4">
        <div className="flex items-center justify-between">
          <button
            className="rounded-md border border-line px-3 py-1 text-sm hover:border-accent hover:text-accent"
            onClick={() => shiftMonth(-1)}
          >
            &lt;
          </button>
          <button
            className="text-sm font-semibold hover:text-accent"
            title="Jump to today"
            onClick={() => {
              setYear(Number(today.slice(0, 4)));
              setMonth(Number(today.slice(5, 7)) - 1);
              setSelected(today);
            }}
          >
            {MONTHS[month]} {year}
          </button>
          <button
            className="rounded-md border border-line px-3 py-1 text-sm hover:border-accent hover:text-accent"
            onClick={() => shiftMonth(1)}
          >
            &gt;
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-content-muted">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (day === null) return <span key={`empty-${i}`} />;
            const date = iso(year, month, day);
            const dayTasks = byDate.get(date) ?? [];
            const doneCount = dayTasks.filter(
              (t) => t.status === "done",
            ).length;
            return (
              <button
                key={date}
                onClick={() => setSelected(date)}
                className={`flex h-12 flex-col items-center justify-center rounded-md border text-sm ${
                  selected === date
                    ? "border-accent bg-accent/15 text-accent"
                    : date === today
                      ? "border-accent/50"
                      : "border-line hover:border-content-muted"
                }`}
              >
                <span className={date === today ? "font-bold" : ""}>
                  {day}
                </span>
                {dayTasks.length > 0 && (
                  <span
                    className={`text-[10px] leading-none ${
                      doneCount === dayTasks.length
                        ? "text-accent"
                        : "text-content-muted"
                    }`}
                  >
                    {doneCount}/{dayTasks.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-content-muted">
          Done one-off tasks may be pruned by retention; pruned days show
          fewer tasks than were actually completed.
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
        <h2 className="text-sm font-semibold">{selected}</h2>
        {selectedTasks.length === 0 && (
          <p className="text-sm text-content-muted">
            No tasks recorded for this day.
          </p>
        )}
        {selectedTasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-2 rounded-md border border-line bg-surface-alt px-3 py-2 text-sm"
          >
            <span
              className={
                task.status === "done"
                  ? "text-accent"
                  : task.status === "postponed"
                    ? "text-amber-500"
                    : "text-content-muted"
              }
            >
              {task.status === "done"
                ? "✓"
                : task.status === "postponed"
                  ? "→"
                  : "○"}
            </span>
            <span
              className={`min-w-0 flex-1 truncate ${
                task.status === "done" ? "text-content-muted line-through" : ""
              }`}
            >
              {task.title}
            </span>
            {task.time && (
              <span className="text-xs text-content-muted">{task.time}</span>
            )}
            {listName(task.list_id) && (
              <span className="rounded bg-line/40 px-1.5 py-0.5 text-[11px] text-content-muted">
                {listName(task.list_id)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
