import { useAppStore } from "../store";
import { metricKey, metricsOf, taskDay } from "../store/tasks";
import { withUnit } from "../sections/tracker/Metrics";
import type { Task } from "../types";

/**
 * The Tracker values recorded for a metric task's day ("81.2 kg"), for
 * its card; null when its rule asks for none or none is recorded. A
 * string, so the store selector compares by value and a card does not
 * re-render on every unrelated store change.
 */
export function useMetricText(task: Task): string | null {
  return useAppStore((s) => {
    const defs = metricsOf(s, task);
    if (defs.length === 0) return null;
    const day = taskDay(task);
    const parts = defs.flatMap((d) => {
      const value = s.metricValues[metricKey(d.id, day)];
      return value === undefined ? [] : [withUnit(value, d)];
    });
    return parts.length > 0 ? parts.join(" · ") : null;
  });
}
