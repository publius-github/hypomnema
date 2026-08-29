import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { addDaysISO, gridDates } from "../lib/tasks";
import DayColumn from "../components/DayColumn";
import ListColumn from "../components/ListColumn";
import TaskCard from "../components/TaskCard";
import TaskModal from "../components/TaskModal";
import NewListForm from "../components/NewListForm";
import type { Task } from "../types";

export default function Dashboard() {
  const config = useAppStore((s) => s.config);
  const today = useAppStore((s) => s.today);
  const lists = useAppStore((s) => s.lists);
  const tasks = useAppStore((s) => s.tasks);
  const updateTask = useAppStore((s) => s.updateTask);
  const dashboard = useAppStore((s) => s.dashboard);
  const gridOffset = useAppStore((s) => s.gridOffset);
  const setGridOffset = useAppStore((s) => s.setGridOffset);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  // Moving the open task's date beyond the grid window drops it from
  // the snapshot; the modal must survive that (and keep unsaved edits),
  // so fall back to fetching the task by id.
  const [fetchedTask, setFetchedTask] = useState<Task | null>(null);
  // first visible list in the paged list zone
  const [listOffset, setListOffset] = useState(0);
  // live value while dragging the grid/lists divider; null = use config
  const [splitDraft, setSplitDraft] = useState<number | null>(null);
  const zonesRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

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
    invoke<Task>("task_get", { id: editingTaskId })
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

  const columns = config.dashboard_today_only ? 1 : config.grid_columns;
  const dates = gridDates(addDaysISO(today, gridOffset), columns);
  // fresh vault: nothing exists yet, so the automation features are
  // invisible - point at them once
  const freshVault = tasks.length === 0 && lists.length === 0;
  const activeTask = tasks.find((t) => t.id === activeTaskId) ?? null;
  const editingTask =
    tasks.find((t) => t.id === editingTaskId) ??
    (fetchedTask && fetchedTask.id === editingTaskId ? fetchedTask : null);

  const onDragStart = (event: DragStartEvent) => {
    setActiveTaskId(Number(String(event.active.id).replace("task:", "")));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveTaskId(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = Number(String(active.id).replace("task:", ""));
    const target = String(over.id);
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
      void useAppStore
        .getState()
        .reorderTask(taskId, Number(target.slice(5)));
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveTaskId(null)}
    >
      {/* min-h-full instead of h-full: a long All-lists index may push
          the page taller than the viewport, and then the main window
          scrollbar takes over (columns keep their internal scrolling) */}
      <div className="flex min-h-full flex-col gap-3 p-4">
        <div className="relative flex min-h-[24px] items-center">
          <div className="flex items-center gap-1">
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
                config.dashboard_today_only
                  ? "bg-accent/15 text-accent"
                  : "btn-ghost"
              }`}
              title="Show only the Today column"
              onClick={() =>
                void useAppStore.getState().updateConfig({
                  dashboard_today_only: !config.dashboard_today_only,
                })
              }
            >
              Today only
            </button>
            {gridOffset !== 0 && (
              <button
                className="btn-ghost px-2 py-0.5 text-xs"
                onClick={() => setGridOffset(0)}
              >
                Back to today
              </button>
            )}
          </div>
          {dashboard?.focus && (
            <button
              className="absolute left-1/2 -translate-x-1/2 text-sm font-medium italic text-accent hover:underline"
              title="Edit weekly-focus.yml"
              onClick={() =>
                useAppStore.getState().openConfigFile("weekly-focus.yml")
              }
            >
              {dashboard.focus}
            </button>
          )}
        </div>
        {freshVault && (
          <div className="mx-auto flex w-full max-w-xl flex-col gap-2 rounded-lg border border-line bg-surface-alt p-4 text-sm">
            <span className="font-semibold">Getting started</span>
            <span className="text-content-muted">
              Click &quot;+ Add task&quot; in any day column; a{" "}
              {"{Category}"} prefix in the title shows as a label on the
              card. Lists live in the bottom zone (&quot;+ New list&quot;).
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
        <div ref={zonesRef} className="flex flex-1 flex-col">
          <div
            className="grid min-h-0 gap-3 overflow-x-auto"
            style={{
              flex: `${splitDraft ?? config.dashboard_split} 1 0px`,
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

          <div
            className="group -my-1 shrink-0 cursor-row-resize py-2"
            title="Drag to resize"
            onPointerDown={(e) => {
              e.preventDefault();
              const container = zonesRef.current;
              if (!container) return;
              const height = container.getBoundingClientRect().height;
              const start = splitDraft ?? config.dashboard_split;
              const startY = e.clientY;
              const at = (ev: PointerEvent) =>
                Math.round(
                  Math.min(
                    80,
                    Math.max(20, start + ((ev.clientY - startY) / height) * 100),
                  ),
                );
              const onMove = (ev: PointerEvent) => setSplitDraft(at(ev));
              const onUp = (ev: PointerEvent) => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                setSplitDraft(null);
                void useAppStore
                  .getState()
                  .updateConfig({ dashboard_split: at(ev) });
              };
              window.addEventListener("pointermove", onMove);
              window.addEventListener("pointerup", onUp);
            }}
          >
            <div className="h-px w-full bg-line group-hover:bg-accent/60" />
          </div>

          <ListZone
            split={splitDraft ?? config.dashboard_split}
            perPage={config.list_columns}
            offset={listOffset}
            setOffset={setListOffset}
            onOpenTask={setEditingTaskId}
          />
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

/**
 * The bottom list zone: shows `perPage` list columns stretched to the
 * full width, the rest are paged with the edge arrows.
 */
function ListZone({
  split,
  perPage,
  offset,
  setOffset,
  onOpenTask,
}: {
  split: number;
  perPage: number;
  offset: number;
  setOffset: (n: number) => void;
  onOpenTask: (id: number) => void;
}) {
  const lists = useAppStore((s) => s.lists);
  const tasks = useAppStore((s) => s.tasks);
  // engine-created lists ({List} prefixes, Birthdays) only group tasks
  // inside day columns; they earn a backlog column only when something
  // unscheduled lands in them
  const visible = lists.filter(
    (list) =>
      !list.auto ||
      tasks.some(
        (t) =>
          t.list_id === list.id &&
          (!t.scheduled_date || t.priority) &&
          t.parent_task_id === null,
      ),
  );
  const maxOffset = Math.max(0, visible.length - perPage);
  const off = Math.min(offset, maxOffset);
  const page = visible.slice(off, off + perPage);

  const arrow = (delta: number, disabled: boolean, label: string) => (
    <button
      className="btn-ghost self-stretch px-1 text-lg leading-none disabled:opacity-20"
      title={label}
      disabled={disabled}
      onClick={() => setOffset(Math.max(0, Math.min(maxOffset, off + delta)))}
    >
      {delta < 0 ? "‹" : "›"}
    </button>
  );

  return (
    <div
      className="flex items-stretch gap-2 pt-1"
      style={{ flex: `${100 - split} 1 0px` }}
    >
      {visible.length > perPage && arrow(-1, off === 0, "Previous lists")}
      <div
        className="grid min-h-0 min-w-0 flex-1 gap-3"
        style={{
          gridTemplateColumns: `repeat(${Math.max(page.length, 1)}, minmax(0, 1fr))`,
        }}
      >
        {page.map((list) => (
          <ListColumn key={list.id} list={list} onOpenTask={onOpenTask} />
        ))}
      </div>
      {visible.length > perPage && arrow(1, off >= maxOffset, "More lists")}
      {/* never collapsed and never scrolls on its own: the index shows
          at full length, and when it is taller than the viewport the
          whole dashboard page scrolls via the main scrollbar */}
      <div className="flex shrink-0 flex-col gap-3">
        <NewListForm />
        {visible.length > perPage && (
          <div className="flex w-40 flex-col gap-0.5 rounded-lg border border-line bg-surface-alt/50 p-1.5">
            <div className="px-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
              All lists
            </div>
            {visible.map((list, i) => {
              const onPage = i >= off && i < off + perPage;
              return (
                <button
                  key={list.id}
                  className={`shrink-0 truncate rounded px-1.5 py-0.5 text-left text-xs ${
                    onPage
                      ? "bg-accent/15 text-accent"
                      : "text-content-muted hover:bg-line/40 hover:text-content"
                  }`}
                  title={`Jump to "${list.name}"`}
                  onClick={() => setOffset(Math.min(i, maxOffset))}
                >
                  {list.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
