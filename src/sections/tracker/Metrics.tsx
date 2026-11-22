import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { errorMessage, invoke } from "../../lib/ipc";
import { useAppStore } from "../../store";
import Icon from "../../components/icons";
import { todayISO } from "../../lib/tasks";
import type {
  MetricDef,
  MetricSeries,
  MetricView,
  MetricsOverview,
} from "../../types";

/** Button widths here: one for a word, one for two, so a row does not
    follow its labels' lengths. */
const BTN_SHORT = "w-20 shrink-0 px-0 text-center";
const BTN_LONG = "w-28 shrink-0 px-0 text-center";

export type MetricUnit = "day" | "week" | "month";

const RANGES: Record<MetricUnit, number[]> = {
  day: [7, 14, 30, 90, 365],
  week: [12, 26, 52],
  month: [12, 24, 60],
};
const DEFAULT_RANGE: Record<MetricUnit, number> = { day: 30, week: 26, month: 24 };

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
const dayISO = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** A pace needs its ends this many days apart: shorter, a day's wobble is all it shows. */
export const MIN_PACE_DAYS = 3;
/** A goal date further out than this is noise, not a forecast. */
export const MAX_GOAL_DAYS = 730;

export interface Pace {
  /** change per week */
  rate: number;
  from: { date: string; value: number };
  to: { date: string; value: number };
}

/**
 * The pace of the line the chart draws, per week: from its first point
 * to its last, so the number agrees with the ends on screen (a fitted
 * slope follows the whole shape and can point down while the line ends
 * higher than it started). `smooth` reads the seven-day mean. Null with
 * fewer than two points or ends under MIN_PACE_DAYS apart.
 */
export function pace(series: MetricSeries, smooth: boolean): Pace | null {
  const line = series.points.flatMap((p) => {
    const v = smooth ? p.avg : p.value;
    return v === null ? [] : [{ date: p.date, value: v }];
  });
  if (line.length < 2) return null;
  const from = line[0];
  const to = line[line.length - 1];
  const span = dayNumber(to.date) - dayNumber(from.date);
  if (span < MIN_PACE_DAYS) return null;
  return { rate: ((to.value - from.value) / span) * 7, from, to };
}

/**
 * The day `value` on `date` reaches `goal` at `rate` per week; null when
 * moving away from it, standing still, or past MAX_GOAL_DAYS.
 */
export function goalDate(date: string, value: number, goal: number, rate: number): string | null {
  const remaining = goal - value;
  if (remaining === 0) return date;
  if (rate === 0 || remaining * rate < 0) return null;
  const days = Math.round(remaining / (rate / 7));
  return days > MAX_GOAL_DAYS ? null : dayISO(dayNumber(date) + days);
}

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

