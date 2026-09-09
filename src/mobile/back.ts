import { useEffect, useRef } from "react";

/**
 * Android's hardware back press reaches the WebView as history.back():
 * Tauri's activity walks the page history when it can and minimizes the
 * app when it cannot. The shell is a single page, so without help every
 * press minimized. This keeps one sentinel history entry armed while any
 * screen has a step to undo: a press pops the sentinel, the most recently
 * activated handler undoes one UI step, and the sentinel is pushed again
 * for the next press. With nothing registered the consumed sentinel is
 * left alone, so the next press minimizes - what Android users expect at
 * the root.
 */

type Entry = { handler: () => void };

const stack: Entry[] = [];
let armed = false;
let listening = false;

function arm() {
  if (armed) return;
  window.history.pushState({ backStep: true }, "");
  armed = true;
}

function onPop() {
  armed = false;
  const top = stack[stack.length - 1];
  if (top) {
    top.handler();
    arm();
  }
}

function listen() {
  if (listening) return;
  window.addEventListener("popstate", onPop);
  listening = true;
}

/**
 * While `active`, one hardware back press calls `onBack` instead of
 * minimizing the app. Handlers stack in activation order - the latest
 * activated wins - and a handler that stays active across presses (a
 * folder trail) keeps absorbing them one step at a time.
 */
export function useBackStep(active: boolean, onBack: () => void) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    listen();
    const entry: Entry = { handler: () => ref.current() };
    stack.push(entry);
    arm();
    return () => {
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [active]);
}
