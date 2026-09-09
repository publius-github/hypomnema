import { memo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";
import { orderLists } from "../lib/tasks";
import GroupModal from "./GroupModal";
import type { ListGroup } from "../types";

/**
 * A group's tile in the list panel: an index of the group's lists
 * (name, color, open count) - the lists themselves stay off the panel.
 * Clicking the tile (or any row in it) opens the group view: the whole
 * panel switches to the group's lists as full columns under a back bar
 * (the panel owns that state; the tile only reports the click).
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
  const alpha = useAppStore((s) => s.config?.lists_sort_alpha ?? false);
  const members = useAppStore(
    useShallow((s) => s.lists.filter((l) => l.group_id === group.id)),
  );
  const tasks = useAppStore((s) => s.tasks);
  const ordered = orderLists(members, tasks, alpha);

  const openCount = (listId: number) =>
    tasks.filter(
      (t) =>
        t.list_id === listId &&
        t.parent_task_id === null &&
        t.status === "todo" &&
        (t.scheduled_date === null || t.priority || t.origin === "manual"),
    ).length;

  return (
    <div
      className={`flex min-w-0 flex-col rounded-lg border border-line bg-surface-alt/50 ${
        fill ? "h-full" : ""
      } ${highlight ? "ring-2 ring-accent" : ""}`}
    >
      <div className="group flex items-center gap-2 px-2.5 py-2">
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-bold uppercase tracking-wide text-content hover:text-accent"
          title={`Open group "${group.name}"`}
          onClick={() => onOpen()}
        >
          {group.color && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: group.color }}
            />
          )}
          <span className="truncate">{group.name}</span>
          <span className="shrink-0 text-[11px] font-normal normal-case tracking-normal text-content-muted">
            {ordered.length} {ordered.length === 1 ? "list" : "lists"}
          </span>
        </button>
        <button
          className="text-base leading-none text-content-muted opacity-0 hover:text-content focus-visible:opacity-100 group-hover:opacity-100"
          title="Group settings: name, color, lists, delete"
          onClick={() => setDetailsOpen(true)}
        >
          ⋯
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-2 pb-2">
        {ordered.length === 0 && (
          <span className="px-1 py-2 text-xs text-content-muted">
            No lists yet - add some via ⋯ or a list's settings.
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
                className="h-3 w-1 shrink-0 rounded"
                style={{ backgroundColor: list.color }}
              />
            )}
            <span className="min-w-0 flex-1 truncate">{list.name}</span>
            <span className="shrink-0 text-[11px] text-content-muted">
              {openCount(list.id)}
            </span>
          </button>
        ))}
      </div>
      {detailsOpen && (
        <GroupModal group={group} onClose={() => setDetailsOpen(false)} />
      )}
    </div>
  );
}

export default memo(GroupColumn);
