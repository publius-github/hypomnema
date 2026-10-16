import type { StateCreator } from "zustand";
import { errorMessage, invoke } from "../lib/ipc";
import type { DeletedTasks } from "../types";
import type { AppState } from "../store";

export type UndoEntry =
  | { kind: "task"; label: string; deleted: DeletedTasks }
  | { kind: "list"; label: string; listId: number };

/** The Undo toast: one destructive action offered back at a time. */
export interface UndoSlice {
  /// last destructive action, offered back through the Undo toast until
  /// the hold (undo_toast_seconds) expires or another delete replaces it
  undoEntry: UndoEntry | null;
  offerUndo: (entry: UndoEntry) => void;
  undoLast: () => Promise<void>;
  dismissUndo: () => void;
}

/** One pending undo at a time: a new delete replaces the previous offer
 *  and restarts the dismiss timer. */
let undoTimer: ReturnType<typeof setTimeout> | null = null;

export const createUndoSlice: StateCreator<AppState, [], [], UndoSlice> = (
  set,
  get,
) => ({
  undoEntry: null,

  offerUndo: (entry) => {
    const seconds = get().config?.undo_toast_seconds ?? 0;
    if (seconds <= 0) return;
    if (undoTimer) clearTimeout(undoTimer);
    set({ undoEntry: entry });
    undoTimer = setTimeout(() => {
      undoTimer = null;
      set({ undoEntry: null });
    }, seconds * 1000);
  },

  dismissUndo: () => {
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = null;
    set({ undoEntry: null });
  },

  undoLast: async () => {
    const entry = get().undoEntry;
    if (!entry) return;
    get().dismissUndo();
    try {
      if (entry.kind === "task") {
        const restored = await invoke("task_restore", {
          deleted: entry.deleted,
        });
        if (restored.length > 0) {
          set((s) => ({ tasks: [...s.tasks, ...restored] }));
        } else {
          // the engine regenerated the instance meanwhile; the card is
          // already back, just make sure we show the current state
          await get().refresh();
        }
      } else {
        await invoke("list_unarchive", { id: entry.listId });
        await get().refresh();
      }
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },
});
