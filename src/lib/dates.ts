// Masked date inputs: typing digits fills the segments, hyphens appear
// on their own.

/** "0830" -> "08-30" while typing, so the hyphen never has to be typed. */
export function formatMmDd(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2
    ? `${digits.slice(0, 2)}-${digits.slice(2)}`
    : digits;
}

/** "20260830" -> "2026-08-30". */
export function formatYmd(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}
