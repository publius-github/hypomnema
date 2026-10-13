import type { TaskStatus } from "../types";

// The status checkbox look shared by the task cards and the list
// dialog rows. Done, waiting and dropped take their configurable colors
// via the --color-done / --color-waiting / --color-dropped vars; the
// others use theme tokens.
const STATUS_BOX: Record<TaskStatus, string> = {
  todo: "border-content-muted text-content-muted",
  done: "text-white",
  postponed: "border-warn bg-warn text-white",
  waiting: "border-waiting bg-waiting text-white",
  dropped: "border-dropped bg-dropped text-white",
};

const DONE_BOX_STYLE = {
  backgroundColor: "var(--color-done)",
  borderColor: "var(--color-done)",
};

export function statusBoxClass(status: TaskStatus): string {
  return STATUS_BOX[status];
}

export function statusBoxStyle(status: TaskStatus) {
  return status === "done" ? DONE_BOX_STYLE : undefined;
}

/** The mark inside the status box; an SVG sits dead-center where a
 *  glyph rode on its font baseline and looked shifted. */
export function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === "todo") return null;
  return (
    <svg
      viewBox="0 0 12 12"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={status === "done" ? 2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {status === "done" && <path d="M2.5 6.5l2.5 2.5l4.5 -5" />}
      {status === "postponed" && (
        <>
          <path d="M1.5 6h8" />
          <path d="M6.5 3l3 3-3 3" />
        </>
      )}
      {status === "waiting" && (
        // a clock: the part that is left is someone else's
        <>
          <circle cx="6" cy="6" r="4.3" />
          <path d="M6 3.6V6l1.7 1.1" />
        </>
      )}
      {status === "dropped" && <path d="M3.2 3.2l5.6 5.6M8.8 3.2l-5.6 5.6" />}
    </svg>
  );
}
