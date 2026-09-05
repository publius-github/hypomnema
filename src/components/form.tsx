import { useEffect, useRef, useState, type ReactNode } from "react";

// Shared settings form primitives (also usable elsewhere): committed
// inputs, toggle rows, and the palette color picker.

// swatch palette for the cadence/category colors; mid-tone hues that
// read on both themes (same family as the manual task colors)
const PALETTE = [
  "#6b7280",
  "#9ca3af",
  "#78716c",
  "#a8a29e",
  "#ef4444",
  "#f87171",
  "#f97316",
  "#fb923c",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#4ade80",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#60a5fa",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
];

/**
 * Commits on blur/Enter only. Retention drives a hard, non-undoable
 * prune on the Rust side, and the config watcher applies a saved value
 * within half a second - committing per keystroke would prune against
 * the "3" of a half-typed "30".
 */
export function NumberInput({
  value,
  min,
  onCommit,
}: {
  value: number;
  min: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const n = Math.max(min, Number(draft) || 0);
    if (n !== value) onCommit(n);
  };

  return (
    <input
      className="input"
      type="number"
      min={min}
      value={editing ? draft : String(value)}
      onFocus={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * Color swatch button opening a grid of predefined palette colors, with
 * a custom-color row (native picker with sliders) below the grid for
 * when the palette is not enough.
 */
export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        className="h-6 w-10 rounded-md border border-line"
        style={{ backgroundColor: value }}
        title={value}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-7 z-20 w-max rounded-md border border-line bg-surface-alt p-2 shadow-lg">
            <div className="grid grid-cols-6 gap-1.5">
              {PALETTE.map((color) => (
                <button
                  key={color}
                  className={`h-6 w-6 rounded border-2 ${
                    value === color
                      ? "border-content"
                      : "border-transparent hover:border-content-muted"
                  }`}
                  style={{ backgroundColor: color }}
                  title={color}
                  onClick={() => {
                    onChange(color);
                    setOpen(false);
                  }}
                />
              ))}
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 border-t border-line pt-2 text-xs text-content-muted hover:text-content">
              <input
                type="color"
                className="h-6 w-8 cursor-pointer rounded border border-line bg-transparent p-0"
                value={value}
                onChange={(e) => onChange(e.target.value)}
              />
              <span>
                Custom {value}
              </span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-content-muted">{hint}</span>
      </span>
    </label>
  );
}

/** Text setting committed on blur/Enter, like NumberInput. */
export function TextInput({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  return (
    <input
      className="input"
      placeholder={placeholder}
      value={editing ? draft : value}
      onFocus={() => {
        setDraft(value);
        setEditing(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const trimmed = draft.trim();
        if (trimmed !== value) onCommit(trimmed);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * One logical line of text that wraps instead of scrolling sideways:
 * the box grows with the content, so editing a long entry never turns
 * into hunting for the caret with the arrow keys. Enter commits (the
 * text has no newlines), Escape is left to the caller.
 */
export function GrowingTextarea({
  value,
  onChange,
  onCommit,
  onCancel,
  placeholder,
  className = "",
  autoFocus = false,
  commitOnBlur = true,
  maxRows = 8,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** Off where committing means creating something (an add field). */
  commitOnBlur?: boolean;
  /** Beyond this the box stops growing and scrolls. */
  maxRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // measured against the real line height, so the cap follows the
    // configured font size instead of a hardcoded pixel budget
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const padding = el.offsetHeight - el.clientHeight;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows + padding)}px`;
  }, [value, maxRows]);

  return (
    <textarea
      ref={ref}
      rows={1}
      className={`resize-none ${className}`}
      placeholder={placeholder}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      onBlur={commitOnBlur ? onCommit : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        }
        if (e.key === "Escape" && onCancel) {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
