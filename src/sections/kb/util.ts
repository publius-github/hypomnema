import type { KbNode } from "../../types";

// Vault config files editable right in the KB editor (validated on save)
export const CONFIG_FILES = [
  "recurring.yml",
  "scheduled.yml",
  "birthdays.yml",
  "weekly-focus.yml",
  "day-reminders.yml",
  "day-schedule.yml",
  "templates/journal.md",
];

export interface OpenDoc {
  kind: "note" | "config";
  path: string;
  content: string;
}

export function flattenFiles(nodes: KbNode[]): KbNode[] {
  return nodes.flatMap((n) => (n.is_dir ? flattenFiles(n.children) : [n]));
}

export function flattenAll(nodes: KbNode[]): KbNode[] {
  return nodes.flatMap((n) => [n, ...(n.is_dir ? flattenAll(n.children) : [])]);
}

export const parentDirOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

export const basenameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Where the text under the Created / Last edited header the app keeps on
 * notes starts (0 without one): a note opens with the cursor there, so
 * typing straight away does not land inside the header lines.
 */
export function noteBodyOffset(content: string): number {
  const match = /^Created: [^\n]*\nLast edited: [^\n]*\n(\r?\n)?/.exec(content);
  return match ? match[0].length : 0;
}

/**
 * A save came back with the note's header stamped (`sent` -> `written`)
 * while the editor may have moved on since the text was sent. The stamp
 * only touches the start of the note, so the head that differs between
 * the two is carried over onto the current text. null when the current
 * text no longer starts with the sent head - the header itself was
 * edited meanwhile, and the next save stamps it again anyway.
 */
export function rebaseStamp(
  sent: string,
  written: string,
  current: string,
): string | null {
  const max = Math.min(sent.length, written.length);
  let tail = 0;
  while (
    tail < max &&
    sent[sent.length - 1 - tail] === written[written.length - 1 - tail]
  ) {
    tail++;
  }
  const sentHead = sent.slice(0, sent.length - tail);
  if (!current.startsWith(sentHead)) return null;
  return written.slice(0, written.length - tail) + current.slice(sentHead.length);
}

/**
 * Where an editor stands after a save of `sent` came back as `written`
 * (the text now on disk: stamped, or merged with a change that landed
 * under the editor) while it shows `current`. `content` is what to show
 * now; `base` is the text the next save is measured against - what the
 * shown text derives from, so the backend's three-way merge keeps both
 * the typing and whatever came in from elsewhere.
 */
export function settleSave(
  sent: string,
  written: string,
  current: string,
): { content: string; base: string } {
  if (written === sent) return { content: current, base: sent };
  if (current === sent) return { content: written, base: written };
  const rebased = rebaseStamp(sent, written, current);
  if (rebased !== null) return { content: rebased, base: written };
  // typed into the part that changed: keep the typing; the next save
  // merges `written`'s changes back in against `sent`
  return { content: current, base: sent };
}
