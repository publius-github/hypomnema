import { useEffect, useRef, useState } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useAppStore } from "../store";
import { orderPanel } from "../lib/tasks";
import { useTaskDnd } from "../components/taskDnd";
import ListColumn from "../components/ListColumn";
import GroupColumn from "../components/GroupColumn";
import TaskCard from "../components/TaskCard";
import TaskModal from "../components/TaskModal";
import NewListForm from "../components/NewListForm";
import QuickAddModal from "../components/QuickAddModal";

/**
 * Dedicated lists dashboard: every list at once in a wrapping grid,
 * no day columns - the deep-work view over the backlogs. The column
 * count is a setting, adjustable right here.
 */
export default function Lists() {
  const config = useAppStore((s) => s.config);
  const lists = useAppStore((s) => s.lists);
  const groups = useAppStore((s) => s.groups);
  const tasks = useAppStore((s) => s.tasks);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // the column just jumped to via the All-lists index wears a short
  // accent ring, so the eye finds it among many lists; keys are
  // "l<id>"/"g<id>" - list and group ids live in separate sequences
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (highlightTimer.current !== null)
        window.clearTimeout(highlightTimer.current);
    },
    [],
  );
  const dnd = useTaskDnd();

  if (!config) return null;
  const visible = orderPanel(lists, groups, tasks, config.lists_sort_alpha);
  const itemKey = (item: (typeof visible)[number]) =>
    item.type === "list" ? `l${item.list.id}` : `g${item.group.id}`;
  const itemName = (item: (typeof visible)[number]) =>
    item.type === "list" ? item.list.name : item.group.name;
  const columns = Math.max(1, config.lists_page_columns);
  const editingTask = tasks.find((t) => t.id === editingTaskId) ?? null;

  const jumpTo = (id: string) => {
    document
      .getElementById(`lists-page-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlightId(id);
    if (highlightTimer.current !== null)
      window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(
      () => setHighlightId(null),
      2000,
    );
  };

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
        <div className="flex items-start gap-3">
          <div
            className="grid min-w-0 flex-1 content-start gap-3"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {visible.map((item) => (
              <div key={itemKey(item)} id={`lists-page-${itemKey(item)}`}>
                {item.type === "list" ? (
                  <ListColumn
                    list={item.list}
                    onOpenTask={setEditingTaskId}
                    fill={config.lists_page_align_rows}
                    highlight={highlightId === itemKey(item)}
                  />
                ) : (
                  <GroupColumn
                    group={item.group}
                    onOpenTask={setEditingTaskId}
                    fill={config.lists_page_align_rows}
                    highlight={highlightId === itemKey(item)}
                  />
                )}
              </div>
            ))}
          </div>
          {/* sticky right rail, same layout as the dashboard list zone:
              the New list button on top, then the All-lists index - both
              stay on screen while the grid scrolls. A click on the index
              scrolls the column into view and flashes it. */}
          <div className="sticky top-4 flex w-40 shrink-0 flex-col gap-3">
            <NewListForm />
            {visible.length > columns && (
              <div className="flex flex-col gap-0.5 rounded-lg border border-line bg-surface-alt/50 p-1.5">
                <div className="px-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
                  All lists
                </div>
                {visible.map((item) => (
                  <button
                    key={itemKey(item)}
                    className={`shrink-0 truncate rounded px-1.5 py-0.5 text-left text-xs ${
                      highlightId === itemKey(item)
                        ? "bg-accent/15 text-accent"
                        : "text-content-muted hover:bg-line/40 hover:text-content"
                    }`}
                    title={`Scroll to "${itemName(item)}"`}
                    onClick={() => jumpTo(itemKey(item))}
                  >
                    {item.type === "group" ? "▸ " : ""}
                    {itemName(item)}
                  </button>
                ))}
              </div>
            )}
          </div>
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
      {quickAddOpen && <QuickAddModal onClose={() => setQuickAddOpen(false)} />}
    </DndContext>
  );
}
