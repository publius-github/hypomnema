import { useState } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useAppStore } from "../store";
import { orderLists } from "../lib/tasks";
import { useTaskDnd } from "../components/taskDnd";
import ListColumn from "../components/ListColumn";
import TaskCard from "../components/TaskCard";
import TaskModal from "../components/TaskModal";
import NewListForm from "../components/NewListForm";

/**
 * Dedicated lists dashboard: every list at once in a wrapping grid,
 * no day columns - the deep-work view over the backlogs. The column
 * count is a setting, adjustable right here.
 */
export default function Lists() {
  const config = useAppStore((s) => s.config);
  const lists = useAppStore((s) => s.lists);
  const tasks = useAppStore((s) => s.tasks);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const dnd = useTaskDnd();

  if (!config) return null;
  const visible = orderLists(lists, tasks, config.lists_sort_alpha);
  const columns = Math.max(1, config.lists_page_columns);
  const editingTask = tasks.find((t) => t.id === editingTaskId) ?? null;

  return (
    <DndContext
      sensors={dnd.sensors}
      onDragStart={dnd.onDragStart}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
    >
      <div className="flex min-h-full flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Lists</span>
          <div className="ml-auto flex items-center gap-1 text-xs text-content-muted">
            <span>Columns</span>
            <select
              className="input px-1 py-0.5 text-xs"
              value={columns}
              onChange={(e) =>
                void useAppStore
                  .getState()
                  .updateConfig({ lists_page_columns: Number(e.target.value) })
              }
            >
              {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <NewListForm />
        </div>
        <div
          className="grid content-start gap-3"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}
        >
          {visible.map((list) => (
            <ListColumn key={list.id} list={list} onOpenTask={setEditingTaskId} />
          ))}
        </div>
        {visible.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-content-muted">
            No lists yet
          </div>
        )}
      </div>

      <DragOverlay>
        {dnd.activeTask && <TaskCard task={dnd.activeTask} overlay />}
      </DragOverlay>

      {editingTask && (
        <TaskModal task={editingTask} onClose={() => setEditingTaskId(null)} />
      )}
    </DndContext>
  );
}
