import { useEffect, useRef, useState } from "react";

// In-app replacements for window.confirm/prompt: native dialogs clash
// with the app styling and window.prompt is unreliable in WebView2.

function Backdrop({
  onCancel,
  children,
}: {
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
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
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
  return (
    <Backdrop onCancel={onCancel}>
      <span className="text-sm font-semibold">{title}</span>
      {message && <p className="text-sm text-content-muted">{message}</p>}
      <div className="flex justify-end gap-2 pt-1">
        {/* focus lands on Cancel: Enter must never confirm a destructive
            action by accident */}
        <button
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-content-muted"
          onClick={onCancel}
          autoFocus
        >
          Cancel
        </button>
        <button className="btn-danger px-3 py-1.5 text-sm" onClick={onConfirm}>
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
    <Backdrop onCancel={onCancel}>
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
