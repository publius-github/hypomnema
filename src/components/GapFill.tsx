import { useAppStore } from "../store";
import { listGapStripe } from "../lib/tasks";

/**
 * The break between two category blocks (or two sections) in a day or
 * list column: plain space, `stripes` stripes of `listGapStripe` px
 * each (1 = category, 2 = section, 3 = into the closed blocks - see
 * `LIST_GAP_STRIPES`).
 */
export default function GapFill({ stripes }: { stripes: number }) {
  const height = useAppStore((s) => stripes * listGapStripe(s.config));
  return <div aria-hidden style={{ height }} />;
}
