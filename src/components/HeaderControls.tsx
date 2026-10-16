import type { ReactNode } from "react";

/**
 * The view controls at the right end of a page header (Dashboard, Days,
 * Lists): one spacing for every page - the same gap between controls
 * and before + Task - so a control that exists on two pages sits in
 * the same spot on both.
 */
export function HeaderControls({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto flex items-center gap-4 text-xs text-content-muted">
      {children}
    </div>
  );
}

/** A labelled dropdown in `HeaderControls`. */
export function HeaderSelect<T extends string | number>({
  label,
  title,
  value,
  options,
  onChange,
}: {
  label: string;
  title?: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex items-center gap-1.5" title={title}>
      <span>{label}</span>
      <select
        className="input px-1 py-0.5 text-xs"
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(
            (typeof value === "number" ? Number(raw) : raw) as T,
          );
        }}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Count options, `n` shown as `n`. */
export const counts = (ns: readonly number[]) =>
  ns.map((n) => [n, String(n)] as const);

export const GROUP_DISPLAY_OPTIONS = [
  ["folded", "Folded"],
  ["flat", "Flat"],
] as const;

export const GROUP_DISPLAY_TITLE =
  "Folded: one tile per group. Flat: every list its own column, with its group as a chip on the header.";
