// External links inside plain-text markdown: a web or mail URL written
// bare or as the target of a [label](url) link. The editor opens them
// in the system browser on Ctrl/Cmd+click, the same gesture [[wiki
// links]] already use.

const MD_LINK_RE = /\[[^\][]*\]\(\s*([^()\s]+)\s*\)/g;
const BARE_URL_RE = /(?:https?:\/\/|mailto:)[^\s<>()[\]"'`]+/gi;
const EXTERNAL_RE = /^(?:https?:\/\/|mailto:)/i;

/** Sentence punctuation that follows a URL is not part of it. */
function trimTail(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

export function isExternalUrl(url: string): boolean {
  return EXTERNAL_RE.test(url);
}

/**
 * The external URL whose span covers `pos` in `text`, or null. A
 * markdown link counts anywhere in `[label](url)`; a relative or wiki
 * target is not an external link and returns null.
 */
export function urlAt(text: string, pos: number): string | null {
  for (const match of text.matchAll(MD_LINK_RE)) {
    const start = match.index ?? 0;
    if (pos >= start && pos <= start + match[0].length) {
      const target = match[1];
      return isExternalUrl(target) ? trimTail(target) : null;
    }
  }
  for (const match of text.matchAll(BARE_URL_RE)) {
    const start = match.index ?? 0;
    const url = trimTail(match[0]);
    if (pos >= start && pos <= start + url.length) return url;
  }
  return null;
}
