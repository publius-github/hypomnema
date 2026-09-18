import { useEffect, useMemo, useState } from "react";

import { errorMessage, invoke } from "../lib/ipc";
import { addDaysISO, isClosed } from "../lib/tasks";
import { useAppStore } from "../store";
import type { OutlookEvent, Task } from "../types";

export interface ReviewData {
  weekEnd: string;
  nextStart: string;
  nextEnd: string;
  weekTasks: Task[];
  weekFocus: string | null;
  nextTasks: Task[];
  nextOutlook: OutlookEvent[];
  nextFocus: string | null;
}

/**
 * The weekly review's data, shared by the desktop Review and the phone's
 * MobileReview: the reviewed week's top-level tasks and focus phrase,
 * and next week's tasks, projected firings and focus.
 *
 * Its own snapshot rather than the store's: the store's window follows
 * the day view, and a review of three weeks ago is outside it. The
 * store's `tasks` reference is the refetch signal - row actions mutate
 * through the store and every refresh() replaces the array - so one
 * engine pass or one edit costs one refetch here.
 */
export function useReviewData(weekStart: string): ReviewData {
  const storeTasks = useAppStore((s) => s.tasks);
  const [weekTasks, setWeekTasks] = useState<Task[]>([]);
  const [weekFocus, setWeekFocus] = useState<string | null>(null);
  const [nextTasks, setNextTasks] = useState<Task[]>([]);
  const [nextOutlook, setNextOutlook] = useState<OutlookEvent[]>([]);
  const [nextFocus, setNextFocus] = useState<string | null>(null);

  const weekEnd = addDaysISO(weekStart, 6);
  const nextStart = addDaysISO(weekStart, 7);
  const nextEnd = addDaysISO(nextStart, 6);

  useEffect(() => {
    let cancelled = false;
    const setError = useAppStore.getState().setError;
    const inRange = (t: Task, from: string, until: string) =>
      t.parent_task_id === null &&
      t.scheduled_date !== null &&
      t.scheduled_date >= from &&
      t.scheduled_date <= until;
    // every fetch reports a failure and leaves its panel empty rather
    // than stale: a review with a stale "next week" reads as truth
    const fail = (reset: () => void) => (e: unknown) => {
      setError(errorMessage(e));
      if (!cancelled) reset();
    };
    void invoke("tasks_snapshot", {
      startDate: weekStart,
      endDate: addDaysISO(weekEnd, 1),
    })
      .then((tasks) => {
        if (!cancelled)
          setWeekTasks(tasks.filter((t) => inRange(t, weekStart, weekEnd)));
      })
      .catch(fail(() => setWeekTasks([])));
    void invoke("tasks_snapshot", {
      startDate: nextStart,
      endDate: addDaysISO(nextEnd, 1),
    })
      .then((tasks) => {
        if (!cancelled)
          setNextTasks(tasks.filter((t) => inRange(t, nextStart, nextEnd)));
      })
      .catch(fail(() => setNextTasks([])));
    // `to` is inclusive here, unlike tasks_snapshot's exclusive endDate:
    // one day further would hang the Monday after next week off the
    // Next week panel as an eighth day
    void invoke("calendar_outlook", { from: nextStart, to: nextEnd })
      .then((events) => {
        if (!cancelled) setNextOutlook(events);
      })
      .catch(fail(() => setNextOutlook([])));
    // the focus phrase is pinned per ISO week; asking for a week pins it,
    // which is fine - the rotation is a deterministic cycle anyway
    void invoke("dashboard_context", { dates: [weekStart] })
      .then((ctx) => {
        if (!cancelled) setWeekFocus(ctx.focus);
      })
      .catch(fail(() => setWeekFocus(null)));
    void invoke("dashboard_context", { dates: [nextStart] })
      .then((ctx) => {
        if (!cancelled) setNextFocus(ctx.focus);
      })
      .catch(fail(() => setNextFocus(null)));
    return () => {
      cancelled = true;
    };
  }, [weekStart, weekEnd, nextStart, nextEnd, storeTasks]);

  return {
    weekEnd,
    nextStart,
    nextEnd,
    weekTasks,
    weekFocus,
    nextTasks,
    nextOutlook,
    nextFocus,
  };
}

export interface ReviewStats {
  /** tasks of days that already happened - the only ones that count */
  past: Task[];
  done: Task[];
  dropped: Task[];
  stillOpen: Task[];
  /** done / past in whole percent, null before the week has any past day */
  rate: number | null;
  byOrigin: Map<string, number>;
  doneByDay: [string, Task[]][];
}

/**
 * The review's numbers over the week's tasks. The completion rate counts
 * only days that already happened: planned tasks later this week are not
 * "missed" yet. Dropped is closed but not done: taken off the plan on
 * purpose, so neither leftover work nor a completion.
 */
export function useReviewStats(weekTasks: Task[], today: string): ReviewStats {
  const past = useMemo(
    () => weekTasks.filter((t) => (t.scheduled_date as string) <= today),
    [weekTasks, today],
  );
  const done = useMemo(() => past.filter((t) => t.status === "done"), [past]);
  const dropped = useMemo(
    () => past.filter((t) => t.status === "dropped"),
    [past],
  );
  const stillOpen = useMemo(
    () => past.filter((t) => !isClosed(t.status)),
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
  return { past, done, dropped, stillOpen, rate, byOrigin, doneByDay };
}

export type NextByDay = [string, { tasks: Task[]; projected: OutlookEvent[] }][];

/** Next week's real tasks and projected firings, grouped by day. */
export function useNextByDay(
  nextTasks: Task[],
  nextOutlook: OutlookEvent[],
): NextByDay {
  return useMemo(() => {
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
}
