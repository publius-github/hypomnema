/** The tree's mark on a conflicted copy (`isConflictedCopy`): resolved
 * from Settings → Sync, or by hand. */
export default function ConflictBadge() {
  return (
    <span
      className="ml-1 shrink-0 rounded bg-warn/15 px-1 text-[10px] font-semibold uppercase leading-4 text-warn"
      title="A conflicted copy: compare and resolve it under Settings → Sync"
    >
      conflict
    </span>
  );
}
