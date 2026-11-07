/**
 * Where a search hit sits in a note: the query and the 1-based line the
 * search found it on. Opening a note with one scrolls the editor to that
 * match and selects it. A new object is a new jump, even to the same
 * place.
 */
export interface Reveal {
  query: string;
  line: number;
}

/**
 * The span of the first case-insensitive match of `query` at or after
 * the start of `line` (the line a search reported; the text may have
 * moved since, so a miss there falls back to the first match in the
 * whole text), or null when the query is not in the text at all.
 */
export function revealRange(
  text: string,
  query: string,
  line: number,
): { from: number; to: number } | null {
  const needle = query.trim();
  if (!needle) return null;
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  let start = 0;
  for (let i = 1; i < line; i++) {
    const next = text.indexOf("\n", start);
    if (next < 0) {
      start = 0;
      break;
    }
    start = next + 1;
  }
  pattern.lastIndex = start;
  let match = pattern.exec(text);
  if (!match && start > 0) {
    pattern.lastIndex = 0;
    match = pattern.exec(text);
  }
  return match ? { from: match.index, to: match.index + match[0].length } : null;
}
