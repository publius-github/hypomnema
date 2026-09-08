import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { addDaysISO, compareTasks, mondayOf, todayISO } from "../lib/tasks";
import TaskRow from "./TaskRow";
import type { DashboardContext, Task } from "../types";

/**
 * The week, looked back at (REQUIREMENTS.md §6: view-only on the phone).
 *
 * The desktop's Review puts Completed and Still open side by side with a
 * hover strip of actions on every row; a phone has one column and no
 * hover, so this stacks them and lets a row's own "..." carry the same
 * actions it carries everywhere else - one interaction to learn, not two.
 *
 * Its own snapshot rather than the store's: the store's window follows
 * the day grid, and a review of three weeks ago is outside it.
 */
export default function MobileReview() {
  const [offset, setOffset] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const setError = useAppStore((s) => s.setError);
  const vaultVersion = useAppStore((s) => s.vaultVersion);
  const today = useAppStore((s) => s.today) || todayISO();

  const start = addDaysISO(mondayOf(today), offset * 7);
  const end = addDaysISO(start, 6);

  useEffect(() => {
    let cancelled = false;
    void invoke<Task[]>("tasks_snapshot", {
      startDate: start,
      endDate: addDaysISO(end, 1),
    })
      .then((all) => {
        if (cancelled) return;
        setTasks(
          all.filter(
            (t) =>
              t.parent_task_id === null &&
              t.scheduled_date !== null &&
              t.scheduled_date >= start &&
              t.scheduled_date <= end,
          ),
        );
      })
      .catch((e) => setError(String(e)));
    // `dates`, plural: the command takes the whole day window a view
    // shows, and pins the focus phrase for the first of them.
    void invoke<DashboardContext>("dashboard_context", { dates: [start] })
      .then((context) => !cancelled && setFocus(context.focus))
      .catch(() => setFocus(null));
    return () => {
      cancelled = true;
    };
  }, [start, end, setError, vaultVersion]);

  const done = tasks.filter((t) => t.status === "done");
  const open = tasks.filter((t) => t.status !== "done").sort(compareTasks);
  const rate = tasks.length
    ? Math.round((done.length / tasks.length) * 100)
    : 0;

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

      <div className="flex gap-3 border-b border-line px-4 py-3 text-sm">
        <Stat label="Done" value={`${done.length}`} />
        <Stat label="Open" value={`${open.length}`} />
        <Stat label="Rate" value={`${rate}%`} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Section title={`Still open (${open.length})`}>
          {open.length === 0 ? (
            <p className="px-4 py-4 text-sm text-content-muted">
              Nothing left over.
            </p>
          ) : (
            <ul>
              {open.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          )}
        </Section>
        <Section title={`Completed (${done.length})`}>
          <ul>
            {done.sort(compareTasks).map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex-1">
      <span className="block text-lg font-semibold">{value}</span>
      <span className="text-xs text-content-muted">{label}</span>
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
