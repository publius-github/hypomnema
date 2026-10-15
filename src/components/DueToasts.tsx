import { useEffect, useRef, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useAppStore } from "../store";
import { warn } from "../lib/log";

/** OS notification, best effort: the in-app toast always shows too. */
async function systemNotify(title: string, body: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) sendNotification({ title, body });
  } catch (e) {
    // notifications unavailable on this platform
    warn("system notification", e);
  }
}

/** "HH:MM" of `now` shifted by `minutes`, clamped to the day: a lead
 * that crosses midnight just means everything left today is near. */
function clockPlus(now: Date, minutes: number): string {
  const at = new Date(now.getTime() + minutes * 60_000);
  if (at.getDate() !== now.getDate()) return "23:59";
  return `${String(at.getHours()).padStart(2, "0")}:${String(
    at.getMinutes(),
  ).padStart(2, "0")}`;
}

/** Id of the one summary toast a fresh start raises for the timed
 * tasks whose time had already passed - never a task id. */
const SUMMARY_ID = -1;

interface Toast {
  id: number;
  label: string;
  text: string;
}

/**
 * In-app reminders for timed tasks while the app is open, shared by the
 * desktop layout and the phone shell: the 30s due-check, the toast stack
 * and the Snooze button. No background service on any target - a closed
 * app does not check anything.
 */
export default function DueToasts({
  // the phone shell lifts the stack above its bottom tab bar
  position = "bottom-4 right-4",
}: {
  position?: string;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notifiedRef = useRef(new Set<number>());
  // the day whose tasks the set covers; null until the first check, which
  // folds what had already passed into one summary instead of a burst
  const notifiedDayRef = useRef<string | null>(null);
  const toastTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = toastTimersRef.current;
    const raise = (toast: Toast) => {
      setToasts((prev) => [...prev.filter((t) => t.id !== toast.id), toast]);
      const config = useAppStore.getState().config;
      if (config?.notify_system ?? true) {
        void systemNotify(toast.label, toast.text);
      }
      const seconds = config?.notify_toast_seconds ?? 15;
      const dismiss = setTimeout(() => {
        timers.delete(dismiss);
        setToasts((prev) => prev.filter((t) => t !== toast));
      }, seconds * 1000);
      timers.add(dismiss);
    };

    const check = () => {
      const { tasks, today, config } = useAppStore.getState();
      // nothing loaded yet (the first check runs on mount): the fresh
      // start's summary waits for the tasks to arrive
      if (tasks.length === 0) return;
      // a task carried over to the next day may keep its id and time;
      // it deserves a fresh notification on the new day
      const fresh = notifiedDayRef.current !== today;
      if (fresh) {
        notifiedDayRef.current = today;
        notifiedRef.current.clear();
      }
      const now = new Date();
      const nowClock = clockPlus(now, 0);
      const horizon = clockPlus(now, config?.notify_lead_minutes ?? 0);
      const missed: string[] = [];
      for (const task of tasks) {
        if (
          task.scheduled_date !== today ||
          task.time === null ||
          task.time > horizon ||
          task.status !== "todo" ||
          notifiedRef.current.has(task.id)
        ) {
          continue;
        }
        notifiedRef.current.add(task.id);
        const text = `${task.time} ${task.title}`;
        // opening the app at six must not fire every reminder since
        // morning one by one
        if (fresh && task.time < nowClock) {
          missed.push(text);
          continue;
        }
        raise({
          id: task.id,
          label: task.time > nowClock ? "Coming up" : "Task due",
          text,
        });
      }
      if (missed.length === 1) {
        raise({ id: SUMMARY_ID, label: "Task due", text: missed[0] });
      } else if (missed.length > 1) {
        raise({
          id: SUMMARY_ID,
          label: `${missed.length} timed tasks already due today`,
          text: missed.join(" · "),
        });
      }
    };

    check();
    const timer = setInterval(check, 30_000);
    return () => {
      clearInterval(timer);
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  // a task checked off (or deleted) while its toast shows: the toast goes
  const tasks = useAppStore((s) => s.tasks);
  useEffect(() => {
    const open = new Set(
      tasks.filter((t) => t.status === "todo").map((t) => t.id),
    );
    setToasts((prev) => {
      const next = prev.filter((t) => t.id === SUMMARY_ID || open.has(t.id));
      return next.length === prev.length ? prev : next;
    });
  }, [tasks]);

  // snooze: hide the toast and forget the id after the configured pause,
  // so the 30s due-check raises it again (if the task is still open)
  const snooze = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const minutes = useAppStore.getState().config?.notify_snooze_minutes ?? 10;
    const timers = toastTimersRef.current;
    const timer = setTimeout(
      () => {
        timers.delete(timer);
        notifiedRef.current.delete(id);
      },
      minutes * 60 * 1000,
    );
    timers.add(timer);
  };

  if (toasts.length === 0) return null;
  return (
    <div className={`fixed z-20 flex flex-col gap-2 ${position}`}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex max-w-sm items-center gap-3 rounded-lg border border-line bg-surface-alt px-4 py-2 text-left text-sm shadow-lg"
        >
          <button
            className="min-w-0 text-left"
            title="Dismiss"
            onClick={() =>
              setToasts((prev) => prev.filter((t) => t.id !== toast.id))
            }
          >
            <span className="font-medium text-accent">{toast.label}</span>
            <br />
            <span className="break-words">{toast.text}</span>
          </button>
          {/* the summary covers several tasks: nothing single to snooze */}
          {toast.id !== SUMMARY_ID && (
            <button
              className="shrink-0 font-semibold text-accent"
              title="Remind again later"
              onClick={() => snooze(toast.id)}
            >
              Snooze
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
