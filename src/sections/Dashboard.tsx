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
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex h-full flex-col gap-3 p-4">
        {dashboard?.focus && (
          <div className="text-center text-sm font-medium italic text-accent">
            {dashboard.focus}
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
          {lists.map((list) => (
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
