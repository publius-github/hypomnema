import { useEffect, useRef, useState } from "react";

// In-app replacements for window.confirm/prompt: native dialogs clash
// with the app styling and window.prompt is unreliable in WebView2.

function Backdrop({
  label,
  onCancel,
  children,
}: {
  label: string;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    // the backdrop is a mouse convenience; Escape is the keyboard's way out
    <div
      role="presentation"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="flex w-[400px] flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-xl"
      >
        {children}
      </div>
    </div>
  );
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);

  // Left/Right (and Up/Down) walk the two buttons, so the dialog can be
  // answered without reaching for the mouse or knowing that Tab is the
  // only way through. Focus stays visible on whichever button is armed;
  // Enter/Space then activate it the way a button always does.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!keys.includes(e.key)) return;
    const buttons = Array.from(
      row.current?.querySelectorAll("button") ?? [],
    ) as HTMLButtonElement[];
    if (buttons.length === 0) return;
    e.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const delta = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const next = current < 0 ? 0 : (current + delta + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  return (
    <Backdrop label={title} onCancel={onCancel}>
      <span className="text-sm font-semibold">{title}</span>
      {message && <p className="text-sm text-content-muted">{message}</p>}
      <div
        ref={row}
        // the arrow keys walk the two buttons, as in a toolbar
        role="toolbar"
        className="flex justify-end gap-2 pt-1"
        onKeyDown={onKeyDown}
      >
        {/* focus lands on Cancel: Enter must never confirm a destructive
            action by accident */}
        <button
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-content-muted focus:border-accent focus:outline-hidden focus-visible:border-accent"
          onClick={onCancel}
          autoFocus
        >
          Cancel
        </button>
        <button
          className="btn-danger px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-danger/50"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Backdrop>
  );
}

export function PromptModal({
  title,
  initial = "",
  placeholder,
  submitLabel = "OK",
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: string;
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    if (value.trim()) onSubmit(value.trim());
  };

  return (
    <Backdrop label={title} onCancel={onCancel}>
      <span className="text-sm font-semibold">{title}</span>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={inputRef}
          className="input w-full"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </form>
      <div className="flex justify-end gap-2 pt-1">
        <button
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-content-muted"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="btn-primary px-3"
          onClick={submit}
        >
          {submitLabel}
        </button>
      </div>
    </Backdrop>
  );
}
