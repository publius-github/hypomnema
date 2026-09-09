import { useCallback, useEffect, useRef, useState } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useAppStore } from "../store";
import type { AppConfig } from "../types";
import { indexRows, orderLists, orderPanel } from "../lib/tasks";
import type { IndexRow } from "../lib/tasks";
import { useTaskDnd } from "../components/taskDnd";
import ListColumn from "../components/ListColumn";
import GroupColumn from "../components/GroupColumn";
import TaskCard from "../components/TaskCard";
import TaskModal from "../components/TaskModal";
import NewListForm from "../components/NewListForm";
import GroupBackBar from "../components/GroupBackBar";
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
  // an open group takes over the grid: its lists render as full columns
  // under a back bar, the other panel slots step aside
  const [openGroupId, setOpenGroupId] = useState<number | null>(null);
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

  const jumpTo = useCallback((id: string) => {
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
  }, []);

  // entering a group via one of its member rows highlights that list -
  // same cue as the All-lists index; the jump has to wait until the
  // group's columns are actually on the page
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  useEffect(() => {
    if (pendingJump === null) return;
    jumpTo(pendingJump);
    setPendingJump(null);
  }, [pendingJump, jumpTo]);

  // the mouse's back button leaves the group view, like a browser page
  useEffect(() => {
    if (openGroupId === null) return;
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 3) return;
      e.preventDefault();
      setOpenGroupId(null);
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [openGroupId]);

  if (!config) return null;
  const openGroup = groups.find((g) => g.id === openGroupId) ?? null;
  const visible = openGroup
    ? orderLists(
        lists.filter((l) => l.group_id === openGroup.id),
        tasks,
        config.lists_sort_alpha,
      ).map((list) => ({ type: "list" as const, list }))
    : orderPanel(
        lists,
        groups,
        tasks,
        config.lists_sort_alpha,
        config.lists_group_display === "flat",
      );
  const groupOf = (listId: number) => {
    const gid = lists.find((l) => l.id === listId)?.group_id ?? null;
    return gid === null ? null : (groups.find((g) => g.id === gid) ?? null);
  };
  const itemKey = (item: (typeof visible)[number] | IndexRow) =>
    item.type === "list" ? `l${item.list.id}` : `g${item.group.id}`;
  const itemName = (item: (typeof visible)[number] | IndexRow) =>
    item.type === "list" ? item.list.name : item.group.name;
  // inside a group the index is that group's lists; outside it follows
  // the folded shape whatever the panel does, so flat still shows the
  // groups - with their members indented under them
  const rows: IndexRow[] = openGroup
    ? visible.flatMap((item) =>
        item.type === "list"
          ? [{ type: "list" as const, list: item.list, nested: false }]
          : [],
      )
    : indexRows(
        lists,
        groups,
        tasks,
        config.lists_sort_alpha,
        config.lists_group_display === "flat",
      );
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
          {openGroup ? (
            <GroupBackBar
              group={openGroup}
              onBack={() => setOpenGroupId(null)}
              className="flex items-center gap-2 rounded px-1 text-sm font-semibold"
            />
          ) : (
            <span className="text-sm font-semibold">Lists</span>
          )}
          {/* the panel shape belongs next to the column count, not three
              clicks away in Settings - both write the same config, the
              Layout tab keeps its own copy */}
          {!openGroup && (
            <div className="ml-auto flex items-center gap-1 text-xs text-content-muted">
              <span>Groups</span>
              <select
                className="input px-1 py-0.5 text-xs"
                title="Folded: one tile per group. Flat: every list its own column, with its group as a chip on the header."
                value={config.lists_group_display}
                onChange={(e) =>
                  void useAppStore.getState().updateConfig({
                    lists_group_display: e.target
                      .value as AppConfig["lists_group_display"],
                  })
                }
              >
                <option value="folded">Folded</option>
                <option value="flat">Flat</option>
              </select>
            </div>
          )}
          <div
            className={`flex items-center gap-1 text-xs text-content-muted${
              openGroup ? " ml-auto" : ""
            }`}
          >
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
                    group={openGroup ? null : groupOf(item.list.id)}
                    onOpenTask={setEditingTaskId}
                    onOpenGroup={setOpenGroupId}
                    fill={config.lists_page_align_rows}
                    highlight={highlightId === itemKey(item)}
                  />
                ) : (
                  <GroupColumn
                    group={item.group}
                    onOpen={(listId) => {
                      setOpenGroupId(item.group.id);
                      if (listId !== undefined) setPendingJump(`l${listId}`);
                    }}
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
            <NewListForm groupId={openGroup?.id} />
            {(openGroup !== null || rows.length > columns) &&
              rows.length > 0 && (
              <div className="flex flex-col gap-0.5 rounded-lg border border-line bg-surface-alt/50 p-1.5">
                <div className="px-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
                  {openGroup ? "Group lists" : "All lists"}
                </div>
                {rows.map((row) => {
                  // a flat panel has no group column to scroll to, so
                  // the group's own row drills in, like its header chip
                  const drillIn =
                    row.type === "group" &&
                    config.lists_group_display === "flat";
                  return (
                    <button
                      key={itemKey(row)}
                      className={`shrink-0 truncate rounded px-1.5 py-0.5 text-left text-xs ${
                        row.type === "list" && row.nested ? "pl-4 " : ""
                      }${
                        highlightId === itemKey(row)
                          ? "bg-accent/15 text-accent"
                          : "text-content-muted hover:bg-line/40 hover:text-content"
                      }`}
                      title={
                        drillIn
                          ? `Open group "${itemName(row)}"`
                          : `Scroll to "${itemName(row)}"`
                      }
                      onClick={() =>
                        drillIn && row.type === "group"
                          ? setOpenGroupId(row.group.id)
                          : jumpTo(itemKey(row))
                      }
                    >
                      {row.type === "group" ? "▸ " : ""}
                      {itemName(row)}
                    </button>
                  );
                })}
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
