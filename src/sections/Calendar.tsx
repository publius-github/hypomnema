import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { todayISO } from "../lib/tasks";
import type { OutlookEvent, Task } from "../types";
import TaskModal from "../components/TaskModal";
import QuickAdd from "../components/QuickAdd";

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

// one dot per kind of thing happening that day: rule cadences, exact
// dates and birthdays each get a stable color
const KIND_DOT: Record<string, string> = {
  daily: "bg-zinc-400",
  weekly: "bg-blue-400",
  monthly: "bg-violet-400",
  yearly: "bg-amber-400",
  date: "bg-sky-400",
  birthday: "bg-pink-400",
  once: "bg-emerald-400",
};
const KIND_ORDER = Object.keys(KIND_DOT);

function taskKind(task: Task): string {
  if (task.origin === "scheduled") return "date";
  if (task.origin === "birthday") return "birthday";
  return task.cadence && task.cadence in KIND_DOT ? task.cadence : "once";
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function Calendar() {
  const lists = useAppStore((s) => s.lists);
  const today = todayISO();
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)) - 1);
  const [selected, setSelected] = useState(today);
  const [monthTasks, setMonthTasks] = useState<Task[]>([]);
  const [outlook, setOutlook] = useState<OutlookEvent[]>([]);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  // any task mutation anywhere refreshes the month view
  const storeTasks = useAppStore((s) => s.tasks);
  const vaultVersion = useAppStore((s) => s.vaultVersion);

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
      .catch((e) => useAppStore.getState().setError(String(e)));
    // projected occurrences beyond the grid horizon (Settings > Calendar
    // outlook controls how far each cadence reaches)
    void invoke<OutlookEvent[]>("calendar_outlook", {
      from: monthStart,
      to: nextMonthStart,
    })
      .then((events) => {
        if (!cancelled) setOutlook(events);
      })
      .catch(() => setOutlook([]));
    return () => {
      cancelled = true;
    };
  }, [monthStart, nextMonthStart, storeTasks, vaultVersion]);

  // keep the opened task fresh after edits made in the modal
  useEffect(() => {
    if (!openTask) return;
    const live = monthTasks.find((t) => t.id === openTask.id);
    if (live) {
      setOpenTask(live);
      return;
    }
    invoke<Task>("task_get", { id: openTask.id })
      .then(setOpenTask)
      .catch(() => setOpenTask(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthTasks]);

  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of monthTasks) {
      const date = task.scheduled_date as string;
      map.set(date, [...(map.get(date) ?? []), task]);
    }
    return map;
  }, [monthTasks]);

  const outlookByDate = useMemo(() => {
    const map = new Map<string, OutlookEvent[]>();
    for (const event of outlook) {
      map.set(event.date, [...(map.get(event.date) ?? []), event]);
    }
    return map;
  }, [outlook]);

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
  const selectedOutlook = outlookByDate.get(selected) ?? [];
  const listName = (id: number | null) =>
    lists.find((l) => l.id === id)?.name ?? null;

  return (
    <div className="flex h-full">
      <div className="flex w-[380px] shrink-0 flex-col gap-3 border-r border-line p-4">
        <div className="flex items-center justify-between">
          <button
            className="btn-ghost px-3 py-1"
            onClick={() => shiftMonth(-1)}
          >
            &lt;
          </button>
          <span className="text-sm font-semibold">
            {MONTHS[month]} {year}
          </span>
          <span className="flex items-center gap-1">
            <button
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => {
                setYear(Number(today.slice(0, 4)));
                setMonth(Number(today.slice(5, 7)) - 1);
                setSelected(today);
              }}
            >
              Today
            </button>
            <button
              className="btn-ghost px-3 py-1"
              onClick={() => shiftMonth(1)}
            >
              &gt;
            </button>
          </span>
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
            const projected = outlookByDate.get(date)?.length ?? 0;
            const doneCount = dayTasks.filter(
              (t) => t.status === "done",
            ).length;
            const kinds = new Set<string>([
              ...dayTasks.map(taskKind),
              ...(outlookByDate.get(date) ?? []).map((e) => e.kind),
            ]);
            const dots = KIND_ORDER.filter((k) => kinds.has(k)).slice(0, 5);
            return (
              <button
                key={date}
                onClick={() => setSelected(date)}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-md border text-sm ${
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
                {dayTasks.length > 0 ? (
                  <span
                    className={`text-[11px] leading-none ${
                      doneCount === dayTasks.length
                        ? "text-accent"
                        : "text-content-muted"
                    }`}
                  >
                    {doneCount}/{dayTasks.length}
                  </span>
                ) : (
                  projected > 0 && (
                    <span className="text-[11px] leading-none text-content-muted/60">
                      +{projected}
                    </span>
                  )
                )}
                {dots.length > 0 && (
                  <span className="flex gap-0.5">
                    {dots.map((k) => (
                      <span
                        key={k}
                        title={k}
                        className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[k]}`}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-content-muted">
          {KIND_ORDER.map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[k]}`} />
              {k}
            </span>
          ))}
        </div>
        <p className="text-xs text-content-muted">
          Done one-off tasks may be pruned by retention; pruned days show
          fewer tasks than were actually completed.
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
        <h2 className="text-sm font-semibold">{selected}</h2>
        {selectedTasks.length === 0 && selectedOutlook.length === 0 && (
          <p className="text-sm text-content-muted">
            No tasks recorded for this day.
          </p>
        )}
        {selectedTasks.map((task) => (
          <button
            key={task.id}
            className="flex items-center gap-2 rounded-md border border-line bg-surface-alt px-3 py-2 text-left text-sm hover:border-accent/60"
            onClick={() => setOpenTask(task)}
          >
            <span
              className={
                task.status === "done"
                  ? "text-accent"
                  : task.status === "postponed"
                    ? "text-warn"
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
          </button>
        ))}
        {selectedOutlook.length > 0 && (
          <>
            <div className="pt-2 text-[11px] font-medium uppercase tracking-wider text-content-muted">
              Projected
            </div>
            {selectedOutlook.map((event, i) => (
              <div
                key={`${event.title}-${i}`}
                className="flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-2 text-sm text-content-muted"
                title="Not generated yet; appears as a task when the date nears"
              >
                <span className="w-16 shrink-0 rounded bg-line/40 px-1.5 py-0.5 text-center text-[11px]">
                  {event.kind}
                </span>
                <span className="min-w-0 flex-1 truncate">{event.title}</span>
              </div>
            ))}
          </>
        )}
        <div className="pt-1">
          <QuickAdd target={{ scheduled_date: selected }} />
        </div>
      </div>
      {openTask && (
        <TaskModal task={openTask} onClose={() => setOpenTask(null)} />
      )}
    </div>
  );
}
