import { useEffect, useMemo, useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import { splitCategory, todayISO, weekdayShort } from "../lib/tasks";
import type { DailyStreak, Task } from "../types";
import TaskModal from "../components/TaskModal";
import NavArrow from "../components/NavArrow";

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

const ORIGIN_LABELS: Record<string, string> = {
  manual: "manual",
  recurring: "recurring",
  scheduled: "scheduled",
  birthday: "birthdays",
};

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Read-only browser over past work: month completion stats, per-rule
 * daily streaks, and the completed tasks grouped by day. Retention
 * pruning removes old done tasks, so months past the retention window
 * show less than was actually completed.
 */
export default function History() {
  const lists = useAppStore((s) => s.lists);
  const vaultVersion = useAppStore((s) => s.vaultVersion);
  const today = todayISO();
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)) - 1);
  const [monthTasks, setMonthTasks] = useState<Task[]>([]);
  const [streaks, setStreaks] = useState<DailyStreak[]>([]);
  const [listFilter, setListFilter] = useState<number | "all">("all");
  const [openTask, setOpenTask] = useState<Task | null>(null);

  const monthStart = iso(year, month, 1);
  const nextMonthStart =
    month === 11 ? iso(year + 1, 0, 1) : iso(year, month + 1, 1);

  useEffect(() => {
    let cancelled = false;
    void invoke("tasks_snapshot", {
      startDate: monthStart,
      endDate: nextMonthStart,
    })
      .then((tasks) => {
        if (cancelled) return;
        setMonthTasks(
          tasks.filter(
            (t) =>
              t.parent_task_id === null &&
              t.scheduled_date !== null &&
              t.scheduled_date >= monthStart &&
              t.scheduled_date < nextMonthStart,
          ),
        );
      })
      .catch((e) => useAppStore.getState().setError(errorMessage(e)));
    void invoke("daily_streaks")
      .then((s) => {
        if (!cancelled) setStreaks(s);
      })
      .catch((e) => {
        useAppStore.getState().setError(errorMessage(e));
        setStreaks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [monthStart, nextMonthStart, vaultVersion]);

  const filtered = useMemo(
    () =>
      listFilter === "all"
        ? monthTasks
        : monthTasks.filter((t) => t.list_id === listFilter),
    [monthTasks, listFilter],
  );
  // only days that already happened count toward the completion rate;
  // planned future tasks of the current month are not "missed" yet
  const past = useMemo(
    () => filtered.filter((t) => (t.scheduled_date as string) <= today),
    [filtered, today],
  );
  const done = useMemo(
    () => past.filter((t) => t.status === "done"),
    [past],
  );
  const rate = past.length > 0 ? Math.round((done.length / past.length) * 100) : null;
  const byOrigin = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of done) {
      map.set(t.origin, (map.get(t.origin) ?? 0) + 1);
    }
    return map;
  }, [done]);

  const doneByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of done) {
      const date = t.scheduled_date as string;
      map.set(date, [...(map.get(date) ?? []), t]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [done]);

  const shiftMonth = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  const listName = (id: number | null) =>
    id === null ? null : (lists.find((l) => l.id === id)?.name ?? null);

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-center gap-2">
        <NavArrow
          dir={-1}
          title="Previous month"
          onClick={() => shiftMonth(-1)}
        />
        <span className="w-44 text-center text-sm font-semibold">
          {MONTHS[month]} {year}
        </span>
        <NavArrow
          dir={1}
          title="Next month"
          onClick={() => shiftMonth(1)}
        />
        <button
          className="btn-ghost px-2 py-1 text-xs"
          onClick={() => {
            setYear(Number(today.slice(0, 4)));
            setMonth(Number(today.slice(5, 7)) - 1);
          }}
        >
          This month
        </button>
        <div className="flex-1" />
        <select
          aria-label="Filter by list"
          className="input w-44 text-xs"
          value={listFilter === "all" ? "" : String(listFilter)}
          onChange={(e) =>
            setListFilter(e.target.value === "" ? "all" : Number(e.target.value))
          }
        >
          <option value="">All lists</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-40 flex-col gap-0.5 rounded-lg border border-line bg-surface-alt/50 px-4 py-3">
          <span className="text-2xl font-semibold">
            {done.length}
            <span className="text-base font-normal text-content-muted">
              {" "}
              / {past.length}
            </span>
          </span>
          <span className="text-xs text-content-muted">
            tasks done{rate !== null ? ` (${rate}%)` : ""}
          </span>
        </div>
        {[...byOrigin.entries()].map(([origin, count]) => (
          <div
            key={origin}
            className="flex min-w-28 flex-col gap-0.5 rounded-lg border border-line bg-surface-alt/50 px-4 py-3"
          >
            <span className="text-2xl font-semibold">{count}</span>
            <span className="text-xs text-content-muted">
              {ORIGIN_LABELS[origin] ?? origin} done
            </span>
          </div>
        ))}
      </div>

      {streaks.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface-alt/50 p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
            Daily streaks
          </span>
          {streaks.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {splitCategory(s.title).text}
              </span>
              {s.recent.length > 0 && (
                <span className="flex shrink-0 gap-px" aria-hidden>
                  {s.recent.map((d) => (
                    <span
                      key={d.date}
                      title={`${d.date}: ${d.date === today && d.status === "todo" ? "open" : d.status === "todo" ? "not done" : d.status}`}
                      className={`h-3 w-2 rounded-xs ${
                        d.status === "done"
                          ? "bg-accent"
                          : d.status === "waiting"
                            ? "bg-accent/50"
                            : d.date === today
                              ? "border border-line"
                              : "bg-danger/30"
                      }`}
                    />
                  ))}
                </span>
              )}
              {s.done_today && (
                <span className="text-xs text-accent">done today</span>
              )}
              <span
                className={`w-16 text-right font-semibold ${
                  s.streak > 0 ? "text-accent" : "text-content-muted"
                }`}
              >
                {s.streak} {s.streak === 1 ? "day" : "days"}
              </span>
            </div>
          ))}
          <span className="pt-1 text-[11px] text-content-muted">
            Consecutive completed instances per daily rule; skipped
            weekdays (e.g. MON-FRI rules) do not break a streak. The marks
            are the newest instances, oldest on the left. Limited by the
            done-task retention window.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {doneByDay.length === 0 && (
          <p className="text-sm text-content-muted">
            Nothing completed this month{" "}
            {listFilter !== "all" ? "in this list " : ""}
            (or retention already pruned it).
          </p>
        )}
        {doneByDay.map(([date, tasks]) => (
          <div key={date} className="flex flex-col gap-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
              {weekdayShort(date)} {date}
              {date === today && " (today)"}
            </div>
            {tasks.map((task) => (
              <button
                key={task.id}
                className="flex items-center gap-2 rounded-md border border-line bg-surface-alt px-3 py-1.5 text-left text-sm hover:border-accent/60"
                onClick={() => setOpenTask(task)}
              >
                <span style={{ color: "var(--hex-done)" }}>✓</span>
                <span className="min-w-0 flex-1 truncate text-content-muted line-through">
                  {task.title}
                </span>
                {task.time && (
                  <span className="text-xs text-content-muted">
                    {task.time}
                  </span>
                )}
                {listName(task.list_id) && (
                  <span className="rounded-sm bg-line/40 px-1.5 py-0.5 text-[11px] text-content-muted">
                    {listName(task.list_id)}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
      {openTask && (
        <TaskModal task={openTask} onClose={() => setOpenTask(null)} />
      )}
    </div>
  );
}
