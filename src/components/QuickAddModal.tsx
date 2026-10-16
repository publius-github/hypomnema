import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store";
import { addDaysISO, dayLabel, gridDates } from "../lib/tasks";

/**
 * Global quick-add from the dashboard header: one input plus a
 * destination picker covering every grid day and every list. Enter adds
 * the task and keeps the dialog open for the next one; Escape closes.
 */
export default function QuickAddModal({ onClose }: { onClose: () => void }) {
  const createTask = useAppStore((s) => s.createTask);
  const lists = useAppStore((s) => s.lists);
  const config = useAppStore((s) => s.config);
  const today = useAppStore((s) => s.today);
  const gridOffset = useAppStore((s) => s.gridOffset);
  const [title, setTitle] = useState("");
  // "day:<date>" schedules into that column (no list = General);
  // "list:<id>" drops into a list backlog
  const [target, setTarget] = useState(`day:${today}`);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (!config) return null;
  const columns = config.dashboard_today_only ? 1 : config.grid_columns;
  const dates = gridDates(addDaysISO(today, gridOffset), columns);
  // only real user lists are add targets: engine-created ({List} YAML
  // prefixes, Birthdays) and archived lists stay out of the picker
  const targetLists = lists
    .filter((l) => !l.auto)
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    );

  const submit = () => {
    const text = title.trim();
    if (!text) return;
    if (target.startsWith("day:")) {
      void createTask({ title: text, scheduled_date: target.slice(4) });
    } else {
      void createTask({ title: text, list_id: Number(target.slice(5)) });
    }
    setTitle("");
    inputRef.current?.focus();
  };

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/40 p-6 pt-24"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Quick add"
        aria-modal="true"
        className="flex w-[440px] flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-xl"
      >
        <span className="text-sm font-semibold">Add task</span>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            className="input w-full"
            placeholder="Task title, or {Category} title"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
          />
          <select
            className="input w-full"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <optgroup label="Days">
              {dates.map((date) => (
                <option key={date} value={`day:${date}`}>
                  {dayLabel(date, today)}
                </option>
              ))}
            </optgroup>
            {targetLists.length > 0 && (
              <optgroup label="Lists">
                {targetLists.map((list) => (
                  <option key={list.id} value={`list:${list.id}`}>
                    {list.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </form>
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-content-muted">
            Enter adds and keeps the dialog open
          </span>
          <div className="flex gap-2">
            <button
              className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-content-muted"
              onClick={onClose}
            >
              Close
            </button>
            <button className="btn-primary px-3" onClick={submit}>
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
