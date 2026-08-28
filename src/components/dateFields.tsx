// One masked date input for every date-typing spot (Scheduled,
// Birthdays): digits only, hyphens appear on their own the moment a
// segment is complete, same font and colors everywhere.

/**
 * Formats digits into groups joined by hyphens. With `eager` a trailing
 * hyphen is appended as soon as a group completes ("2026" -> "2026-"),
 * so the next digit always lands in the next segment; while deleting,
 * the trailing hyphen is dropped so backspace never fights the mask.
 */
export function maskDigits(
  digits: string,
  groups: number[],
  eager: boolean,
): string {
  const parts: string[] = [];
  let rest = digits;
  for (const size of groups) {
    if (rest.length === 0) break;
    parts.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  let out = parts.join("-");
  const lastComplete =
    parts.length > 0 && parts[parts.length - 1].length === groups[parts.length - 1];
  if (eager && lastComplete && parts.length < groups.length) out += "-";
  return out;
}

function MaskedDateInput({
  groups,
  value,
  onChange,
  placeholder,
  className = "",
  required = false,
}: {
  groups: number[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  required?: boolean;
}) {
  const max = groups.reduce((a, b) => a + b, 0);
  const handle = (raw: string) => {
    let digits = raw.replace(/\D/g, "").slice(0, max);
    const prevDigits = value.replace(/\D/g, "");
    const shrinking = raw.length < value.length;
    // backspace over a hyphen: the user means to delete the digit
    // before it, otherwise the mask would re-insert the hyphen forever
    if (shrinking && digits === prevDigits && digits.length > 0) {
      digits = digits.slice(0, -1);
    }
    onChange(maskDigits(digits, groups, !shrinking));
  };
  return (
    <input
      className={`input font-mono ${className}`}
      inputMode="numeric"
      placeholder={placeholder}
      required={required}
      value={value}
      onChange={(e) => handle(e.target.value)}
    />
  );
}

/** YYYY-MM-DD */
export function DateInput(props: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
}) {
  return <MaskedDateInput groups={[4, 2, 2]} placeholder="YYYY-MM-DD" {...props} />;
}

/** MM-DD */
export function MonthDayInput(props: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  required?: boolean;
}) {
  return <MaskedDateInput groups={[2, 2]} placeholder="MM-DD" {...props} />;
}
