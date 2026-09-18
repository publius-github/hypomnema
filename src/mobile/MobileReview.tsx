import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import {
  addDaysISO,
  compareTasks,
  isClosed,
  mondayOf,
  todayISO,
  weekdayShort,
} from "../lib/tasks";
import { useMobileNav } from "./nav";
import TaskRow from "./TaskRow";
import type { DashboardContext, OutlookEvent, Task } from "../types";

const ORIGIN_LABELS: Record<string, string> = {
  manual: "manual",
  recurring: "recurring",
  scheduled: "scheduled",
  birthday: "birthdays",
};

/**
 * The week, looked back at - and the next one, looked ahead to. The same
 * numbers and panels as the desktop's Review, stacked for one column: a
 * phone has no room for side-by-side, and no hover for an action strip,
 * so each row's own "..." carries the Review actions instead
 * (`reviewWeekStart` on TaskRow) - one interaction to learn, not two.
 *
 * Its own snapshot rather than the store's: the store's window follows
 * the day view, and a review of three weeks ago is outside it.
 */
export default function MobileReview() {
  const [offset, setOffset] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [nextTasks, setNextTasks] = useState<Task[]>([]);
  const [nextOutlook, setNextOutlook] = useState<OutlookEvent[]>([]);
  const [nextFocus, setNextFocus] = useState<string | null>(null);
  const setError = useAppStore((s) => s.setError);
  const storeTasks = useAppStore((s) => s.tasks);
  const today = useAppStore((s) => s.today) || todayISO();
  const { setTab } = useMobileNav();

  const start = addDaysISO(mondayOf(today), offset * 7);
  const end = addDaysISO(start, 6);
  const nextStart = addDaysISO(start, 7);
  const nextEnd = addDaysISO(nextStart, 6);

  useEffect(() => {
    let cancelled = false;
    const inRange = (t: Task, from: string, until: string) =>
      t.parent_task_id === null &&
      t.scheduled_date !== null &&
      t.scheduled_date >= from &&
      t.scheduled_date <= until;
    void invoke<Task[]>("tasks_snapshot", {
      startDate: start,
      endDate: addDaysISO(end, 1),
    })
      .then((all) => {
        if (!cancelled) setTasks(all.filter((t) => inRange(t, start, end)));
      })
      .catch((e) => setError(String(e)));
    void invoke<Task[]>("tasks_snapshot", {
      startDate: nextStart,
      endDate: addDaysISO(nextEnd, 1),
    })
      .then((all) => {
        if (!cancelled)
          setNextTasks(all.filter((t) => inRange(t, nextStart, nextEnd)));
      })
      .catch(() => setNextTasks([]));
    // calendar_outlook's `to` is inclusive, unlike the exclusive
    // endDate above: one day further hangs the Monday after next week
    // off the panel as an eighth day
    void invoke<OutlookEvent[]>("calendar_outlook", {
      from: nextStart,
      to: nextEnd,
    })
      .then((events) => !cancelled && setNextOutlook(events))
      .catch(() => setNextOutlook([]));
    // `dates`, plural: the command takes the whole day window a view
    // shows, and pins the focus phrase for the first of them.
    void invoke<DashboardContext>("dashboard_context", { dates: [start] })
      .then((context) => !cancelled && setFocus(context.focus))
      .catch(() => setFocus(null));
    void invoke<DashboardContext>("dashboard_context", { dates: [nextStart] })
      .then((context) => !cancelled && setNextFocus(context.focus))
      .catch(() => setNextFocus(null));
    return () => {
      cancelled = true;
    };
    // storeTasks: row actions mutate through the store and every
    // refresh() replaces the array, so its change is the one refetch
    // signal that keeps this local snapshot honest
  }, [start, end, nextStart, nextEnd, setError, storeTasks]);

  // completion rate counts only days that already happened: planned
  // tasks later this week are not "missed" yet - same as the desktop
  const past = useMemo(
    () => tasks.filter((t) => (t.scheduled_date as string) <= today),
    [tasks, today],
  );
  const done = useMemo(() => past.filter((t) => t.status === "done"), [past]);
  // dropped is closed, not open: a task taken off the plan on purpose
  // is not leftover work - same rule the desktop review follows
  const stillOpen = useMemo(
    () => past.filter((t) => !isClosed(t.status)).sort(compareTasks),
    [past],
  );
  const rate =
    past.length > 0 ? Math.round((done.length / past.length) * 100) : null;
  const byOrigin = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of done) map.set(t.origin, (map.get(t.origin) ?? 0) + 1);
    return map;
  }, [done]);
  const doneByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of done) {
      const date = t.scheduled_date as string;
      map.set(date, [...(map.get(date) ?? []), t]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [done]);
  const nextByDay = useMemo(() => {
    const map = new Map<string, { tasks: Task[]; projected: OutlookEvent[] }>();
    const entry = (date: string) => {
      const existing = map.get(date);
      if (existing) return existing;
      const fresh = { tasks: [] as Task[], projected: [] as OutlookEvent[] };
      map.set(date, fresh);
      return fresh;
    };
    for (const t of nextTasks) entry(t.scheduled_date as string).tasks.push(t);
    for (const e of nextOutlook) entry(e.date).projected.push(e);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [nextTasks, nextOutlook]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-line px-2 py-3">
        <button
          onClick={() => setOffset((o) => o - 1)}
          aria-label="Previous week"
          className="px-3 py-1 text-lg text-content-muted"
        >
          ‹
        </button>
        <div className="min-w-0 text-center">
          <div className="font-semibold">
            {offset === 0 ? "This week" : `${start} – ${end}`}
          </div>
          {focus && (
            <div className="truncate text-xs text-content-muted">{focus}</div>
          )}
        </div>
        <button
          onClick={() => setOffset((o) => Math.min(o + 1, 0))}
          aria-label="Next week"
          className="px-3 py-1 text-lg text-content-muted"
        >
          ›
        </button>
      </header>

      <div className="flex items-center gap-3 border-b border-line px-4 py-3 text-sm">
        <Stat
          label={`done${rate !== null ? ` (${rate}%)` : ""}`}
          value={`${done.length}/${past.length}`}
        />
        {[...byOrigin.entries()].map(([origin, count]) => (
          <Stat
            key={origin}
            label={ORIGIN_LABELS[origin] ?? origin}
            value={String(count)}
          />
        ))}
        <Stat label="open" value={`${stillOpen.length}`} />
        <button
          onClick={() => {
            useAppStore
              .getState()
              .openJournalDate(offset === 0 ? today : end);
            setTab("journal");
          }}
          className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs text-content-muted"
        >
          Weekly note
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Section title={`Still open (${stillOpen.length})`}>
          {stillOpen.length === 0 ? (
            <p className="px-4 py-4 text-sm text-content-muted">
              Everything planned up to today is done.
            </p>
          ) : (
            <ul>
              {stillOpen.map((task) => (
                <TaskRow key={task.id} task={task} reviewWeekStart={start} />
              ))}
            </ul>
          )}
          {offset < 0 && stillOpen.length > 0 && (
            <p className="px-4 py-2 text-xs text-content-muted">
              Tasks left open in a past week were carried over to a later day
              and show up there, not here.
            </p>
          )}
        </Section>
        <Section title={`Completed (${done.length})`}>
          {doneByDay.length === 0 && (
            <p className="px-4 py-4 text-sm text-content-muted">
              Nothing completed this week (or retention already pruned it).
            </p>
          )}
          {doneByDay.map(([date, dayTasks]) => (
            <div key={date}>
              <h3 className="px-4 pb-1 pt-2 text-xs text-content-muted">
                {weekdayShort(date)} {date}
                {date === today && " (today)"}
              </h3>
              <ul>
                {dayTasks.sort(compareTasks).map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            </div>
          ))}
        </Section>
        <Section title={`Next week (${nextStart} – ${nextEnd})`}>
          {nextFocus && (
            <p className="px-4 py-2 text-xs">
              <span className="font-semibold uppercase tracking-wide text-accent">
                Focus{" "}
              </span>
              {nextFocus}
            </p>
          )}
          {nextByDay.length === 0 && (
            <p className="px-4 py-4 text-sm text-content-muted">
              Nothing scheduled or projected yet.
            </p>
          )}
          {nextByDay.map(([date, { tasks: dayTasks, projected }]) => (
            <div key={date}>
              <h3 className="px-4 pb-1 pt-2 text-xs text-content-muted">
                {weekdayShort(date)} {date}
              </h3>
              <ul>
                {dayTasks.sort(compareTasks).map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
              {projected.map((event, i) => (
                <p
                  key={`${event.title}-${i}`}
                  className="flex items-center gap-2 px-4 py-1 text-sm text-content-muted"
                >
                  <span className="shrink-0 rounded bg-line/40 px-1.5 py-0.5 text-[11px]">
                    {event.kind}
                  </span>
                  <span className="min-w-0 break-words">{event.title}</span>
                </p>
              ))}
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-lg font-semibold">{value}</span>
      <span className="block truncate text-xs text-content-muted">{label}</span>
    </span>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="bg-surface-alt px-4 py-2 text-xs uppercase tracking-wide text-content-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}
