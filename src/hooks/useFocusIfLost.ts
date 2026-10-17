import { useEffect, type RefObject } from "react";

/**
 * Moves focus to `ref` when `trigger` turns truthy and focus had nowhere
 * left to be: the control that held it was removed with what it acted
 * on (a task's Delete button goes with the task, so the keyboard would
 * restart from the top of the page). Focus that is still somewhere -
 * a field, another card - stays put.
 */
export function useFocusIfLost(ref: RefObject<HTMLElement | null>, trigger: unknown) {
  useEffect(() => {
    if (!trigger) return;
    const now = document.activeElement;
    if (!now || now === document.body) ref.current?.focus({ preventScroll: true });
  }, [ref, trigger]);
}
