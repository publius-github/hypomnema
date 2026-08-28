import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useAppStore } from "../store";
import { gridDates } from "../lib/tasks";
import DayColumn from "../components/DayColumn";
import ListColumn from "../components/ListColumn";
import TaskCard from "../components/TaskCard";
import TaskModal from "../components/TaskModal";
import NewListForm from "../components/NewListForm";

export default function Dashboard() {
  const { config, today, lists, tasks, updateTask, dashboard } = useAppStore();
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  if (!config) return null;

  const dates = gridDates(today, config.grid_columns);
  // fresh vault: nothing exists yet, so the automation features are
  // invisible - point at them once
  const freshVault = tasks.length === 0 && lists.length === 0;
  const activeTask = tasks.find((t) => t.id === activeTaskId) ?? null;
  const editingTask = tasks.find((t) => t.id === editingTaskId) ?? null;

  const onDragStart = (event: DragStartEvent) => {
    setActiveTaskId(Number(String(event.active.id).replace("task:", "")));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveTaskId(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = Number(String(active.id).replace("task:", ""));
    const target = String(over.id);
    if (target.startsWith("day:")) {
      void updateTask(taskId, { scheduled_date: target.slice(4) });
    } else if (target.startsWith("list:")) {
      void updateTask(taskId, {
        list_id: Number(target.slice(5)),
        scheduled_date: null,
      });
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveTaskId(null)}
    >
      <div className="flex h-full flex-col gap-3 p-4">
        {dashboard?.focus && (
          <div className="text-center text-sm font-medium italic text-accent">
            {dashboard.focus}
          </div>
        )}
        {freshVault && (
          <div className="mx-auto flex w-full max-w-xl flex-col gap-2 rounded-lg border border-line bg-surface-alt p-4 text-sm">
            <span className="font-semibold">Getting started</span>
            <span className="text-content-muted">
              Click &quot;+ Add task&quot; in any day column, or type a
              title as {"{List name}"} task text to file it into a list.
            </span>
            <span className="text-content-muted">
              Recurring rules, one-off dates and birthdays generate tasks
              automatically - set them up in{" "}
              <button
                className="text-accent hover:underline"
                onClick={() => useAppStore.getState().setSection("upcoming")}
              >
                Upcoming
              </button>
              . The journal and the Markdown notes live in{" "}
              <button
                className="text-accent hover:underline"
                onClick={() => useAppStore.getState().setSection("journal")}
              >
                Journal
              </button>{" "}
              and{" "}
              <button
                className="text-accent hover:underline"
                onClick={() => useAppStore.getState().setSection("kb")}
              >
                Notes
              </button>
              .
            </span>
          </div>
        )}
        <div
          className="grid min-h-0 flex-[3] gap-3"
          style={{
            gridTemplateColumns: `repeat(${dates.length}, minmax(200px, 1fr))`,
          }}
        >
          {dates.map((date) => (
            <DayColumn
              key={date}
              date={date}
              onOpenTask={setEditingTaskId}
            />
          ))}
        </div>

        <div className="flex min-h-0 flex-[2] gap-3 overflow-x-auto border-t border-line pt-4">
          {lists
            // engine-created lists ({List} prefixes, Birthdays) only
            // group tasks inside day columns; they earn a backlog
            // column only when something unscheduled lands in them
            .filter(
              (list) =>
                !list.auto ||
                tasks.some(
                  (t) =>
                    t.list_id === list.id &&
                    !t.scheduled_date &&
                    t.parent_task_id === null,
                ),
            )
            .map((list) => (
              <ListColumn
                key={list.id}
                list={list}
                onOpenTask={setEditingTaskId}
              />
            ))}
          <NewListForm />
        </div>
      </div>

      <DragOverlay>
        {activeTask && <TaskCard task={activeTask} overlay />}
      </DragOverlay>

      {editingTask && (
        <TaskModal task={editingTask} onClose={() => setEditingTaskId(null)} />
      )}
    </DndContext>
  );
}
