import { useState } from "react";
import { useAppStore } from "../store";
import { metricKey, metricsOf, taskDay } from "../store/tasks";
import { splitCategory } from "../lib/tasks";
import { formatValue, metricName, parseNumber } from "../sections/tracker/Metrics";
import { Backdrop } from "./dialogs";

/**
 * Asks for the Tracker values a recurring task's rule names (`metrics:`)
 * when it is checked off - from any view, since every status change goes
 * through the store's updateTask. Done records what was typed (a field
 * left empty records nothing) and checks the task off; Done without a
 * value checks it off alone; Cancel or Escape leaves it as it was. The
 * values land on the task's own day, not on the day it is closed.
 */
export default function MetricPrompt() {
  const prompt = useAppStore((s) => s.metricPrompt);
  if (!prompt) return null;
  // keyed so a second prompt starts with fresh fields
  return <PromptDialog key={prompt.task.id} />;
}

function PromptDialog() {
  const prompt = useAppStore((s) => s.metricPrompt);
  const resolve = useAppStore((s) => s.resolveMetricPrompt);
  const metricLinks = useAppStore((s) => s.metricLinks);
  const metricDefs = useAppStore((s) => s.metricDefs);
  const metricValues = useAppStore((s) => s.metricValues);
  const task = prompt?.task;
  const defs = task ? metricsOf({ metricLinks, metricDefs }, task) : [];
  const day = task ? taskDay(task) : "";
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      defs.map((d) => {
        const stored = metricValues[metricKey(d.id, day)];
        return [d.id, stored === undefined ? "" : formatValue(stored, d)];
      }),
    ),
  );
  if (!task) return null;
  const parsed = defs.map((d) => [d.id, texts[d.id] ?? ""] as const);
  const invalid = parsed.some(([, t]) => t.trim() !== "" && parseNumber(t) === null);
  const submit = () => {
    if (invalid) return;
    const values: Record<string, number> = {};
    for (const [id, t] of parsed) {
      const n = parseNumber(t);
      if (n !== null) values[id] = n;
    }
    void resolve(values);
  };

  return (
    <Backdrop label="Record values" onCancel={() => void resolve(null)}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{splitCategory(task.title).text}</span>
          <span className="text-xs text-content-muted">Values for {day}</span>
        </div>
        {defs.map((d, i) => (
          <label key={d.id} className="flex items-center justify-between gap-3 text-sm">
            <span>{metricName(d)}</span>
            <span className="flex items-center gap-1.5">
              <input
                className="input w-28 text-right"
                inputMode="decimal"
                // the first field takes the keyboard: type and press Enter
                autoFocus={i === 0}
                aria-invalid={(texts[d.id] ?? "").trim() !== "" && parseNumber(texts[d.id]) === null}
                value={texts[d.id] ?? ""}
                onChange={(e) => setTexts((t) => ({ ...t, [d.id]: e.target.value }))}
              />
              <span className="w-8 text-xs text-content-muted">{d.unit ?? ""}</span>
            </span>
          </label>
        ))}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => void resolve(null)}>
            Cancel
          </button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => void resolve({})}>
            Done without value
          </button>
          <button type="submit" className="btn-primary px-3 py-1.5 text-sm" disabled={invalid}>
            Done
          </button>
        </div>
      </form>
    </Backdrop>
  );
}
