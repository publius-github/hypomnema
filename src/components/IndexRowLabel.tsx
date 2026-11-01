import type { IndexRow } from "../lib/tasks";
import ListKindMark from "./ListKindMark";
import ListModal from "./ListModal";
import GroupModal from "./GroupModal";

/**
 * The text of one All-lists index row (Dashboard list zone, Lists
 * page). A top-level list starts flush at the left edge, where a group
 * row has its ▸ - so the index reads as one left edge with the groups'
 * markers standing in it - and a group's members hang one step further
 * in than the group's own name.
 */
export default function IndexRowLabel({
  row,
  name,
}: {
  row: IndexRow;
  name: string;
}) {
  return (
    <>
      {row.type === "group" && (
        <span aria-hidden className="w-3 shrink-0 text-xs leading-none">
          ▸
        </span>
      )}
      {row.type === "list" && row.nested && (
        // marker (w-3) + gap + one nesting step
        <span aria-hidden className="w-5 shrink-0" />
      )}
      <span className="min-w-0 truncate">{name}</span>
      {row.type === "list" && <ListKindMark list={row.list} compact />}
    </>
  );
}

/**
 * The settings dialog of an All-lists index row, opened by a right-click
 * on the row: a list's dialog or a group's. The index is the one place
 * every group is named - a flat panel (`lists_group_display`) gives a
 * group no tile, and an empty group no chip on a list header either, so
 * without this an empty group could not be renamed or deleted at all.
 */
export function IndexRowSettings({
  row,
  onClose,
}: {
  row: IndexRow;
  onClose: () => void;
}) {
  return row.type === "group" ? (
    <GroupModal group={row.group} onClose={onClose} />
  ) : (
    <ListModal list={row.list} onClose={onClose} />
  );
}
