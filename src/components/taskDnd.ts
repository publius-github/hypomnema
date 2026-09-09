import { useState } from "react";
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useAppStore } from "../store";

/**
 * Shared drag-and-drop wiring for every view that hosts task cards
 * (Dashboard, Lists, Days): dropping on a day column reschedules, on a
 * list column moves into the backlog, on a backlog card reorders or
 * moves into that card's list.
 *
 * The same context also carries the list columns themselves: a column's
 * header grip drags `listmove:<id>`, and dropping that on a group tile
 * (`group:<id>`) or on the open group's back bar (`group:none`) changes
 * the list's membership. Two kinds of drag, told apart by the id prefix,
 * because they share every drop target's screen space anyway.
 */
export function useTaskDnd() {
  const tasks = useAppStore((s) => s.tasks);
  const updateTask = useAppStore((s) => s.updateTask);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const activeTask = tasks.find((t) => t.id === activeTaskId) ?? null;

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    // a list drag has no card to show in the overlay
    setActiveTaskId(id.startsWith("task:") ? Number(id.slice(5)) : null);
  };

  const onDragCancel = () => setActiveTaskId(null);

  const onDragEnd = (event: DragEndEvent) => {
    setActiveTaskId(null);
    const { active, over } = event;
    if (!over) return;
    const source = String(active.id);
    const target = String(over.id);
    if (source.startsWith("listmove:")) {
      const listId = Number(source.slice(9));
      if (target === "group:none") {
        void useAppStore.getState().setListGroup(listId, null);
      } else if (target.startsWith("group:")) {
        void useAppStore.getState().setListGroup(listId, Number(target.slice(6)));
      }
      return;
    }
    const taskId = Number(source.replace("task:", ""));
    const task = tasks.find((t) => t.id === taskId);
    if (target.startsWith("day:")) {
      const date = target.slice(4);
      if (task?.scheduled_date === date) return;
      void updateTask(taskId, { scheduled_date: date });
    } else if (target.startsWith("list:")) {
      const listId = Number(target.slice(5));
      if (task && task.list_id === listId && task.scheduled_date === null)
        return;
      void updateTask(taskId, {
        list_id: listId,
        scheduled_date: null,
      });
    } else if (target.startsWith("task:")) {
      // dropped onto a backlog card: reorder within the list, or move
      // into that card's list when it is a different one
      void useAppStore.getState().reorderTask(taskId, Number(target.slice(5)));
    }
  };

  return { sensors, activeTask, onDragStart, onDragEnd, onDragCancel };
}
