import { useEffect, useState } from "react";

/**
 * A switch, where the desktop uses a checkbox. On a touch screen the
 * switch is the convention for "this setting is on": it reads its state
 * at a glance and offers a target the width of a fingertip.
 */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
        checked ? "bg-accent" : "bg-line"
      }`}
    >
      <span
        aria-hidden
        className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

/**
 * A number setting that commits on blur, not per keystroke. Committing
 * while typing means clearing the field to type "20" writes the fallback
 * into the config mid-edit; here the draft is local until the field is
 * left, then clamped to [min, max] or reverted if it never became a
 * number.
 */
export function NumberField({
  value,
  min,
  max,
  onCommit,
  className,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (next: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.round(parsed)));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={`rounded-lg border border-line bg-surface-alt px-3 py-2 ${
        className ?? "w-20"
      }`}
    />
  );
}
