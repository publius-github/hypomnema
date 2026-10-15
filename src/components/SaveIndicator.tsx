import type { SaveState } from "../sections/kb/util";

/**
 * An editor's save state in its header. A failed save says so and offers
 * a retry instead of reading "Saving..." forever: the text is still held
 * in memory, and leaving the editor tries once more.
 */
export default function SaveIndicator({
  state,
  onRetry,
}: {
  state: SaveState;
  onRetry: () => void;
}) {
  if (state === "failed") {
    return (
      <button
        className="text-xs font-semibold text-danger hover:underline"
        title="The last save did not reach the disk; try again"
        onClick={onRetry}
      >
        Not saved · Retry
      </button>
    );
  }
  return (
    <span className="text-xs text-content-muted">
      {state === "saved" ? "Saved" : "Saving..."}
    </span>
  );
}
