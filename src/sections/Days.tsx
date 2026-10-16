import { useState } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useAppStore } from "../store";
import { useEditingTask } from "../hooks/useEditingTask";
import { addDaysISO, gridDates } from "../lib/tasks";
import { useTaskDnd, DND_ACCESSIBILITY } from "../components/taskDnd";
import DateJump from "../components/DateJump";
import DayColumn from "../components/DayColumn";
import TaskCard from "../components/TaskCard";
import TaskModal from "../components/TaskModal";
import QuickAddModal from "../components/QuickAddModal";
import { counts, HeaderControls, HeaderSelect } from "../components/HeaderControls";
import NavArrow from "../components/NavArrow";

/**
 * Dedicated day-grid dashboard: the week columns at full height, no
 * list zone - the deep-work view over the calendar days.
 */
export default function Days() {
  const config = useAppStore((s) => s.config);
  const today = useAppStore((s) => s.today);
  const gridOffset = useAppStore((s) => s.gridOffset);
  const setGridOffset = useAppStore((s) => s.setGridOffset);
  const { setEditingTaskId, editingTask } = useEditingTask();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const dnd = useTaskDnd();

  if (!config) return null;
  // the page has its own focus controls, independent of the dashboard:
  // a Today-only toggle and its own day count
  const columns = config.days_today_only ? 1 : config.days_page_columns;
  const dates = gridDates(addDaysISO(today, gridOffset), columns);

  return (
    <DndContext
      accessibility={DND_ACCESSIBILITY}
      sensors={dnd.sensors}
      onDragStart={dnd.onDragStart}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
    >
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex min-h-[24px] items-center gap-1">
          <NavArrow
            dir={-1}
            title="Earlier days"
            onClick={() => setGridOffset(gridOffset - columns)}
          />
          <NavArrow
            dir={1}
            title="Later days"
            onClick={() => setGridOffset(gridOffset + columns)}
          />
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
          <HeaderControls>
            <HeaderSelect
              label="Days"
              value={config.days_page_columns}
              options={counts(Array.from({ length: 14 }, (_, i) => i + 1))}
              onChange={(n) =>
                void useAppStore
                  .getState()
                  .updateConfig({ days_page_columns: n })
              }
            />
            {/* same entry point as the dashboard header, and the same
                spot on every task view: the far right of the header */}
            <button
              className="btn-ghost px-2 py-0.5 text-xs"
              title="Add a task to any day or list"
              onClick={() => setQuickAddOpen(true)}
            >
              + Task
            </button>
          </HeaderControls>
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
