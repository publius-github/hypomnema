import { useState } from "react";
import { useAppStore } from "../store";
import { metricKey, metricsOf, taskDay } from "../store/tasks";
import { formatValue, metricName, parseNumber } from "../sections/tracker/Metrics";
import type { MetricDef, Task } from "../types";

/**
 * The Tracker values of a metric task's day, editable in its dialog -
 * the place to add a value after a check-off without one, or to correct
 * it. A field saves on blur or Enter; emptied, it deletes the value.
 * Renders nothing for a task whose rule asks for no metrics.
 */
export default function MetricValues({ task, large = false }: { task: Task; large?: boolean }) {
  const links = useAppStore((s) => s.metricLinks);
  const defs = useAppStore((s) => s.metricDefs);
  const metrics = metricsOf({ metricLinks: links, metricDefs: defs }, task);
  if (metrics.length === 0) return null;
  const day = taskDay(task);
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className={large ? "pb-2 text-xs uppercase tracking-wide text-content-muted" : "pb-1 text-xs text-content-muted"}>
        Values for {day}
      </legend>
      {metrics.map((d) => (
        <ValueField key={`${d.id}|${day}`} def={d} day={day} large={large} />
      ))}
    </fieldset>
  );
}

function ValueField({ def, day, large }: { def: MetricDef; day: string; large: boolean }) {
  const stored = useAppStore((s) => s.metricValues[metricKey(def.id, day)]);
  const setMetricValue = useAppStore((s) => s.setMetricValue);
  const shown = stored === undefined ? "" : formatValue(stored, def);
  const [text, setText] = useState(shown);
  const invalid = text.trim() !== "" && parseNumber(text) === null;
  const commit = () => {
    if (invalid) return;
    const value = parseNumber(text);
    if (value === null && stored === undefined) return;
    if (value !== null && stored !== undefined && Math.abs(value - stored) < 1e-12) return;
    void setMetricValue(def.id, day, value);
  };
  return (
    <label className={`flex items-center justify-between gap-3 ${large ? "text-base" : "text-sm"}`}>
      <span>{metricName(def)}</span>
      <span className="flex items-center gap-1.5">
        <input
          className={`input text-right ${large ? "w-32" : "w-28"}`}
          inputMode="decimal"
          aria-invalid={invalid}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
        <span className="w-8 text-xs text-content-muted">{def.unit ?? ""}</span>
      </span>
    </label>
  );
}
