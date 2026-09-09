import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import GroupModal from "./GroupModal";
import type { ListGroup } from "../types";

/**
 * The bar over an open group's columns: the way back to the whole panel,
 * the group's own ⋯ dialog, and the way out of the group for a list -
 * dropping a list column's grip on it releases the list, the mirror of
 * dropping one on a group tile. Leaving is the same gesture as joining,
 * pointed the other way.
 *
 * The ⋯ is here and not only on the group tile because a flat panel
 * (`lists_group_display`) shows no tiles at all, and a group still has
 * to be renamable from somewhere.
 */
export default function GroupBackBar({
  group,
  onBack,
  className,
}: {
  group: ListGroup;
  onBack: () => void;
  /** the host panel's own sizing/typography for the bar */
  className: string;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: "group:none" });
  return (
    <div
      ref={setNodeRef}
      className={`${className} ${isOver ? "ring-1 ring-accent" : ""}`}
    >
      <button
        className="flex min-w-0 items-center gap-1.5 hover:text-accent"
        title={`Back to all lists - or drop a list here to take it out of "${group.name}"`}
        onClick={onBack}
      >
        <span>‹</span>
        {group.color && (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: group.color }}
          />
        )}
        <span className="truncate">{group.name}</span>
      </button>
      <button
        className="leading-none hover:text-accent"
        title="Group settings: name, color, lists, delete"
        onClick={() => setDetailsOpen(true)}
      >
        ⋯
      </button>
      {detailsOpen && (
        <GroupModal group={group} onClose={() => setDetailsOpen(false)} />
      )}
    </div>
  );
}
