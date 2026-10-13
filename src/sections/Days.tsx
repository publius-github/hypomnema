import { useEffect, useState } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import { addDaysISO, gridDates } from "../lib/tasks";
import { useTaskDnd } from "../components/taskDnd";
import DateJump from "../components/DateJump";
import DayColumn from "../components/DayColumn";
import TaskCard from "../components/TaskCard";
import TaskModal from "../components/TaskModal";
import QuickAddModal from "../components/QuickAddModal";
import type { Task } from "../types";

/**
 * Dedicated day-grid dashboard: the week columns at full height, no
 * list zone - the deep-work view over the calendar days.
 */
export default function Days() {
  const config = useAppStore((s) => s.config);
  const today = useAppStore((s) => s.today);
  const tasks = useAppStore((s) => s.tasks);
  const gridOffset = useAppStore((s) => s.gridOffset);
  const setGridOffset = useAppStore((s) => s.setGridOffset);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [fetchedTask, setFetchedTask] = useState<Task | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const dnd = useTaskDnd();

  // same fallback as the Dashboard: the open task may leave the
  // snapshot window while its modal is up
  useEffect(() => {
    if (editingTaskId === null) {
      setFetchedTask(null);
      return;
    }
    const inStore = useAppStore
      .getState()
      .tasks.some((t) => t.id === editingTaskId);
    if (inStore) return;
    let cancelled = false;
    invoke("task_get", { id: editingTaskId })
      .then((t) => {
        if (!cancelled) setFetchedTask(t);
      })
      .catch(() => {
        if (!cancelled) setEditingTaskId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [editingTaskId, tasks]);

  if (!config) return null;
  // the page has its own focus controls, independent of the dashboard:
  // a Today-only toggle and its own day count
  const columns = config.days_today_only ? 1 : config.days_page_columns;
  const dates = gridDates(addDaysISO(today, gridOffset), columns);
  const editingTask =
    tasks.find((t) => t.id === editingTaskId) ??
    (fetchedTask && fetchedTask.id === editingTaskId ? fetchedTask : null);

  return (
    <DndContext
      sensors={dnd.sensors}
      onDragStart={dnd.onDragStart}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
    >
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex min-h-[24px] items-center gap-1">
          <button
            className="btn-ghost px-2 py-0.5 text-sm leading-none"
            title="Earlier days"
            onClick={() => setGridOffset(gridOffset - columns)}
          >
            ‹
          </button>
          <button
            className="btn-ghost px-2 py-0.5 text-sm leading-none"
            title="Later days"
            onClick={() => setGridOffset(gridOffset + columns)}
          >
            ›
          </button>
          <button
            className={`px-2 py-0.5 text-xs rounded-md ${
              config.days_today_only ? "bg-accent/15 text-accent" : "btn-ghost"
            }`}
            title="Show only the Today column"
            onClick={() =>
              void useAppStore.getState().updateConfig({
                days_today_only: !config.days_today_only,
              })
            }
          >
            Today only
          </button>
          <DateJump />
          {gridOffset !== 0 && (
            <button
              className="btn-ghost px-2 py-0.5 text-xs"
              onClick={() => setGridOffset(0)}
            >
              Back to today
            </button>
          )}
          <div className="ml-auto flex items-center gap-1 text-xs text-content-muted">
            <span>Days</span>
            <select
              className="input px-1 py-0.5 text-xs"
              value={config.days_page_columns}
              onChange={(e) =>
                void useAppStore
                  .getState()
                  .updateConfig({ days_page_columns: Number(e.target.value) })
              }
            >
              {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          {/* same entry point as the dashboard header, and the same spot
              on every task view: the far right of the header */}
          <button
            className="btn-ghost px-2 py-0.5 text-xs"
            title="Add a task to any day or list"
            onClick={() => setQuickAddOpen(true)}
          >
            + Task
          </button>
        </div>
        <div
          className="grid min-h-0 flex-1 gap-3 overflow-x-auto"
          style={{
            gridTemplateColumns: `repeat(${dates.length}, minmax(200px, 1fr))`,
            gridTemplateRows: "minmax(0, 1fr)",
          }}
        >
          {dates.map((date) => (
            <DayColumn key={date} date={date} onOpenTask={setEditingTaskId} />
          ))}
        </div>
      </div>

      <DragOverlay>
        {dnd.activeTask && <TaskCard task={dnd.activeTask} overlay />}
      </DragOverlay>

      {editingTask && (
        <TaskModal task={editingTask} onClose={() => setEditingTaskId(null)} />
      )}
      {quickAddOpen && <QuickAddModal onClose={() => setQuickAddOpen(false)} />}
    </DndContext>
  );
}
