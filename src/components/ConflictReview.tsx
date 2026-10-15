import { useEffect, useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import type { ConflictDiff, ConflictEntry } from "../types";

/**
 * A file set against the conflicted copy a sync (or an editor's save)
 * left beside it, line by line, with the two ways out: keep the file as
 * it is, or put the copy's text in it. Either way the copy goes to the
 * vault's .trash/ (recoverable for 30 days), which takes the entry off
 * "to review". Merging by hand is still the file's own business - this
 * is for the common case where one side is simply the one to keep.
 */
export default function ConflictReview({
  entry,
  onClose,
  onResolved,
}: {
  entry: ConflictEntry & { copy: string };
  onClose: () => void;
  onResolved: () => void;
}) {
  const [diff, setDiff] = useState<ConflictDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const setError = useAppStore((s) => s.setError);

  useEffect(() => {
    void invoke("sync_conflict_diff", { path: entry.path, copy: entry.copy })
      .then(setDiff)
      .catch((e) => {
        setError(errorMessage(e));
        onClose();
      });
  }, [entry.path, entry.copy, setError, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const resolve = (keepCopy: boolean) => {
    setBusy(true);
    void invoke("sync_conflict_resolve", {
      path: entry.path,
      copy: entry.copy,
      keepCopy,
    })
      .then(() => {
        onResolved();
        onClose();
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  // whose version is where, in the log's words
  const copyIsMine = entry.discarded_by === "this device";
  const fileLabel = copyIsMine ? "Other device (in the file)" : "In the file";
  const copyLabel = copyIsMine ? "This device (in the copy)" : "In the copy";
  const changed = diff?.lines.filter((l) => l.kind !== "same").length ?? 0;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-3 sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-full w-full max-w-3xl flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-xl"
      >
        <div className="flex flex-col gap-0.5">
          <span className="break-all text-sm font-semibold">{entry.path}</span>
          <span className="break-all text-xs text-content-muted">
            against {entry.copy}
          </span>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="rounded bg-danger/10 px-1.5 text-danger">
            − {fileLabel}
          </span>
          <span className="rounded bg-accent/10 px-1.5 text-accent">
            + {copyLabel}
          </span>
          {diff && (
            <span className="text-content-muted">
              {changed === 0 ? "no differences" : `${changed} lines differ`}
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line font-mono text-xs leading-5">
          {!diff ? (
            <div className="p-3 text-content-muted">Loading...</div>
          ) : (
            diff.lines.map((line, i) => (
              <div
                key={i}
                className={`whitespace-pre-wrap break-words px-2 ${
                  line.kind === "file"
                    ? "bg-danger/10 text-danger"
                    : line.kind === "copy"
                      ? "bg-accent/10 text-accent"
                      : "text-content"
                }`}
              >
                <span className="select-none pr-2 opacity-60">
                  {line.kind === "file" ? "−" : line.kind === "copy" ? "+" : " "}
                </span>
                {line.text || " "}
              </div>
            ))
          )}
        </div>
        <p className="text-xs text-content-muted">
          The copy you do not keep moves to .trash/ and can be recovered from
          there for 30 days. To combine both, edit the file by hand first and
          then keep it.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-content-muted"
            onClick={onClose}
            autoFocus
          >
            Cancel
          </button>
          <button
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-content-muted disabled:opacity-50"
            disabled={busy || !diff}
            onClick={() => resolve(false)}
          >
            Keep the file
          </button>
          <button
            className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={busy || !diff}
            onClick={() => resolve(true)}
          >
            Keep the copy
          </button>
        </div>
      </div>
    </div>
  );
}
