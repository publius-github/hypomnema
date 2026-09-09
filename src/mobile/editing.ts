import { createContext, useContext } from "react";

/**
 * Which task the phone has open for editing, shared between the rows
 * that offer "Edit" and the shell that renders the editor over them.
 *
 * A context rather than props: `TaskRow` appears on the day view, inside
 * a list, and under a parent task's subtasks, and threading a callback
 * through all three would make every intermediate component carry state
 * it has no other use for.
 */
export const EditingTaskContext = createContext<{
  editing: number | null;
  setEditing: (id: number | null) => void;
}>({ editing: null, setEditing: () => {} });

export function useEditTask() {
  return useContext(EditingTaskContext);
}
