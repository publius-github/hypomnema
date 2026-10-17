/**
 * The desktop's keyboard shortcuts, as the About dialog lists them. The
 * handlers live where they act (App.tsx for the global ones, the task
 * card, the editor, the Journal); README's Keyboard section repeats this
 * list - change both together.
 */
export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Ctrl+K", action: "Search tasks, notes and the journal" },
  { keys: "Ctrl+1 … 9", action: "Open a section, in the left bar's order" },
  { keys: "Ctrl+= / Ctrl+−", action: "Larger / smaller text (Base font size)" },
  { keys: "Ctrl+0", action: "Default text size" },
  { keys: "Esc", action: "Close a dialog" },
  { keys: "Enter", action: "On a task card: open the task" },
  {
    keys: "Space, arrows, Space",
    action: "On a task card: pick it up, carry it to a day or list, drop it (Esc puts it back)",
  },
  { keys: "Alt+← / Alt+→", action: "Journal: previous / next day" },
  { keys: "Ctrl+F", action: "Editor: find and replace" },
  { keys: "Alt+Z", action: "Editor: word wrap" },
  { keys: "Ctrl+click", action: "Editor: follow a [[link]] or a web address" },
  {
    keys: "Esc, then Tab",
    action: "Editor: leave it with Tab (Tab indents otherwise; Ctrl+M switches this for good)",
  },
];
