import { useDroppable } from "@dnd-kit/core";
import { useAppStore } from "../store";
import { dayLabel, groupDayTasks, splitDone } from "../lib/tasks";
import TaskCard from "./TaskCard";
import QuickAdd from "./QuickAdd";

export default function DayColumn({
  date,
  onOpenTask,
}: {
  date: string;
  onOpenTask: (id: number) => void;
}) {
  const { config, today, lists, tasks } = useAppStore();
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` });

  const dayTasks = tasks.filter(
    (t) => t.scheduled_date === date && t.parent_task_id === null,
  );
  const { active, done } = splitDone(dayTasks, config?.done_display ?? "inline");
  const groups = groupDayTasks(active, lists);
  const isToday = date === today;

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-0 flex-col rounded-lg border ${
        isOver ? "border-accent" : "border-line"
      } ${isToday ? "bg-accent/5" : "bg-surface-alt/50"}`}
    >
      <div
        className={`px-2.5 py-2 text-xs font-semibold uppercase tracking-wide ${
          isToday ? "text-accent" : "text-content-muted"
        }`}
      >
        {dayLabel(date, today)}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
        {groups.map((group) => (
          <div key={group.listId ?? "none"} className="flex flex-col gap-1.5">
            {group.listName && (
              <div className="pt-1 text-[10px] font-medium uppercase tracking-wider text-content-muted">
                {group.listName}
              </div>
            )}
            {group.tasks.map((task) => (
              <TaskCard key={task.id} task={task} onOpen={onOpenTask} />
            ))}
          </div>
        ))}
        {done.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-line pt-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-content-muted">
              Done
            </div>
            {done.map((task) => (
              <TaskCard key={task.id} task={task} onOpen={onOpenTask} />
            ))}
          </div>
        )}
        <QuickAdd target={{ scheduled_date: date }} />
      </div>
    </div>
  );
}
