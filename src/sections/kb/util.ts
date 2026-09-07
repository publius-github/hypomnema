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
