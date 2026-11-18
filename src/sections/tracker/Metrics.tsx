import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage, invoke } from "../../lib/ipc";
import { useAppStore } from "../../store";
import { todayISO } from "../../lib/tasks";
import type {
  MetricDef,
  MetricSeries,
  MetricView,
  MetricsOverview,
} from "../../types";

export type MetricUnit = "day" | "week" | "month";

const RANGES: Record<MetricUnit, number[]> = {
  day: [30, 90, 365],
  week: [12, 26, 52],
  month: [12, 24, 60],
};

const UNIT_LABEL: Record<MetricUnit, string> = { day: "Days", week: "Weeks", month: "Months" };
const UNIT_WORD: Record<MetricUnit, string> = { day: "days", week: "weeks", month: "months" };

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The metric's value as it shows: its own decimals, else up to two. */
export function formatValue(value: number, def: MetricDef): string {
  if (def.decimals !== undefined) return value.toFixed(def.decimals);
  return String(Math.round(value * 100) / 100);
}

export function metricName(def: MetricDef): string {
  return def.name ?? def.id;
}

/** "82.4 kg" */
export function withUnit(value: number, def: MetricDef): string {
  return def.unit ? `${formatValue(value, def)} ${def.unit}` : formatValue(value, def);
}

/** "17 Aug 2026" for a day, "Aug 2026" for a month. */
function dateLabel(date: string, unit: MetricUnit, year = true): string {
  const month = MONTHS_SHORT[Number(date.slice(5, 7)) - 1];
  if (unit === "month") return `${month} ${date.slice(0, 4)}`;
  const day = `${Number(date.slice(8, 10))} ${month}`;
  return year ? `${day} ${date.slice(0, 4)}` : day;
}

/** A typed number, comma or point as the decimal mark; null = not one. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "" || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Number(t);
}

const dayNumber = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth || fallback));
    observer.observe(el);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

/**
 * One metric over time on a time axis. The day view draws the measured
 * days as a line, or, for a metric with `line: mean`, as faint dots
 * under a 2px line of their seven-day mean (a daily weight moves a kilo
 * either way; the mean is the trend). The week and month views draw one
 * point per period, the period folded by the metric's rollup, with a gap
 * where nothing was measured. The dashed line is the goal. Hover or tap
 * picks the nearest point; on the day view a click also hands its day
 * to `onPick`.
 */
