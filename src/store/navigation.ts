import type { StateCreator } from "zustand";
import { errorMessage, invoke } from "../lib/ipc";
import type { KbNode, Section } from "../types";
import type { AppState } from "../store";

/** Where the window is: the open section, page offsets that survive a
 *  section switch, and the jumps into Notes and Journal. */
export interface NavigationSlice {
  section: Section;
  setSection: (section: Section) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  /// grid window shift in days (negative = the past); the snapshot
  /// window follows it so past days are browsable in place
  gridOffset: number;
  setGridOffset: (offset: number) => void;
  /// first visible list in the paged list zone; lives here so the page
  /// survives section switches
  listOffset: number;
  setListOffset: (offset: number) => void;
  /// folds or opens a section by its key in every column, remembered
  /// in `config.folded_sections`
  setSectionFold: (key: string, folded: boolean) => void;
  /// set to jump to Notes with a config file opened (error banner,
  /// focus line, Settings links)
  kbOpenConfig: string | null;
  openConfigFile: (file: string) => void;
  /// Notes tree/editor state survives section switches for the whole
  /// app session (folders start collapsed only on a fresh launch)
  kbExpanded: string[];
  setKbExpanded: (paths: string[]) => void;
  kbCurrent: { kind: "note" | "config"; path: string } | null;
  setKbCurrent: (doc: { kind: "note" | "config"; path: string } | null) => void;
  /// set to jump to Notes with a note opened (search palette)
  kbOpenNote: string | null;
  openKbNote: (path: string) => void;
  /// resolves a [[wiki link]] name to a note file and opens it
  openKbNoteByName: (name: string) => Promise<void>;
  /// set to jump to Journal with a date opened (search palette)
  journalOpenDate: string | null;
  openJournalDate: (date: string) => void;
}

export const createNavigationSlice: StateCreator<
  AppState,
  [],
  [],
  NavigationSlice
> = (set, get) => ({
  section: "dashboard",
  setSection: (section) => set({ section }),
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  gridOffset: 0,
  setGridOffset: (gridOffset) => {
    set({ gridOffset });
    void get().refresh();
  },
  listOffset: 0,
  setListOffset: (listOffset) => set({ listOffset }),
  setSectionFold: (key, folded) => {
    const current = get().config?.folded_sections ?? [];
    const rest = current.filter((k) => k !== key);
    void get().updateConfig({
      folded_sections: folded ? [...rest, key] : rest,
    });
  },
  kbOpenConfig: null,
  openConfigFile: (file) => set({ section: "kb", kbOpenConfig: file }),
  kbExpanded: [],
  setKbExpanded: (paths) => set({ kbExpanded: paths }),
  kbCurrent: null,
  setKbCurrent: (doc) => set({ kbCurrent: doc }),
  kbOpenNote: null,
  openKbNote: (path) =>
    set((s) => {
      // expand every parent folder so the tree shows the opened note
      const parts = path.split("/");
      const parents = parts
        .slice(0, -1)
        .map((_, i) => parts.slice(0, i + 1).join("/"));
      return {
        section: "kb",
        kbOpenNote: path,
        kbExpanded: [...new Set([...s.kbExpanded, ...parents])],
      };
    }),
  openKbNoteByName: async (name) => {
    const target = name.trim().toLowerCase();
    if (!target) return;
    try {
      const tree = await invoke("kb_tree");
      const find = (nodes: KbNode[]): string | null => {
        for (const node of nodes) {
          if (!node.is_dir) {
            const base = node.name.toLowerCase().replace(/\.md$/, "");
            if (base === target || node.name.toLowerCase() === target) {
              return node.path;
            }
          }
          const hit = find(node.children);
          if (hit) return hit;
        }
        return null;
      };
      const path = find(tree);
      if (path) {
        get().openKbNote(path);
      } else {
        set({ error: `Note "${name.trim()}" not found in the notes folder` });
      }
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },
  journalOpenDate: null,
  openJournalDate: (date) => set({ section: "journal", journalOpenDate: date }),
});
