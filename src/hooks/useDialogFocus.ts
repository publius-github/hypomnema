import { useEffect, useRef, useState } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** The dialog's own tab stops, in document order, visible ones only. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0,
  );
}

/**
 * Makes a `role="dialog"` element modal for the keyboard, as its
 * `aria-modal` promises: focus moves in when it opens (unless the
 * dialog already put it on a field of its own), Tab and Shift+Tab cycle
 * through the dialog's controls instead of walking the page behind it,
 * and closing gives focus back to whatever opened it. Put the returned
 * ref on the element that carries `role="dialog"`.
 *
 * A key a control inside has already handled (`defaultPrevented` - the
 * editor's Tab indent, an inner dialog's own wrap) is left alone, so
 * dialogs nest.
 */
export function useDialogFocus<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  // read while rendering, before the commit: an autoFocus inside the
  // dialog has already moved focus by the time an effect runs
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body
      ? document.activeElement
      : null,
  );

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // the panel itself takes focus when no field claimed it: a screen
    // reader announces the dialog by name, and the next Tab lands on
    // its first control
    if (!dialog.contains(document.activeElement)) {
      if (!dialog.hasAttribute("tabindex")) dialog.tabIndex = -1;
      dialog.focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented) return;
      const stops = focusables(dialog);
      if (stops.length === 0) {
        e.preventDefault();
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      const outside = !dialog.contains(active);
      if (e.shiftKey && (active === first || active === dialog || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);

    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      // back to the opener - unless something else has deliberately
      // taken focus since (the next dialog, a field the action opened)
      const now = document.activeElement;
      const lost = !now || now === document.body || dialog.contains(now);
      if (lost && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);

  return ref;
}
