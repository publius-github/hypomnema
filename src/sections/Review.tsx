import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { addDaysISO, splitCategory, todayISO, weekdayShort } from "../lib/tasks";
import type { DashboardContext, OutlookEvent, Task } from "../types";
import TaskModal from "../components/TaskModal";

const ORIGIN_LABELS: Record<string, string> = {
  manual: "manual",
  recurring: "recurring",
  scheduled: "scheduled",
  birthday: "birthdays",
};

/** Monday of the ISO week holding the given date. */
function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return addDaysISO(date, -((d.getDay() + 6) % 7));
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-28 flex-col gap-0.5 rounded-lg border border-line bg-surface-alt/50 px-4 py-3">
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-xs text-content-muted">{label}</span>
    </div>
  );
}

/**
 * Weekly review: how the displayed week went (completed by day, what is
 * still open) and what the next week holds (focus phrase, scheduled
 * tasks and projected firings). Data comes from the same commands the
 * other sections use; nothing here mutates state except through the
 * task dialog.
 */
export default function Review() {
  const lists = useAppStore((s) => s.lists);
  const vaultVersion = useAppStore((s) => s.vaultVersion);
  const storeTasks = useAppStore((s) => s.tasks);
  const openJournalDate = useAppStore((s) => s.openJournalDate);
  const today = todayISO();
  // 0 = the week containing today; negative = past weeks
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekTasks, setWeekTasks] = useState<Task[]>([]);
  const [weekFocus, setWeekFocus] = useState<string | null>(null);
  const [nextTasks, setNextTasks] = useState<Task[]>([]);
  const [nextOutlook, setNextOutlook] = useState<OutlookEvent[]>([]);
  const [nextFocus, setNextFocus] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<Task | null>(null);

  const weekStart = addDaysISO(mondayOf(today), weekOffset * 7);
  const weekEnd = addDaysISO(weekStart, 6);
  const nextStart = addDaysISO(weekStart, 7);
  const nextEnd = addDaysISO(nextStart, 6);

  useEffect(() => {
    let cancelled = false;
    const inRange = (t: Task, from: string, until: string) =>
      t.parent_task_id === null &&
      t.scheduled_date !== null &&
      t.scheduled_date >= from &&
      t.scheduled_date <= until;
    void invoke<Task[]>("tasks_snapshot", {
      startDate: weekStart,
      endDate: addDaysISO(weekEnd, 1),
    })
      .then((tasks) => {
        if (!cancelled)
          setWeekTasks(tasks.filter((t) => inRange(t, weekStart, weekEnd)));
      })
      .catch((e) => useAppStore.getState().setError(String(e)));
    void invoke<Task[]>("tasks_snapshot", {
      startDate: nextStart,
      endDate: addDaysISO(nextEnd, 1),
    })
      .then((tasks) => {
        if (!cancelled)
          setNextTasks(tasks.filter((t) => inRange(t, nextStart, nextEnd)));
      })
      .catch(() => setNextTasks([]));
    void invoke<OutlookEvent[]>("calendar_outlook", {
      from: nextStart,
      to: addDaysISO(nextEnd, 1),
    })
      .then((events) => {
        if (!cancelled) setNextOutlook(events);
      })
      .catch(() => setNextOutlook([]));
    // the focus phrase is pinned per ISO week; asking for a week pins it,
    // which is fine - the rotation is a deterministic cycle anyway
    void invoke<DashboardContext>("dashboard_context", { dates: [weekStart] })
      .then((ctx) => {
        if (!cancelled) setWeekFocus(ctx.focus);
      })
      .catch(() => setWeekFocus(null));
    void invoke<DashboardContext>("dashboard_context", { dates: [nextStart] })
      .then((ctx) => {
        if (!cancelled) setNextFocus(ctx.focus);
      })
      .catch(() => setNextFocus(null));
    return () => {
      cancelled = true;
    };
  }, [weekStart, weekEnd, nextStart, nextEnd, storeTasks, vaultVersion]);

  // keep the opened task fresh after edits made in the dialog
  useEffect(() => {
    if (!openTask) return;
    const live = [...weekTasks, ...nextTasks].find((t) => t.id === openTask.id);
    if (live) setOpenTask(live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekTasks, nextTasks]);

  const listName = (id: number | null) =>
    id === null ? null : (lists.find((l) => l.id === id)?.name ?? null);

  // completion rate counts only days that already happened: planned
  // tasks later this week are not "missed" yet
  const past = useMemo(
    () => weekTasks.filter((t) => (t.scheduled_date as string) <= today),
    [weekTasks, today],
  );
  const done = useMemo(() => past.filter((t) => t.status === "done"), [past]);
  const rate =
    past.length > 0 ? Math.round((done.length / past.length) * 100) : null;
  const stillOpen = useMemo(
    () => past.filter((t) => t.status !== "done"),
    [past],
  );
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

  const taskRow = (task: Task, showDone: boolean) => (
    <button
      key={task.id}
      className="flex items-center gap-2 rounded-md border border-line bg-surface-alt px-3 py-1.5 text-left text-sm hover:border-accent/60"
      onClick={() => setOpenTask(task)}
    >
      <span
        className={
          task.status === "postponed" ? "text-warn" : "text-content-muted"
        }
        style={
          task.status === "done" ? { color: "var(--color-done)" } : undefined
        }
      >
        {task.status === "done" ? "✓" : task.status === "postponed" ? "→" : "○"}
      </span>
      <span
        className={`min-w-0 flex-1 truncate ${
          showDone && task.status === "done"
            ? "text-content-muted line-through"
            : ""
        }`}
      >
        {splitCategory(task.title).text}
      </span>
      {task.overdue && task.status !== "done" && (
        <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[11px] font-semibold text-danger">
          OVERDUE
        </span>
      )}
      {task.time && (
        <span className="text-xs text-content-muted">{task.time}</span>
      )}
      {listName(task.list_id) && (
        <span className="rounded bg-line/40 px-1.5 py-0.5 text-[11px] text-content-muted">
          {listName(task.list_id)}
        </span>
      )}
    </button>
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-center gap-2">
        <button
          className="btn-ghost px-3 py-1"
          onClick={() => setWeekOffset((o) => o - 1)}
        >
          &lt;
        </button>
        <span className="w-64 text-center text-sm font-semibold">
          {weekStart} - {weekEnd}
          {weekOffset === 0 && " (this week)"}
        </span>
        <button
          className="btn-ghost px-3 py-1"
          onClick={() => setWeekOffset((o) => o + 1)}
        >
          &gt;
        </button>
        {weekOffset !== 0 && (
          <button
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() => setWeekOffset(0)}
          >
            This week
          </button>
        )}
        <div className="flex-1" />
        <button
          className="btn-ghost px-3 py-1 text-xs"
          title="Open the journal on the last day of this week"
          onClick={() =>
            openJournalDate(weekOffset === 0 ? today : weekEnd)
          }
        >
          Weekly note
        </button>
      </div>

      {weekFocus && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
            Focus
          </span>
          <div>{weekFocus}</div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <StatTile
          value={`${done.length} / ${past.length}`}
          label={`tasks done${rate !== null ? ` (${rate}%)` : ""}`}
        />
        {[...byOrigin.entries()].map(([origin, count]) => (
          <StatTile
            key={origin}
            value={String(count)}
            label={`${ORIGIN_LABELS[origin] ?? origin} done`}
          />
        ))}
        {stillOpen.length > 0 && (
          <StatTile value={String(stillOpen.length)} label="still open" />
        )}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
            Completed
          </div>
          {doneByDay.length === 0 && (
            <p className="text-sm text-content-muted">
              Nothing completed this week (or retention already pruned it).
            </p>
          )}
          {doneByDay.map(([date, tasks]) => (
            <div key={date} className="flex flex-col gap-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                {weekdayShort(date)} {date}
                {date === today && " (today)"}
              </div>
              {tasks.map((t) => taskRow(t, true))}
            </div>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
            Still open
          </div>
          {stillOpen.length === 0 ? (
            <p className="text-sm text-content-muted">
              Everything planned up to today is done.
            </p>
          ) : (
            stillOpen.map((t) => taskRow(t, false))
          )}
          {weekOffset < 0 && (
            <p className="text-[11px] text-content-muted">
              Tasks left open in a past week were carried over to a later
              day and show up there, not here.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-alt/50 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
          Next week ({nextStart} - {nextEnd})
        </div>
        {nextFocus && (
          <div className="text-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              Focus{" "}
            </span>
            {nextFocus}
          </div>
        )}
        {nextByDay.length === 0 && (
          <p className="text-sm text-content-muted">
            Nothing scheduled or projected yet.
          </p>
        )}
        {nextByDay.map(([date, { tasks, projected }]) => (
          <div key={date} className="flex flex-col gap-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
              {weekdayShort(date)} {date}
            </div>
            {tasks.map((t) => taskRow(t, true))}
            {projected.map((event, i) => (
              <div
                key={`${event.title}-${i}`}
                className="flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-1.5 text-sm text-content-muted"
                title="Not generated yet; appears as a task when the date nears"
              >
                <span className="w-16 shrink-0 rounded bg-line/40 px-1.5 py-0.5 text-center text-[11px]">
                  {event.kind}
                </span>
                <span className="min-w-0 flex-1 truncate">{event.title}</span>
              </div>
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
