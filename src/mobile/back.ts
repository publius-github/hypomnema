import { useEffect, useRef } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import type { PluginListener } from "@tauri-apps/api/core";
import { warn } from "../lib/log";

/**
 * Android's hardware back press goes to Tauri's app plugin first. With a
 * `back-button` listener registered the plugin hands the press to the
 * page and does nothing else; with none it falls back to the WebView's
 * history and then closes the app. So the listener is registered exactly
 * while some screen has a step to undo: a press runs the most recently
 * activated handler, and once every step is undone - the shell's last
 * one returns to Day - the listener goes away and the next press closes
 * the app, which is what Android users expect at the root.
 *
 * (An earlier version pushed a sentinel history entry and caught its
 * popstate; a pushState issued mid-traversal could be dropped natively,
 * and a lost sentinel closed the app with steps still on the stack.)
 */

type Entry = { handler: () => void };

const stack: Entry[] = [];
let registered: PluginListener | null = null;
// registrations are async: chained so a quick open/close never leaves a
// stale listener behind or registers two
let chain: Promise<void> = Promise.resolve();

const inTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function onPress() {
  stack[stack.length - 1]?.handler();
}

function sync() {
  if (!inTauri()) return;
  chain = chain
    .then(async () => {
      const want = stack.length > 0;
      if (want && !registered) {
        registered = await onBackButtonPress(onPress);
      } else if (!want && registered) {
        const listener = registered;
        registered = null;
        await listener.unregister();
      }
    })
    .catch((e) => warn("back button listener", e));
}

/**
 * While `active`, one hardware back press calls `onBack` instead of
 * closing the app. Handlers stack in activation order - the latest
 * activated wins - and a handler that stays active across presses (a
 * folder trail) keeps absorbing them one step at a time.
 */
export function useBackStep(active: boolean, onBack: () => void) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    const entry: Entry = { handler: () => ref.current() };
    stack.push(entry);
    sync();
    return () => {
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      sync();
    };
  }, [active]);
}
