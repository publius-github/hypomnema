import type { KeyboardEvent, SyntheticEvent } from "react";

/**
 * Props that make a stretch of text that opens something on click
 * reachable from the keyboard too: a tab stop, announced as a button,
 * activated by Enter or Space. For places where a real <button> would
 * change the layout (inline text, a cell of a flex row). Keys pressed on
 * a control inside are left to that control.
 *
 * A row that holds buttons of its own (delete, move) must not become a
 * button itself: keep the row's click for the mouse (role
 * "presentation") and put these props, with `click: false`, on the
 * row's main text.
 */
export function pressable(
  onActivate: (e: SyntheticEvent) => void,
  { click = true }: { click?: boolean } = {},
) {
  return {
    role: "button",
    tabIndex: 0,
    onClick: click ? onActivate : undefined,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate(e);
      }
    },
  } as const;
}