/** "▼ 0.6 kg/wk", toned by the metric's direction. */
function PaceBadge({ pace: p, def }: { pace: Pace; def: MetricDef }) {
  const shown = formatValue(Math.abs(p.rate), def);
  const title = `from ${withUnit(p.from.value, def)} on ${dateLabel(p.from.date, "day")} to ${withUnit(p.to.value, def)} on ${dateLabel(p.to.date, "day")}`;
  if (Number(shown) === 0) return <span className="text-xs text-content-muted" title={title}>flat</span>;
  const better = def.better ?? "none";
  const good = better === "none" ? null : (better === "up") === p.rate > 0;
  return (
    <span
      className={`text-xs ${good === null ? "text-content-muted" : good ? "text-accent" : "text-danger"}`}
      title={title}
    >
      {p.rate > 0 ? "▲" : "▼"} {def.unit ? `${shown} ${def.unit}` : shown}/wk
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

  // a mean metric stands at its seven-day mean and moves at the pace of
  // the line drawn; a raw one at its last value, against the one before
  const smooth = def.line === "mean";
  const headline = smooth && view.mean !== null ? view.mean : (view.latest?.value ?? null);
  const trend = smooth && series ? pace(series, unit === "day") : null;
  const reach =
    trend && def.goal !== undefined && view.latest && headline !== null
      ? goalDate(view.latest.date, headline, def.goal, trend.rate)
      : null;

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
          {view.latest && headline !== null ? (
            <>
              <span
                className="text-sm font-semibold"
                title={
                  smooth
                    ? `mean of the 7 days to ${dateLabel(view.latest.date, "day")}; last value ${withUnit(view.latest.value, def)}`
                    : undefined
                }
              >
                {withUnit(headline, def)}
              </span>
              {smooth ? trend && <PaceBadge pace={trend} def={def} /> : <Change view={view} />}
            </>
          ) : (
            <span className="text-xs text-content-muted">no values yet</span>
          )}
          {def.goal !== undefined && (
            <span className="text-xs text-content-muted" title={reach ? "at this pace" : undefined}>
              goal {withUnit(def.goal, def)}
              {reach && ` · ~${dateLabel(reach, "day")}`}
            </span>
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
      {def.description && (
        <p className="whitespace-pre-line text-xs text-content-muted">{def.description}</p>
      )}
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
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          type="date"
          aria-label={`${metricName(def)} date`}
          className="input w-32 shrink-0 px-2 text-xs"
          value={date}
          max={todayISO()}
          onChange={(e) => setDate(e.target.value || todayISO())}
        />
        <input
          type="text"
          inputMode="decimal"
          aria-label={`${metricName(def)} value`}
          placeholder={existing !== null ? formatValue(existing, def) : def.unit || "value"}
          className="input min-w-0 flex-1 text-xs sm:max-w-40 sm:flex-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className={`btn-ghost py-1 text-xs ${BTN_SHORT}`} disabled={value === null}>
          {existing !== null ? "Replace" : "Add"}
        </button>
        {/* the slot stays when the day is empty, so the row does not shift */}
        <button
          type="button"
          className={`btn-ghost flex h-[30px] w-8 shrink-0 items-center justify-center px-0 text-content-muted hover:border-danger hover:text-danger ${existing === null ? "invisible" : ""}`}
          aria-label={`Delete the ${metricName(def)} value of ${date}`}
          title="Delete this day's value"
          disabled={existing === null}
          aria-hidden={existing === null}
          onClick={remove}
        >
          <Icon name="trash" className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  і: "i", ї: "yi", є: "ye", ґ: "g",
};

/**
 * A new metric's id from its name, in kebab-case: "Body weight" ->
 * "body-weight", "Вес утром" -> "ves-utrom"; a taken id gets "-2", "-3".
 */
export function metricId(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[а-яёіїєґ]/g, (c) => CYRILLIC[c] ?? "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "metric";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** One labelled row of the metric form: the label beside, or above on a phone. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start">
      <label htmlFor={id} className="text-sm text-content-muted sm:pt-1.5">
        {label}
      </label>
      <div className="flex min-w-0 flex-col gap-1">
        {children(id)}
        {hint && <span className="text-xs text-content-muted">{hint}</span>}
      </div>
    </div>
  );
}

/**
 * A metric's definition: a new one (its id made from the name, clear of
 * `taken`), or `def` to edit (its id stays, the values are stored under
 * it) or remove. `onDone(true)` when the file changed.
 */
function MetricForm({
  def,
  taken = [],
  onDone,
}: {
  def?: MetricDef;
  taken?: readonly string[];
  onDone: (saved: boolean) => void;
}) {
  const [name, setName] = useState(def?.name ?? "");
  const [description, setDescription] = useState(def?.description ?? "");
  const [unitText, setUnitText] = useState(def?.unit ?? "");
  const [decimals, setDecimals] = useState(def?.decimals !== undefined ? String(def.decimals) : "");
  const [rollup, setRollup] = useState<"avg" | "sum" | "last">(def?.rollup ?? "avg");
  const [better, setBetter] = useState<"down" | "up" | "none">(def?.better ?? "none");
  const [line, setLine] = useState<"raw" | "mean">(def?.line ?? "raw");
  const [goal, setGoal] = useState(def?.goal !== undefined ? String(def.goal) : "");
  const id = def ? def.id : metricId(name, taken);
  const goalValue = parseNumber(goal);
  const decimalsOk = decimals === "" || /^[0-6]$/.test(decimals);
  const ok = (def !== undefined || name.trim() !== "") && decimalsOk && (goal.trim() === "" || goalValue !== null);
  const fail = (e: unknown) => useAppStore.getState().setError(errorMessage(e));
  const submit = () => {
    const next: MetricDef = {
      id,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
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
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface-alt/50 p-4"
      aria-label={def ? `Edit ${metricName(def)}` : "New metric"}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) submit();
      }}
    >
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-content-muted">
        {def ? metricName(def) : "New metric"}
      </span>
      <Field
        label="Name"
        hint={
          def
            ? `Values are stored under the id "${id}": the name can change, the id stays.`
            : name.trim()
              ? `Values will be stored under the id "${id}".`
              : undefined
        }
      >
        {(fid) => (
          <input
            id={fid}
            className="input w-full"
            value={name}
            placeholder="Weight"
            autoFocus={!def}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field label="Description">
        {(fid) => (
          <textarea
            id={fid}
            className="input min-h-16 w-full resize-y"
            rows={2}
            value={description}
            placeholder="Optional: what is measured and how, e.g. in the morning, before breakfast"
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <Field label="Unit">
        {(fid) => (
          <input
            id={fid}
            className="input w-full"
            value={unitText}
            placeholder="kg"
            onChange={(e) => setUnitText(e.target.value)}
          />
        )}
      </Field>
      <Field label="Decimals" hint={decimalsOk ? "0-6; empty shows values as typed." : "A digit from 0 to 6."}>
        {(fid) => (
          <input
            id={fid}
            className="input w-full"
            inputMode="numeric"
            value={decimals}
            placeholder="as typed"
            aria-invalid={!decimalsOk}
            onChange={(e) => setDecimals(e.target.value.trim())}
          />
        )}
      </Field>
      <Field label="Goal" hint="Optional: drawn as a dashed line on the chart.">
        {(fid) => (
          <input
            id={fid}
            className="input w-full"
            inputMode="decimal"
            value={goal}
            aria-invalid={goal.trim() !== "" && goalValue === null}
            onChange={(e) => setGoal(e.target.value)}
          />
        )}
      </Field>
      <Field label="Better">
        {(fid) => (
          <select
            id={fid}
            className="input w-full"
            value={better}
            onChange={(e) => setBetter(e.target.value as typeof better)}
          >
            <option value="none">either way</option>
            <option value="down">lower is better</option>
            <option value="up">higher is better</option>
          </select>
        )}
      </Field>
      <Field label="Days as" hint="A 7-day mean suits a number that wobbles day to day, like a body weight.">
        {(fid) => (
          <select
            id={fid}
            className="input w-full"
            value={line}
            onChange={(e) => setLine(e.target.value as typeof line)}
          >
            <option value="raw">values as entered</option>
            <option value="mean">7-day mean</option>
          </select>
        )}
      </Field>
      <Field label="A week as" hint="How the week and month views fold a period's values into one.">
        {(fid) => (
          <select
            id={fid}
            className="input w-full"
            value={rollup}
            onChange={(e) => setRollup(e.target.value as typeof rollup)}
          >
            <option value="avg">average</option>
            <option value="sum">sum</option>
            <option value="last">last value</option>
          </select>
        )}
      </Field>
      <div className="flex items-center gap-2 border-t border-line pt-3">
        <button type="submit" className={`btn-primary disabled:opacity-50 ${def ? BTN_SHORT : BTN_LONG}`} disabled={!ok}>
          {def ? "Save" : "Add metric"}
        </button>
        <button type="button" className={`btn-ghost ${BTN_SHORT}`} onClick={() => onDone(false)}>
          Cancel
        </button>
        {def && (
          <>
            <div className="flex-1" />
            <button
              type="button"
              className={`btn-danger ${BTN_LONG}`}
              title="The values stay: a metric added back under this id finds them"
              onClick={removeMetric}
            >
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
/** A metric's anchor on the page, for the Tracker index to scroll to. */
export const metricAnchor = (id: string) => `tracker-metric-${id}`;

export default function Metrics({
  compact,
  highlightId = null,
  onIndex,
}: {
  compact: boolean;
  /** the anchor just jumped to from the index: it wears a short ring */
  highlightId?: string | null;
  /** the metrics as the index lists them, sent on every load */
  onIndex?: (rows: { anchor: string; name: string }[]) => void;
}) {
  const vaultVersion = useAppStore((s) => s.vaultVersion);
  const [overview, setOverview] = useState<MetricsOverview | null>(null);
  const [unit, setUnit] = useState<MetricUnit>("day");
  const [count, setCount] = useState(DEFAULT_RANGE.day);
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

  useEffect(() => {
    if (overview)
      onIndex?.(overview.metrics.map((m) => ({ anchor: metricAnchor(m.def.id), name: metricName(m.def) })));
  }, [overview, onIndex]);

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
                    setCount(DEFAULT_RANGE[u]);
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
          <button className={`btn-ghost py-1 text-xs ${BTN_LONG}`} onClick={() => setAdding(true)}>
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
          taken={overview.metrics.map((m) => m.def.id)}
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
        // the wrapper is the anchor, so an open edit form is one too
        <div
          key={view.def.id}
          id={metricAnchor(view.def.id)}
          className={`scroll-mt-6 rounded-lg ${highlightId === metricAnchor(view.def.id) ? "ring-2 ring-accent" : ""}`}
        >
          <MetricCard view={view} unit={unit} count={count} compact={compact} onChanged={refresh} />
        </div>
      ))}
    </section>
  );
}
