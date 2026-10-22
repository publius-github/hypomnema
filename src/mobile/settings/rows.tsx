import { useState, type ReactNode } from "react";
import { useBackStep } from "../back";
import { SwitchKnob } from "../controls";

/**
 * The phone's settings kit, after the Android settings pattern: every
 * setting is one full-width row - its name, at most one line of hint,
 * and on the right either a switch or the current value - and the whole
 * row is the touch target. A value is never edited in the row itself
 * (no select, no number field opening the keyboard mid-list): a tap
 * opens a sheet from the bottom with the choices, where the thumb is.
 */

export function Section({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="pb-2">
      {title && (
        <h3 className="px-4 pb-1 pt-5 text-xs font-medium uppercase tracking-wide text-accent">
          {title}
        </h3>
      )}
      <div className="divide-y divide-line/60">{children}</div>
      {footer && (
        <p className="px-4 pt-2 text-xs text-content-muted">{footer}</p>
      )}
    </section>
  );
}

function RowText({ label, hint }: { label: ReactNode; hint?: ReactNode }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block">{label}</span>
      {hint && (
        <span className="block text-xs text-content-muted">{hint}</span>
      )}
    </span>
  );
}

const ROW =
  "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-50";

export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={ROW}
    >
      <RowText label={label} hint={hint} />
      <SwitchKnob checked={checked} />
    </button>
  );
}

export function ValueRow({
  label,
  hint,
  value,
  onClick,
}: {
  label: string;
  hint?: ReactNode;
  value: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={ROW}>
      <RowText label={label} hint={hint} />
      <span className="max-w-[45%] shrink-0 truncate text-right text-sm text-accent">
        {value}
      </span>
    </button>
  );
}

/** A row that opens a screen or does something, rather than holding a value. */
export function ActionRow({
  label,
  hint,
  onClick,
  danger,
  disabled,
  trailing = "›",
}: {
  label: string;
  hint?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${ROW} ${danger ? "text-danger" : ""}`}
    >
      <RowText label={label} hint={hint} />
      {trailing && (
        <span aria-hidden className="shrink-0 text-content-muted">
          {trailing}
        </span>
      )}
    </button>
  );
}

/**
 * A sheet over the bottom of the screen; the backdrop and the hardware
 * back close it.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useBackStep(true, onClose);
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-30 flex flex-col justify-end bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[80%] overflow-auto rounded-t-2xl border-t border-line bg-surface pt-2"
        // only the bottom edge meets a system bar (the .safe-area floor)
        style={{
          paddingBottom:
            "max(env(safe-area-inset-bottom, 0px), var(--safe-bottom, 0px))",
        }}
      >
        <div
          aria-hidden
          className="mx-auto mb-2 h-1 w-10 rounded-full bg-line"
        />
        <h3 className="px-4 pb-2 font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Radio({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
        selected ? "border-accent" : "border-content-muted"
      }`}
    >
      {selected && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
    </span>
  );
}

function OptionRow({
  label,
  hint,
  selected,
  onClick,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={ROW}
    >
      <Radio selected={selected} />
      <RowText label={label} hint={hint} />
    </button>
  );
}

export type Choice<T> = { value: T; label: string; hint?: string };

/** A value picked from a few options: the row shows the current one. */
export function ChoiceRow<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  value: T;
  options: Choice<T>[];
  onChange: (next: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <ValueRow
        label={label}
        hint={hint}
        value={current?.label ?? value}
        onClick={() => setOpen(true)}
      />
      {open && (
        <Sheet title={label} onClose={() => setOpen(false)}>
          <div role="radiogroup" aria-label={label}>
            {options.map((option) => (
              <OptionRow
                key={option.value}
                label={option.label}
                hint={option.hint}
                selected={option.value === value}
                onClick={() => {
                  setOpen(false);
                  if (option.value !== value) onChange(option.value);
                }}
              />
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

/**
 * A number picked from the usual values, with Custom for the rest - the
 * keyboard only comes up for a value nobody offered.
 */
export function NumberRow({
  label,
  hint,
  value,
  presets,
  min,
  max,
  format = String,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  value: number;
  presets: number[];
  min: number;
  max: number;
  format?: (n: number) => string;
  onChange: (next: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setCustom(null);
  };
  const pick = (next: number) => {
    close();
    if (next !== value) onChange(next);
  };
  const parsed = custom === null ? NaN : Number(custom);
  const valid =
    custom !== null &&
    custom.trim() !== "" &&
    Number.isInteger(parsed) &&
    parsed >= min &&
    parsed <= max;
  return (
    <>
      <ValueRow
        label={label}
        hint={hint}
        value={format(value)}
        onClick={() => setOpen(true)}
      />
      {open && (
        <Sheet title={label} onClose={close}>
          <div role="radiogroup" aria-label={label}>
            {presets.map((preset) => (
              <OptionRow
                key={preset}
                label={format(preset)}
                selected={custom === null && preset === value}
                onClick={() => pick(preset)}
              />
            ))}
            <OptionRow
              label="Custom"
              hint={
                presets.includes(value) ? `${min} to ${max}` : format(value)
              }
              selected={custom !== null || !presets.includes(value)}
              onClick={() => setCustom(String(value))}
            />
          </div>
          {custom !== null && (
            <form
              className="flex items-center gap-2 px-4 pb-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) pick(parsed);
              }}
            >
              <input
                autoFocus
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                value={custom}
                aria-label={label}
                onChange={(e) => setCustom(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface-alt px-3 py-2"
              />
              <button
                type="submit"
                disabled={!valid}
                className="rounded-lg bg-accent-fill px-4 py-2 font-medium text-white disabled:opacity-50"
              >
                Set
              </button>
            </form>
          )}
        </Sheet>
      )}
    </>
  );
}
