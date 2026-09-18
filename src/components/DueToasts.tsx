import { useEffect, useRef, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useAppStore } from "../store";
import { todayISO } from "../lib/tasks";
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
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const notifiedRef = useRef(new Set<number>());
  const notifiedDayRef = useRef(todayISO());
  const toastTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timer = setInterval(() => {
      const { tasks, today } = useAppStore.getState();
      // a task carried over to the next day may keep its id and time;
      // it deserves a fresh notification on the new day
      if (notifiedDayRef.current !== today) {
        notifiedDayRef.current = today;
        notifiedRef.current.clear();
      }
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
        now.getMinutes(),
      ).padStart(2, "0")}`;
      for (const task of tasks) {
        if (
          task.scheduled_date === today &&
          task.time !== null &&
          task.time <= hhmm &&
          task.status === "todo" &&
          !notifiedRef.current.has(task.id)
        ) {
          notifiedRef.current.add(task.id);
          const toast = { id: task.id, text: `${task.time} ${task.title}` };
          setToasts((prev) => [...prev, toast]);
          if (useAppStore.getState().config?.notify_system ?? true) {
            void systemNotify("Task due", toast.text);
          }
          const timers = toastTimersRef.current;
          const dismiss = setTimeout(() => {
            timers.delete(dismiss);
            setToasts((prev) => prev.filter((t) => t.id !== toast.id));
          }, 15_000);
          timers.add(dismiss);
        }
      }
    }, 30_000);
    const timers = toastTimersRef.current;
    return () => {
      clearInterval(timer);
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

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
          className="flex items-center gap-3 rounded-lg border border-line bg-surface-alt px-4 py-2 text-left text-sm shadow-lg"
        >
          <button
            className="text-left"
            title="Dismiss"
            onClick={() =>
              setToasts((prev) => prev.filter((t) => t.id !== toast.id))
            }
          >
            <span className="font-medium text-accent">Task due</span>
            <br />
            {toast.text}
          </button>
          <button
            className="shrink-0 font-semibold text-accent"
            title="Remind again later"
            onClick={() => snooze(toast.id)}
          >
            Snooze
          </button>
        </div>
      ))}
    </div>
  );
}
