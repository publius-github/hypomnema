import type { IndexRow } from "../lib/tasks";

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
    </>
  );
}
