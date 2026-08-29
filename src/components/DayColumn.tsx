import { useDroppable } from "@dnd-kit/core";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";
import { currentAndNextBlock, dayLabel, groupByCadence, splitDone } from "../lib/tasks";
import TaskCard from "./TaskCard";
import QuickAdd from "./QuickAdd";
import type { Task } from "../types";

export default function DayColumn({
  date,
  onOpenTask,
}: {
  date: string;
  onOpenTask: (id: number) => void;
}) {
  // individual selectors: a whole-store subscribe would re-render every
  // column on unrelated state changes (toasts, palette, banners)
  const config = useAppStore((s) => s.config);
  const today = useAppStore((s) => s.today);
  const tasks = useAppStore((s) => s.tasks);
  const dashboard = useAppStore((s) => s.dashboard);
  const hold = useAppStore(useShallow((s) => s.statusHold));
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` });

  const reminders =
    dashboard?.days.find((d) => d.date === date)?.reminders ?? [];
  const schedule =
    date === today && dashboard
      ? currentAndNextBlock(dashboard.blocks, new Date())
      : null;

  // dailies repeat every day anyway; with the setting on, future
  // columns skip them so the look-ahead shows only the special stuff
  const hideDailies =
    (config?.daily_tasks_today_only ?? false) && date > today;
  const dayTasks = tasks.filter(
    (t) =>
      t.scheduled_date === date &&
      t.parent_task_id === null &&
      !(hideDailies && t.cadence === "daily"),
  );
  const { active, postponed, done } = splitDone(
    dayTasks,
    config?.done_display ?? "inline",
    new Set(hold),
  );
  const groups = groupByCadence(active);
  const isToday = date === today;

  const section = (label: string, items: Task[]) =>
    items.length > 0 && (
      <div className="flex flex-col gap-1.5 border-t border-line pt-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-content-muted">
          {label}
        </div>
        {items.map((task) => (
          <TaskCard key={task.id} task={task} onOpen={onOpenTask} />
        ))}
      </div>
    );

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-0 flex-col rounded-lg border ${
        isOver ? "border-accent" : "border-line"
      } ${isToday ? "bg-accent/5" : "bg-surface-alt/50"}`}
    >
      <div
        className={`truncate px-2.5 py-2 text-sm font-semibold ${
          isToday ? "text-accent" : "text-content"
        }`}
        title={dayLabel(date, today)}
      >
        {dayLabel(date, today)}
      </div>
      {(reminders.length > 0 || schedule) && (
        <div className="flex flex-col gap-0.5 px-2.5 pb-1.5 text-[11px] text-content-muted">
          {reminders.map((text, i) => (
            <div key={i} className="italic">
              {text}
            </div>
          ))}
          {schedule?.current && (
            <div>
              <span className="font-medium text-accent">Now:</span>{" "}
              {schedule.current.label} (until {schedule.current.to})
            </div>
          )}
          {schedule?.next && (
            <div>
              <span className="font-medium">Next:</span> {schedule.next.label}{" "}
              at {schedule.next.from}
            </div>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
        {groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-1.5">
            {group.label && (
              <div className="mt-1 flex items-center gap-1.5 rounded bg-line/25 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-content-muted">
                <span>{group.label}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
            {group.tasks.map((task) => (
              <TaskCard key={task.id} task={task} onOpen={onOpenTask} />
            ))}
          </div>
        ))}
        {section("Postponed", postponed)}
        {section("Done", done)}
        <QuickAdd target={{ scheduled_date: date }} />
      </div>
    </div>
  );
}
