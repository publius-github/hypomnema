import { useCallback, useState } from "react";
import type { ConflictEntry } from "../types";
import ConflictReview from "./ConflictReview";

/** What a log entry was about, in words: the raw markers mean nothing. */
function subject(field: string): string {
  if (field === "<file>") return "whole file";
  if (field === "<record>") return "whole entry";
  return field;
}

/** RFC3339 UTC -> "2026-10-14 21:01" in this device's local time: the
 * log stamps in UTC, and a person reads a clock in their own zone. */
function when(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 16).replace("T", " ");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * The sync conflict log, shared by the desktop's Sync tab and the
 * phone's Sync settings. The backend hands entries over sorted and
 * labelled (`sync_conflicts::for_display`): a decision that left a
 * conflicted copy still sitting in the vault is "open" and comes first,
 * because it is the only kind that asks anything of the user; the rest
 * record what the merge chose on its own.
 */
export default function ConflictList({
  entries,
  compact = false,
  onChanged,
}: {
  entries: ConflictEntry[];
  /** a conflicted copy was settled: the caller reloads the log */
  onChanged: () => void;
  /** the desktop's denser type */
  compact?: boolean;
}) {
  const [reviewing, setReviewing] = useState<
    (ConflictEntry & { copy: string }) | null
  >(null);
  const close = useCallback(() => setReviewing(null), []);
  return (
    <>
      <ul className={`flex flex-col ${compact ? "gap-1" : "gap-3"}`}>
        {entries.map((entry, i) => (
          <li
            key={`${entry.at}-${entry.path}-${entry.field}-${i}`}
            className={`rounded-lg border ${
              entry.open ? "border-warn/60" : "border-line"
            } ${compact ? "p-2 text-xs" : "p-3 text-sm"}`}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 break-all font-medium">
                {entry.path}
              </div>
              {entry.open && (
                <span className="shrink-0 rounded-sm bg-warn/15 px-1 text-[0.625rem] font-semibold uppercase leading-4 text-warn">
                  to review
                </span>
              )}
            </div>
            <div className="text-xs text-content-muted">
              {subject(entry.field)} · {when(entry.at)}
            </div>
            {entry.open && entry.copy ? (
              <p className="mt-2 wrap-break-word">
                Both devices changed the same lines, so they could not be
                merged:{" "}
                {entry.discarded_by === "this device"
                  ? "the file holds the other device's version, this device's is"
                  : "the file holds one version, the other is"}{" "}
                beside it in{" "}
                <span className="break-all font-medium">{entry.copy}</span>.
                Compare them and keep one, or move over what you need by hand.
                <button
                  className="mt-2 block rounded-md border border-warn/60 px-3 py-1 text-xs font-semibold text-warn hover:bg-warn/10"
                  onClick={() =>
                    setReviewing({ ...entry, copy: entry.copy as string })
                  }
                >
                  Compare and resolve
                </button>
              </p>
            ) : (
              <>
                <div className="mt-2 wrap-break-word">
                  <span className="text-content-muted">Kept: </span>
                  {entry.kept}
                  {entry.kept_by && ` (${entry.kept_by})`}
                </div>
                <div className="wrap-break-word text-content-muted">
                  <span>{entry.copy ? "Set aside: " : "Replaced: "}</span>
                  {entry.discarded}
                  {entry.discarded_by && ` (${entry.discarded_by})`}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {reviewing && (
        <ConflictReview
          entry={reviewing}
          onClose={close}
          onResolved={onChanged}
        />
      )}
    </>
  );
}
