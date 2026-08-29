import { useDroppable } from "@dnd-kit/core";
import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";
import {
  cadenceColor,
  categoryOf,
  currentAndNextBlock,
  dayLabel,
  groupByCadence,
  splitDone,
  tintStyle,
} from "../lib/tasks";
import TaskCard from "./TaskCard";
import QuickAdd from "./QuickAdd";
import type { Task } from "../types";

function DayColumn({
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
  const lists = useAppStore((s) => s.lists);
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
  // shallow-compared filtered selection: targeted store merges keep
  // unchanged task identities, so a change in another day column does
  // not re-render this one
  const dayTasks = useAppStore(
    useShallow((s) =>
      s.tasks.filter(
        (t) =>
          t.scheduled_date === date &&
          t.parent_task_id === null &&
          !(hideDailies && t.cadence === "daily"),
      ),
    ),
  );
  const { active, postponed, done } = splitDone(
    dayTasks,
    config?.done_display ?? "inline",
    new Set(hold),
  );
  // the "category" of a task: the {X} title prefix for manual tasks,
  // the list name for engine-generated ones (their {X} became a list)
  const taskCategory = (t: Task) =>
    categoryOf(t.title) ??
    (t.list_id !== null
      ? (lists.find((l) => l.id === t.list_id)?.name ?? null)
      : null);
  const groups = groupByCadence(
    active,
    config?.cadence_group_order,
    taskCategory,
  );
  const isToday = date === today;

  // the section plate takes its cadence color (same palette that colors
  // the card stripes), framing the section like the priority label does
  const groupColor = (key: string): string | null => cadenceColor(config, key);

  // configurable vertical rhythm: cards, sections, category blocks
  const taskGap = config?.task_gap ?? 6;
  const sectionGap = config?.section_gap ?? 12;
  const categoryGap = config?.category_block_gap ?? 12;

  const section = (label: string, items: Task[]) =>
    items.length > 0 && (
      <div
        className="flex flex-col border-t border-line pt-1.5"
        style={{ rowGap: taskGap, marginTop: sectionGap }}
      >
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
        className={`truncate px-2.5 py-2 text-base font-semibold ${
          config?.day_header_centered ? "text-center" : ""
        } ${isToday ? "text-accent" : "text-content"}`}
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
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2"
        style={{ rowGap: taskGap }}
      >
        {groups.map((group, i) => (
          <div
            key={group.key}
            className="flex flex-col"
            // extra gap before every group after the first, so the
            // cadence blocks read as separate sections
            style={{
              rowGap: taskGap,
              marginTop: i > 0 ? sectionGap : undefined,
            }}
          >
            <div
              className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                groupColor(group.key) ? "" : "bg-line/40 text-content"
              }`}
              style={
                groupColor(group.key)
                  ? tintStyle(groupColor(group.key)!)
                  : undefined
              }
            >
              <span>{group.label}</span>
              <span className="h-px flex-1 bg-current opacity-30" />
            </div>
            {group.tasks.map((task, j) => {
              // a wider gap where one category block ends and the next
              // begins (tasks are pre-sorted by category)
              const gapBefore =
                j > 0 &&
                taskCategory(task) !== taskCategory(group.tasks[j - 1]);
              return (
                <div
                  key={task.id}
                  style={gapBefore ? { marginTop: categoryGap } : undefined}
                >
                  <TaskCard task={task} onOpen={onOpenTask} />
                </div>
              );
            })}
          </div>
        ))}
        {section("Postponed", postponed)}
        {section("Done", done)}
        <QuickAdd target={{ scheduled_date: date }} />
      </div>
    </div>
  );
}

export default memo(DayColumn);