export function MetricChart({
  series,
  def,
  unit,
  height,
  onPick,
}: {
  series: MetricSeries;
  def: MetricDef;
  unit: MetricUnit;
  height: number;
  onPick?: (date: string, value: number) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(600);
  const [active, setActive] = useState<number | null>(null);
  const points = series.points;
  const measured = points.filter((p) => p.value !== null);
  const isDay = unit === "day";
  const smooth = isDay && def.line === "mean";
  const values = [
    ...measured.map((p) => p.value as number),
    ...(smooth ? points.flatMap((p) => (p.avg === null ? [] : [p.avg])) : []),
    ...(def.goal !== undefined ? [def.goal] : []),
  ];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;

  const padLeft = 44;
  const padRight = 8;
  const padTop = 8;
  const padBottom = 8;
  const plotW = Math.max(width - padLeft - padRight, 10);
  const plotH = height - padTop - padBottom;
  const d0 = dayNumber(series.start);
  const span = Math.max(dayNumber(series.end) - d0, 0);
  const x = (date: string) =>
    span === 0 ? padLeft + plotW / 2 : padLeft + ((dayNumber(date) - d0) / span) * plotW;
  const y = (v: number) => padTop + (1 - (v - lo) / (hi - lo)) * plotH;

  // a line breaks at a period with nothing measured
  const path = (pick: (i: number) => number | null) => {
    let d = "";
    let pen = false;
    points.forEach((p, i) => {
      const v = pick(i);
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(p.date).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const valueLine = smooth ? "" : path((i) => points[i].value);
  const avgLine = smooth ? path((i) => points[i].avg) : "";
  const ticks = [hi - pad, (hi + lo) / 2, lo + pad];

  const shown = active ?? (measured.length > 0 ? points.lastIndexOf(measured[measured.length - 1]) : null);
  const describe = (i: number) => {
    const p = points[i];
    const when = dateLabel(p.date, unit);
    const prefix = unit === "week" ? `Week of ${when}` : when;
    if (p.value === null) return `${prefix}: nothing measured`;
    const avg = smooth && p.avg !== null ? ` · 7-day mean ${withUnit(p.avg, def)}` : "";
    return `${prefix}: ${withUnit(p.value, def)}${avg}`;
  };
  const pick = (clientX: number, el: SVGSVGElement) => {
    const left = el.getBoundingClientRect().left;
    let best: number | null = null;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      if (p.value === null) return;
      const dist = Math.abs(x(p.date) - (clientX - left));
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setActive(best);
    return best as number | null;
  };
  const summary =
    measured.length === 0
      ? "nothing measured in this range"
      : `${measured.length} values from ${withUnit(measured[0].value as number, def)} on ${dateLabel(measured[0].date, unit)} to ${withUnit(measured[measured.length - 1].value as number, def)} on ${dateLabel(measured[measured.length - 1].date, unit)}`;

  return (
    <div ref={ref} className="flex flex-col gap-1">
      <div className="min-h-4 text-xs text-content-muted" aria-hidden>
        {shown !== null ? describe(shown) : "Nothing measured in this range yet"}
      </div>
      <svg
        role="img"
        aria-label={`${metricName(def)}: ${summary}`}
        width={width}
        height={height}
        className="block touch-none select-none"
        onMouseMove={(e) => pick(e.clientX, e.currentTarget)}
        onClick={(e) => {
          const i = pick(e.clientX, e.currentTarget);
          if (isDay && i !== null && onPick) onPick(points[i].date, points[i].value as number);
        }}
        onMouseLeave={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padLeft}
              x2={padLeft + plotW}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--color-line)"
              strokeOpacity={0.5}
            />
            <text
              x={padLeft - 6}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="var(--color-content-muted)"
            >
              {formatValue(t, def)}
            </text>
          </g>
        ))}
        {def.goal !== undefined && (
          <line
            x1={padLeft}
            x2={padLeft + plotW}
            y1={y(def.goal)}
            y2={y(def.goal)}
            stroke="var(--color-content-muted)"
            strokeDasharray="4 3"
          />
        )}
        {smooth &&
          measured.map((p) => (
            <circle
              key={p.date}
              cx={x(p.date)}
              cy={y(p.value as number)}
              r={2.5}
              fill="var(--color-accent)"
              fillOpacity={0.45}
            />
          ))}
        {avgLine && (
          <path d={avgLine} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" />
        )}
        {valueLine && (
          <path d={valueLine} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" />
        )}
        {!smooth &&
          measured.map((p) => (
            <circle
              key={p.date}
              cx={x(p.date)}
              cy={y(p.value as number)}
              r={3.5}
              fill="var(--color-accent)"
              stroke="var(--color-surface-alt)"
              strokeWidth={2}
            />
          ))}
        {shown !== null && points[shown]?.value !== null && (
          <g pointerEvents="none">
            <line
              x1={x(points[shown].date)}
              x2={x(points[shown].date)}
              y1={padTop}
              y2={padTop + plotH}
              stroke="var(--color-content-muted)"
              strokeOpacity={0.5}
            />
            <circle
              cx={x(points[shown].date)}
              cy={y(points[shown].value as number)}
              r={4.5}
              fill="var(--color-accent)"
              stroke="var(--color-surface)"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      <div aria-hidden className="flex justify-between text-[0.6875rem] text-content-muted" style={{ paddingLeft: padLeft }}>
        <span>{dateLabel(series.start, unit, false)}</span>
        <span>{dateLabel(series.end, unit, false)}</span>
      </div>
    </div>
  );
}

/** "▼ 0.3 kg" since the value before, toned by the metric's direction. */
function Change({ view }: { view: MetricView }) {
  if (!view.latest || !view.previous) return null;
  const delta = view.latest.value - view.previous.value;
  if (Math.abs(delta) < 1e-9) return <span className="text-xs text-content-muted">no change</span>;
  const better = view.def.better ?? "none";
  const good = better === "none" ? null : (better === "up") === delta > 0;
  return (
    <span
      className={`text-xs ${good === null ? "text-content-muted" : good ? "text-accent" : "text-danger"}`}
      title={`since ${view.previous.date}`}
    >
      {delta > 0 ? "▲" : "▼"} {withUnit(Math.abs(delta), view.def)}
    </span>
  );
}

function MetricCard({
  view,
  unit,
  count,
  compact,
  onChanged,
}: {
  view: MetricView;
  unit: MetricUnit;
  count: number;
  compact: boolean;
  onChanged: () => void;
}) {
  const def = view.def;
  const vaultVersion = useAppStore((s) => s.vaultVersion);
  const [series, setSeries] = useState<MetricSeries | null>(null);
  const [date, setDate] = useState(todayISO);
  const [existing, setExisting] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);
  const value = parseNumber(text);

  useEffect(() => {
    let cancelled = false;
    invoke("metric_series", { metric: def.id, unit, count })
      .then((s) => {
        if (!cancelled) setSeries(s);
      })
      .catch((e) => useAppStore.getState().setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [def.id, unit, count, vaultVersion, reload]);

  // what the picked day holds: Add or Replace, and whether Delete shows
  useEffect(() => {
    let cancelled = false;
    invoke("measurement_on", { metric: def.id, date })
      .then((v) => {
        if (!cancelled) setExisting(v);
      })
      .catch((e) => useAppStore.getState().setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [def.id, date, vaultVersion, reload]);

  const changed = () => {
    setText("");
    setDate(todayISO());
    setReload((n) => n + 1);
    onChanged();
  };
  const save = () => {
    if (value === null) return;
    void invoke("measurement_set", { metric: def.id, date, value })
      .then(changed)
      .catch((e) => useAppStore.getState().setError(errorMessage(e)));
  };
  const remove = () => {
    void invoke("measurement_delete", { metric: def.id, date })
      .then(changed)
      .catch((e) => useAppStore.getState().setError(errorMessage(e)));
  };

  if (editing) {
    return (
      <MetricForm
        def={def}
        onDone={(saved) => {
          setEditing(false);
          if (saved) onChanged();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-alt/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-content-muted">
          {metricName(def)}
        </span>
        <span className="flex items-baseline gap-2">
          {view.latest ? (
            <>
              <span className="text-sm font-semibold">{withUnit(view.latest.value, def)}</span>
              <Change view={view} />
            </>
          ) : (
            <span className="text-xs text-content-muted">no values yet</span>
          )}
          {def.goal !== undefined && (
            <span className="text-xs text-content-muted">goal {withUnit(def.goal, def)}</span>
          )}
          <button
            type="button"
            className="btn-ghost min-h-6 min-w-6 px-1 text-sm leading-none text-content-muted"
            aria-label={`Edit ${metricName(def)}`}
            title="Edit this metric"
            onClick={() => setEditing(true)}
          >
            ⋯
          </button>
        </span>
      </div>
      {series && (
        <MetricChart
          series={series}
          def={def}
          unit={unit}
          height={compact ? 120 : 160}
          onPick={(d, v) => {
            setDate(d);
            setText(formatValue(v, def));
          }}
        />
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          type="date"
          aria-label={`${metricName(def)} date`}
          className="input w-36 text-xs"
          value={date}
          max={todayISO()}
          onChange={(e) => setDate(e.target.value || todayISO())}
        />
        <input
          type="text"
          inputMode="decimal"
          aria-label={`${metricName(def)} value`}
          placeholder={existing !== null ? formatValue(existing, def) : def.unit || "value"}
          className="input w-28 text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn-ghost px-2 py-1 text-xs" disabled={value === null}>
          {existing !== null ? "Replace" : "Add"}
        </button>
        {existing !== null && (
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs hover:text-danger"
            aria-label={`Delete the ${metricName(def)} value of ${date}`}
            onClick={remove}
          >
            Delete
          </button>
        )}
      </form>
    </div>
  );
}

/**
 * A metric's definition: a new one, or `def` to edit (its id stays, the
 * values are stored under it) or remove. `onDone(true)` when the file
 * changed.
 */
function MetricForm({ def, onDone }: { def?: MetricDef; onDone: (saved: boolean) => void }) {
  const [id, setId] = useState(def?.id ?? "");
  const [name, setName] = useState(def?.name ?? "");
  const [unitText, setUnitText] = useState(def?.unit ?? "");
  const [decimals, setDecimals] = useState(def?.decimals !== undefined ? String(def.decimals) : "");
  const [rollup, setRollup] = useState<"avg" | "sum" | "last">(def?.rollup ?? "avg");
  const [better, setBetter] = useState<"down" | "up" | "none">(def?.better ?? "none");
  const [line, setLine] = useState<"raw" | "mean">(def?.line ?? "raw");
  const [goal, setGoal] = useState(def?.goal !== undefined ? String(def.goal) : "");
  const goalValue = parseNumber(goal);
  const decimalsOk = decimals === "" || /^[0-6]$/.test(decimals);
  const idOk = /^[a-z0-9_-]{1,64}$/.test(id);
  const ok = idOk && decimalsOk && (goal.trim() === "" || goalValue !== null);
  const fail = (e: unknown) => useAppStore.getState().setError(errorMessage(e));
  const submit = () => {
    const next: MetricDef = {
      id,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(unitText.trim() ? { unit: unitText.trim() } : {}),
      ...(decimals !== "" ? { decimals: Number(decimals) } : {}),
      ...(goalValue !== null ? { goal: goalValue } : {}),
      ...(better !== "none" ? { better } : {}),
      rollup,
      ...(line !== "raw" ? { line } : {}),
    };
    const call = def ? invoke("metric_update", { id: def.id, def: next }) : invoke("metric_add", { def: next });
    void call.then(() => onDone(true)).catch(fail);
  };
  const removeMetric = () => {
    if (!def) return;
    void invoke("metric_update", { id: def.id, def: null })
      .then(() => onDone(true))
      .catch(fail);
  };
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface-alt/50 p-4 text-xs"
      aria-label={def ? `Edit ${metricName(def)}` : "New metric"}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) submit();
      }}
    >
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-content-muted">
        {def ? metricName(def) : "New metric"}
      </span>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-0.5">
          Id
          <input
            className="input w-32"
            value={id}
            placeholder="weight"
            disabled={def !== undefined}
            onChange={(e) => setId(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          Name
          <input className="input w-40" value={name} placeholder="Weight" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5">
          Unit
          <input className="input w-20" value={unitText} placeholder="kg" onChange={(e) => setUnitText(e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5">
          Decimals
          <input
            className="input w-16"
            inputMode="numeric"
            value={decimals}
            placeholder="as typed"
            onChange={(e) => setDecimals(e.target.value.trim())}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          Goal
          <input
            className="input w-20"
            inputMode="decimal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-0.5">
          Better
          <select className="input w-24" value={better} onChange={(e) => setBetter(e.target.value as typeof better)}>
            <option value="none">either way</option>
            <option value="down">lower</option>
            <option value="up">higher</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          Days as
          <select className="input w-32" value={line} onChange={(e) => setLine(e.target.value as typeof line)}>
            <option value="raw">values</option>
            <option value="mean">7-day mean</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          A week as
          <select className="input w-28" value={rollup} onChange={(e) => setRollup(e.target.value as typeof rollup)}>
            <option value="avg">average</option>
            <option value="sum">sum</option>
            <option value="last">last value</option>
          </select>
        </label>
      </div>
      <span className="text-[0.6875rem] text-content-muted">
        {def
          ? "The id is what the values are stored under, so it stays. Removing the metric keeps its values: a metric added back under this id finds them."
          : "The id is what values are stored under: the name can change later, the id should not."}{" "}
        A 7-day mean suits a number that wobbles day to day, like a body weight.
      </span>
      <div className="flex gap-2">
        <button type="submit" className="btn-ghost px-2 py-1" disabled={!ok}>
          {def ? "Save" : "Add metric"}
        </button>
        <button type="button" className="btn-ghost px-2 py-1" onClick={() => onDone(false)}>
          Cancel
        </button>
        {def && (
          <>
            <div className="flex-1" />
            <button type="button" className="btn-ghost px-2 py-1 hover:text-danger" onClick={removeMetric}>
              Remove metric
            </button>
          </>
        )}
      </div>
    </form>
  );
}

/**
 * The Tracker's numbers: one card per metric in metrics.yml, each with
 * its chart and a row to enter or correct a day's value.
 */
export default function Metrics({ compact }: { compact: boolean }) {
  const vaultVersion = useAppStore((s) => s.vaultVersion);
  const [overview, setOverview] = useState<MetricsOverview | null>(null);
  const [unit, setUnit] = useState<MetricUnit>("day");
  const [count, setCount] = useState(RANGES.day[1]);
  const [adding, setAdding] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void invoke("metrics_overview")
      .then((o) => {
        if (!cancelled) setOverview(o);
      })
      .catch((e) => useAppStore.getState().setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [vaultVersion, reload]);

  if (!overview) return null;
  const refresh = () => setReload((n) => n + 1);

  return (
    <section className="flex flex-col gap-3" aria-label="Metrics">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Metrics</h2>
        {overview.metrics.length > 0 && (
          <>
            <div className="flex rounded-md border border-line" role="group" aria-label="Metric period">
              {(["day", "week", "month"] as MetricUnit[]).map((u) => (
                <button
                  key={u}
                  aria-pressed={unit === u}
                  className={`px-3 py-1 text-xs ${unit === u ? "bg-accent-fill text-white" : "text-content-muted"}`}
                  onClick={() => {
                    setUnit(u);
                    setCount(RANGES[u][1]);
                  }}
                >
                  {UNIT_LABEL[u]}
                </button>
              ))}
            </div>
            <select
              aria-label="Metric range"
              className="input w-36 text-xs"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {RANGES[unit].map((n) => (
                <option key={n} value={n}>
                  Last {n} {UNIT_WORD[unit]}
                </option>
              ))}
            </select>
          </>
        )}
        <div className="flex-1" />
        {!adding && (
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setAdding(true)}>
            New metric
          </button>
        )}
      </div>
      {overview.errors.length > 0 && (
        <div className="rounded-md border border-danger/50 px-3 py-2 text-xs" role="alert">
          {overview.errors.map((e, i) => (
            <div key={i}>
              {e.file}
              {e.line !== null ? `:${e.line}` : ""}: {e.message}
            </div>
          ))}
          {!compact && (
            <button
              className="mt-1 underline"
              onClick={() => useAppStore.getState().openConfigFile("metrics.yml")}
            >
              Open metrics.yml
            </button>
          )}
        </div>
      )}
      {adding && (
        <MetricForm
          onDone={(saved) => {
            setAdding(false);
            if (saved) refresh();
          }}
        />
      )}
      {overview.metrics.length === 0 && !adding && (
        <p className="text-sm text-content-muted">
          No metrics yet. A metric is a number you note down over time - a body weight, a follower
          count - one value per day. Add one here or in metrics.yml.
        </p>
      )}
      {overview.metrics.map((view) => (
        <MetricCard
          key={view.def.id}
          view={view}
          unit={unit}
          count={count}
          compact={compact}
          onChanged={refresh}
        />
      ))}
    </section>
  );
}
