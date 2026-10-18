import { memo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";
import { orderLists } from "../lib/tasks";
import GroupModal from "./GroupModal";
import type { ListGroup } from "../types";
import { readable } from "../lib/color";

/**
 * A group's tile in the list panel: an index of the group's lists
 * (name, color, open count) - the lists themselves stay off the panel.
 * Clicking the tile (or any row in it) opens the group view: the whole
 * panel switches to the group's lists as full columns under a back bar
 * (the panel owns that state; the tile only reports the click).
 *
 * The tile is also where a group is filled: a new list can be created
 * straight into it and an existing one moved in, either from the picker
 * under the index or by dragging a list column's grip onto the tile.
 * An empty group that only said "add some via ⋯" was a dead end.
 */
function GroupColumn({
  group,
  onOpen,
  fill = false,
  highlight = false,
}: {
  group: ListGroup;
  /**
   * open the panel's group view for this group; a click on a member row
   * passes that list's id so the view can highlight the clicked list
   */
  onOpen: (listId?: number) => void;
  /** stretch to the parent's height (Lists page row alignment) */
  fill?: boolean;
  /** flash ring after a jump from the All-lists index */
  highlight?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  // "new" types a name, "existing" picks one of the lists outside this
  // group; closed the tile shows the two buttons instead
  const [adding, setAdding] = useState<"new" | "existing" | null>(null);
  const [name, setName] = useState("");
  const alpha = useAppStore((s) => s.config?.lists_sort_alpha ?? false);
  const members = useAppStore(
    useShallow((s) => s.lists.filter((l) => l.group_id === group.id)),
  );
  // the "+ Existing" picker is read by looking for a name, so it is
  // alphabetical rather than in the panel's order
  const outsiders = useAppStore(
    useShallow((s) =>
      s.lists
        .filter((l) => !l.auto && l.group_id !== group.id)
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, {
            sensitivity: "base",
            numeric: true,
          }),
        ),
    ),
  );
  const tasks = useAppStore((s) => s.tasks);
  const createList = useAppStore((s) => s.createList);
  const setListGroup = useAppStore((s) => s.setListGroup);
  const ordered = orderLists(members, tasks, alpha);
  // a list column's grip can be dropped straight onto the tile
  const { setNodeRef, isOver } = useDroppable({ id: `group:${group.id}` });

  const openCount = (listId: number) =>
    tasks.filter(
      (t) =>
        t.list_id === listId &&
        t.parent_task_id === null &&
        t.status === "todo" &&
        (t.scheduled_date === null || t.priority || t.origin === "manual"),
    ).length;

  // double-click on the tile's free space opens the group dialog, the
  // same gesture a list column answers with its own dialog
  const openOnFreeSpace = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setDetailsOpen(true);
  };

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-0 flex-col rounded-lg border ${
        isOver ? "border-accent" : "border-line"
      } bg-surface-alt/50 ${fill ? "h-full" : ""} ${
        highlight ? "ring-2 ring-accent" : ""
      }`}
      onDoubleClick={openOnFreeSpace}
    >
      <div
        className="group flex items-center gap-2 px-2.5 py-2"
        onDoubleClick={openOnFreeSpace}
      >
        <h2 className="flex min-w-0 flex-1">
          <button
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-bold text-content hover:text-accent"
            title={`Open group "${group.name}"`}
            onClick={() => onOpen()}
          >
            {group.color && (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: readable(group.color, "mark") }}
              />
            )}
            <span className="truncate">{group.name}</span>
            <span className="shrink-0 text-[0.6875rem] font-normal normal-case tracking-normal text-content-muted">
              {ordered.length} {ordered.length === 1 ? "list" : "lists"}
            </span>
          </button>
        </h2>
        <button
          className="text-base leading-none text-content-muted opacity-0 hover:text-content focus-visible:opacity-100 group-hover:opacity-100"
          title="Group settings: name, color, lists, delete"
          aria-label="Group settings: name, color, lists, delete"
          onClick={() => setDetailsOpen(true)}
        >
          ⋯
        </button>
      </div>
      <div
        className="flex flex-1 flex-col gap-1 px-2 pb-2"
        onDoubleClick={openOnFreeSpace}
      >
        {ordered.length === 0 && (
          <span className="px-1 py-2 text-xs text-content-muted">
            No lists yet - add one below, or drag a list column here.
          </span>
        )}
        {ordered.map((list) => (
          <button
            key={list.id}
            className="flex items-center gap-2 rounded-md border border-line bg-surface-alt px-2 py-1.5 text-left text-sm hover:border-accent"
            title={`Open group "${group.name}"`}
            onClick={() => onOpen(list.id)}
          >
            {list.color && (
              <span
                className="h-3 w-1 shrink-0 rounded-sm"
                style={{ backgroundColor: readable(list.color, "mark") }}
              />
            )}
            <span className="min-w-0 flex-1 truncate">{list.name}</span>
            <span className="shrink-0 text-[0.6875rem] text-content-muted">
              {openCount(list.id)}
            </span>
          </button>
        ))}

        {adding === null && (
          <div className="mt-1 flex gap-1">
            <button
              className="flex-1 rounded-md border border-dashed border-line px-2 py-1 text-xs text-content-muted hover:border-accent hover:text-accent"
              title="Create a list directly in this group"
              onClick={() => {
                setName("");
                setAdding("new");
              }}
            >
              + List
            </button>
            {outsiders.length > 0 && (
              <button
                className="flex-1 rounded-md border border-dashed border-line px-2 py-1 text-xs text-content-muted hover:border-accent hover:text-accent"
                title="Move an existing list into this group"
                onClick={() => setAdding("existing")}
              >
                + Existing
              </button>
            )}
          </div>
        )}
        {adding === "new" && (
          <form
            className="mt-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void createList(name.trim(), group.id);
              setName("");
              setAdding(null);
            }}
          >
            <input
              className="input w-full text-xs"
              placeholder="List name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                setName("");
                setAdding(null);
              }}
            />
          </form>
        )}
        {adding === "existing" && (
          <select
            className="input mt-1 w-full text-xs"
            autoFocus
            defaultValue=""
            onBlur={() => setAdding(null)}
            onChange={(e) => {
              const id = Number(e.target.value);
              setAdding(null);
              if (id) void setListGroup(id, group.id);
            }}
          >
            <option value="">Move a list in…</option>
            {outsiders.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
                {list.group_id !== null ? " (in another group)" : ""}
              </option>
            ))}
          </select>
        )}
      </div>
      {detailsOpen && (
        <GroupModal group={group} onClose={() => setDetailsOpen(false)} />
      )}
    </div>
  );
}

export default memo(GroupColumn);
