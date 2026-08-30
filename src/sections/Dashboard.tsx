import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useAppStore } from "../store";
import { addDaysISO, gridDates, orderLists } from "../lib/tasks";
import { useTaskDnd } from "../components/taskDnd";
import DayColumn from "../components/DayColumn";
import ListColumn from "../components/ListColumn";
import TaskCard from "../components/TaskCard";
import TaskModal from "../components/TaskModal";
import QuickAddModal from "../components/QuickAddModal";
import NewListForm from "../components/NewListForm";
import type { Task } from "../types";

export default function Dashboard() {
  const config = useAppStore((s) => s.config);
  const today = useAppStore((s) => s.today);
  const lists = useAppStore((s) => s.lists);
  const tasks = useAppStore((s) => s.tasks);
  const dashboard = useAppStore((s) => s.dashboard);
  const gridOffset = useAppStore((s) => s.gridOffset);
  const setGridOffset = useAppStore((s) => s.setGridOffset);
  const dnd = useTaskDnd();
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  // Moving the open task's date beyond the grid window drops it from
  // the snapshot; the modal must survive that (and keep unsaved edits),
  // so fall back to fetching the task by id.
  const [fetchedTask, setFetchedTask] = useState<Task | null>(null);
  // first visible list in the paged list zone; store-held so the page
  // survives switching sections and coming back
  const listOffset = useAppStore((s) => s.listOffset);
  const setListOffset = useAppStore((s) => s.setListOffset);
  // live value while dragging the grid/lists divider; null = use config
  const [splitDraft, setSplitDraft] = useState<number | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const zonesRef = useRef<HTMLDivElement | null>(null);

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
      {/* Two scrollbars by design: the day grid has a viewport-bound
          height and its columns scroll internally; the list zone below
          grows with its content, and the page scrollbar (min-h-full)
          reaches everything - long lists never collapse or scroll on
          their own. */}
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
          <button
            className="btn-ghost ml-auto px-2 py-0.5 text-xs"
            title="Add a task to any day or list"
            onClick={() => setQuickAddOpen(true)}
          >
            + Task
          </button>
          {dashboard?.focus && (
            <button
              className="absolute left-1/2 -translate-x-1/2 text-sm font-medium italic text-accent hover:underline"
              style={
                config.weekly_focus_color
                  ? { color: config.weekly_focus_color }
                  : undefined
              }
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
        <div ref={zonesRef} className="flex flex-col">
          {/* split% of the viewport (minus the header chrome), so the
              grid keeps its height no matter how long the lists get */}
          <div
            className="grid gap-3 overflow-x-auto"
            style={{
              height: `calc((100vh - 120px) * ${splitDraft ?? config.dashboard_split} / 100)`,
              gridTemplateColumns: `repeat(${dates.length}, minmax(200px, 1fr))`,
              gridTemplateRows: "minmax(0, 1fr)",
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
              // the split is a share of the viewport-bound grid budget,
              // not of the (content-sized) zones container
              const height = Math.max(200, window.innerHeight - 120);
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
            perPage={config.list_columns}
            offset={listOffset}
            setOffset={setListOffset}
            onOpenTask={setEditingTaskId}
          />
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

/**
 * The bottom list zone: shows `perPage` list columns stretched to the
 * full width, the rest are paged with the edge arrows.
 */
function ListZone({
  perPage,
  offset,
  setOffset,
  onOpenTask,
}: {
  perPage: number;
  offset: number;
  setOffset: (n: number) => void;
  onOpenTask: (id: number) => void;
}) {
  const lists = useAppStore((s) => s.lists);
  const tasks = useAppStore((s) => s.tasks);
  const listsAlpha = useAppStore((s) => s.config?.lists_sort_alpha ?? false);
  const visible = orderLists(lists, tasks, listsAlpha);
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
    <div className="flex items-stretch gap-2 pt-1">
      {visible.length > perPage && arrow(-1, off === 0, "Previous lists")}
      <div
        className="grid min-w-0 flex-1 gap-3 content-start"
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
          at full length, reachable via the page scrollbar */}
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
