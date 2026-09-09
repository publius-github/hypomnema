import { createContext, useContext } from "react";
import type { MobileTab } from "./MobileApp";

/**
 * Cross-tab navigation for the phone shell: which tab is open, and the
 * global search overlay. A context for the same reason the task editor
 * uses one - the triggers live several screens deep (a header button, a
 * search hit, a Review "Weekly note" jump) and threading callbacks
 * through every intermediate screen would make each one carry state it
 * has no other use for.
 */
export const MobileNavContext = createContext<{
  setTab: (tab: MobileTab) => void;
  openSearch: () => void;
}>({ setTab: () => {}, openSearch: () => {} });

export function useMobileNav() {
  return useContext(MobileNavContext);
}
