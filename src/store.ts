import { create } from "zustand";
import { createNavigationSlice, type NavigationSlice } from "./store/navigation";
import { createTasksSlice, type TasksSlice } from "./store/tasks";
import { createUndoSlice, type UndoSlice } from "./store/undo";
import { createVaultSlice, type VaultSlice } from "./store/vault";

/**
 * The one app store, assembled from slices by concern - the open vault
 * and its settings (`store/vault.ts`), the task snapshot and its
 * mutations (`store/tasks.ts`), the Undo toast (`store/undo.ts`) and
 * where the window is (`store/navigation.ts`); `store/theme.ts` turns a
 * config into the document's look. Every slice sees the whole state, so
 * a task mutation can offer an undo and a setting can rerun the engine
 * without a second store to keep in step.
 */
export type AppState = VaultSlice & TasksSlice & UndoSlice & NavigationSlice;

export const useAppStore = create<AppState>()((...a) => ({
  ...createVaultSlice(...a),
  ...createTasksSlice(...a),
  ...createUndoSlice(...a),
  ...createNavigationSlice(...a),
}));
