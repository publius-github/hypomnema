// [[Note name]] wiki links: a plain-text convention shared by task
// descriptions, journal entries and notes. A link targets a note file
// by its display name (file name without .md), case-insensitive.

const WIKI_RE = /\[\[([^[\]]+)\]\]/g;

/**
 * Replaces every [[name]] with a markdown link to a #wiki: anchor, so
 * ReactMarkdown renders it as a clickable link the caller can intercept.
 */
export function wikiToMarkdownLinks(md: string): string {
  return md.replace(
    WIKI_RE,
    (_, name: string) =>
      `[${name.trim()}](#wiki:${encodeURIComponent(name.trim())})`,
  );
}

/** The note name of a #wiki: href produced above, or null. */
export function wikiTargetFromHref(href: string): string | null {
  if (!href.startsWith("#wiki:")) return null;
  try {
    return decodeURIComponent(href.slice("#wiki:".length));
  } catch {
    return null;
  }
}

/** The [[target]] whose span covers `pos` in `text`, or null. */
export function wikiTargetAt(text: string, pos: number): string | null {
  WIKI_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKI_RE.exec(text)) !== null) {
    if (pos >= match.index && pos <= match.index + match[0].length) {
      return match[1].trim();
    }
    if (match.index > pos) break;
  }
  return null;
}
