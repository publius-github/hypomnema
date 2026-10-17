import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "../../hooks/useDialogFocus";

/**
 * New-note dialog with an explicit extension completion: a name typed
 * without an extension shows the ".md" completion the user accepts with
 * Tab (or a click) instead of the extension being appended silently.
 */
export default function CreateNoteModal({
  initialDir,
  onSubmit,
  onCancel,
}: {
  /** Folder the note starts in (the + on a folder row); editable text. */
  initialDir?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const dialogRef = useDialogFocus();
  const [value, setValue] = useState(initialDir ? `${initialDir}/` : "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // caret after the prefilled folder path, ready for the note name
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const trimmed = value.trim();
  const hasExtension = /\.[^./\\]+$/.test(trimmed);
  const suggestion = trimmed && !hasExtension ? `${trimmed}.md` : null;
  const submit = () => {
    if (!trimmed) return;
    onSubmit(suggestion ?? trimmed);
  };

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="New note"
        aria-modal="true"
        className="flex w-[400px] flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-xl"
      >
        <span className="text-sm font-semibold">New note</span>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            className="input w-full"
            placeholder="Path, e.g. ideas/note"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
              if (e.key === "Tab" && suggestion) {
                e.preventDefault();
                setValue(suggestion);
              }
            }}
          />
        </form>
        {suggestion ? (
          <button
            className="self-start rounded-sm bg-accent/15 px-2 py-0.5 text-xs text-accent hover:bg-accent/25"
            title="Tab or click to accept"
            onClick={() => setValue(suggestion)}
          >
            {suggestion}
          </button>
        ) : (
          <span className="text-xs text-content-muted">
            {hasExtension
              ? `Creates ${trimmed}`
              : "Type a name; Tab completes the .md extension"}
          </span>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-content-muted"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button className="btn-primary px-3" onClick={submit}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
