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
      className="shrink-0"
    >
      <SwitchKnob checked={checked} />
    </button>
  );
}

/** The switch's look alone, for a row that is itself the switch. */
export function SwitchKnob({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative block h-7 w-12 shrink-0 rounded-full transition-colors ${
        checked ? "bg-accent" : "bg-line"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </span>
  );
}
