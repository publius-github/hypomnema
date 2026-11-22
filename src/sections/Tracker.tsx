import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import { splitCategory } from "../lib/tasks";
import type { HabitTrends, TrendBucket } from "../types";
import Metrics from "./tracker/Metrics";

type Unit = "week" | "month";

const RANGES: Record<Unit, number[]> = {
  week: [12, 26, 52],
  month: [6, 12, 24],
};

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "17 Aug" for a week's Monday, "Aug 2026" for a month. */
export function periodLabel(start: string, unit: Unit): string {
  const month = MONTHS_SHORT[Number(start.slice(5, 7)) - 1];
  return unit === "week"
    ? `${Number(start.slice(8, 10))} ${month}`
    : `${month} ${start.slice(0, 4)}`;
}

/** Whole percent, rounded down like the card's rate chip; null = nothing settled. */
export function rateOf(bucket: TrendBucket): number | null {
  return bucket.total > 0 ? Math.floor((bucket.done * 100) / bucket.total) : null;
}

function describe(start: string, unit: Unit, bucket: TrendBucket): string {
  const when = unit === "week" ? `Week of ${periodLabel(start, unit)}` : periodLabel(start, unit);
  const rate = rateOf(bucket);
  return rate === null
    ? `${when}: nothing due`
    : `${when}: ${bucket.done} of ${bucket.total} done (${rate}%)`;
}

/**
 * One series of completion rates as bars, 0-100%. A period with
 * nothing settled shows a muted tick on the baseline instead of a bar,
 * so "nothing was due" never reads as 0%. The dashed line is the rate
 * alert threshold.
 */
function TrendBars({
  periods,
  buckets,
  unit,
  threshold,
  height,
  detailed,
  label,
}: {
  periods: string[];
  buckets: TrendBucket[];
  unit: Unit;
  threshold: number;
  height: number;
  detailed: boolean;
  label: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const shown = active ?? buckets.length - 1;
  const summary = periods
    .map((p, i) => describe(p, unit, buckets[i]))
    .join("; ");
  return (
    <div className="flex flex-col gap-1">
      {detailed && (
        <div className="text-xs text-content-muted" aria-hidden>
          {describe(periods[shown], unit, buckets[shown])}
        </div>
      )}
      <div
        role="img"
        aria-label={`${label}: ${summary}`}
        className="relative flex items-end gap-[2px]"
        style={{ height }}
        onMouseLeave={() => setActive(null)}
      >
        {detailed &&
          [0, 50, 100].map((g) => (
            <div
              key={g}
              aria-hidden
              className="pointer-events-none absolute inset-x-0 border-t border-line/50"
              style={{ bottom: `${g}%` }}
            />
          ))}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-content-muted/60"
          style={{ bottom: `${threshold}%` }}
        />
        {buckets.map((bucket, i) => {
          const rate = rateOf(bucket);
          return (
            <div
              key={periods[i]}
              aria-hidden
              title={detailed ? undefined : describe(periods[i], unit, bucket)}
              className="relative flex h-full min-w-0 flex-1 items-end"
              onMouseEnter={() => setActive(i)}
              onClick={() => setActive(i)}
            >
              {rate === null ? (
                <div className="h-[2px] w-full rounded-full bg-line" />
              ) : (
                <div
                  className={`w-full rounded-t-[4px] ${
                    rate === 0
                      ? "bg-danger/50"
                      : rate < threshold
                        ? "bg-accent/45"
                        : "bg-accent"
                  } ${detailed && i === shown ? "ring-2 ring-content/40" : ""}`}
                  // a 0% period still gets a visible not-done block (the
                  // History strip's tone), so a measured zero never reads
                  // as the empty slot's baseline tick
                  style={{ height: `${rate}%`, minHeight: 3 }}
                />
              )}
            </div>
          );
        })}
      </div>
      {detailed && periods.length > 0 && (
        <div
          aria-hidden
          className="flex justify-between text-[0.6875rem] text-content-muted"
        >
          <span>{periodLabel(periods[0], unit)}</span>
          {periods.length > 2 && (
            <span>{periodLabel(periods[Math.floor(periods.length / 2)], unit)}</span>
          )}
          <span>{periodLabel(periods[periods.length - 1], unit)}</span>
        </div>
      )}
    </div>
  );
}

/** The index rail shows from this many metrics on. */
export const INDEX_MIN_METRICS = 3;

const HABITS_ALL = "tracker-habits-all";
const HABITS_RULES = "tracker-habits-rules";

type IndexRow = { anchor: string; name: string };

/**
 * The page's sticky right rail, same look as the Lists index: a click
 * scrolls the section into view and flashes it; the row of the section
 * at the top of the page stays lit while the page scrolls.
 */
function TrackerIndex({
  groups,
  active,
  onJump,
}: {
  groups: { title: string; rows: IndexRow[] }[];
  active: string | null;
  onJump: (anchor: string) => void;
}) {
  return (
    <nav
      aria-label="Tracker index"
      className="sticky top-6 hidden w-40 shrink-0 flex-col gap-2 rounded-lg border border-line bg-surface-alt/50 p-1.5 xl:flex"
    >
      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-0.5">
          <div className="px-1 pb-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-content-muted">
            {group.title}
          </div>
          {group.rows.map((row) => (
            <button
              key={row.anchor}
              aria-current={active === row.anchor ? "location" : undefined}
              className={`truncate rounded px-1.5 py-0.5 text-left text-xs ${
                active === row.anchor
                  ? "bg-accent/15 text-accent"
                  : "text-content-muted hover:bg-line/40 hover:text-content"
              }`}
              title={`Scroll to "${row.name}"`}
              onClick={() => onJump(row.anchor)}
            >
              {row.name}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * Completion trends of the recurring rules: the share of settled
 * instances done per week or month, all rules together and per rule.
 * Counted the way the card's rate chip counts (views::habit_trends).
 * `compact` drops the page padding for the phone's More screen.
 */
export function TrackerView({ compact = false }: { compact?: boolean }) {
  const vaultVersion = useAppStore((s) => s.vaultVersion);
  const threshold = useAppStore((s) => s.config?.habit_rate_threshold ?? 80);
  const [unit, setUnit] = useState<Unit>("week");
  const [count, setCount] = useState(12);
  const [trends, setTrends] = useState<HabitTrends | null>(null);
  const [metricRows, setMetricRows] = useState<IndexRow[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void invoke("habit_trends", { unit, count })
      .then((t) => {
        if (!cancelled) setTrends(t);
      })
      .catch((e) => useAppStore.getState().setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [unit, count, vaultVersion]);

  useEffect(
    () => () => {
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    },
    [],
  );

  const showIndex = !compact && metricRows.length >= INDEX_MIN_METRICS;
  const indexGroups = [
    { title: "Metrics", rows: metricRows },
    ...(trends && trends.rules.length > 0
      ? [
          {
            title: "Habits",
            rows: [
              { anchor: HABITS_ALL, name: "All recurring tasks" },
              { anchor: HABITS_RULES, name: "By task" },
            ],
          },
        ]
      : []),
  ];
  const anchorsKey = indexGroups.flatMap((g) => g.rows.map((r) => r.anchor)).join(" ");

  // the lit row: the last section whose top has passed the page's top
  // edge, or the last one once the page is scrolled to its end
  useEffect(() => {
    const el = scroller.current;
    if (!showIndex || !el) return;
    const anchors = anchorsKey.split(" ");
    let frame = 0;
    const spy = () => {
      frame = 0;
      const edge = el.getBoundingClientRect().top + 32;
      let current = anchors[0];
      for (const a of anchors) {
        const node = document.getElementById(a);
        if (node && node.getBoundingClientRect().top <= edge) current = a;
      }
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) current = anchors[anchors.length - 1];
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(spy);
    };
    spy();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [showIndex, anchorsKey]);

  const jumpTo = useCallback((anchor: string) => {
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlightId(anchor);
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightId(null), 2000);
  }, []);

  const ring = (anchor: string) => (highlightId === anchor ? "ring-2 ring-accent" : "");

  const switchUnit = (next: Unit) => {
    setUnit(next);
    setCount(RANGES[next][0]);
  };

  const overallSum = trends?.overall.reduce(
    (acc, b) => ({ done: acc.done + b.done, total: acc.total + b.total }),
    { done: 0, total: 0 },
  );
  const overallRate = overallSum ? rateOf(overallSum) : null;
  const unitWord = unit === "week" ? "weeks" : "months";

  const column = (
    <div
      className={
        compact ? "flex flex-col gap-4 p-4" : "flex w-full min-w-0 max-w-4xl flex-col gap-4"
      }
    >
      <Metrics compact={compact} highlightId={highlightId} onIndex={setMetricRows} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Habits</h2>
        <div className="flex rounded-md border border-line" role="group" aria-label="Habit period">
          {(["week", "month"] as Unit[]).map((u) => (
            <button
              key={u}
              aria-pressed={unit === u}
              className={`px-3 py-1 text-xs ${
                unit === u ? "bg-accent-fill text-white" : "text-content-muted"
              }`}
              onClick={() => switchUnit(u)}
            >
              {u === "week" ? "Weeks" : "Months"}
            </button>
          ))}
        </div>
        <select
          aria-label="Habit range"
          className="input w-36 text-xs"
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        >
          {RANGES[unit].map((n) => (
            <option key={n} value={n}>
              Last {n} {unitWord}
            </option>
          ))}
        </select>
      </div>

      {trends && trends.rules.length === 0 && (
        <p className="text-sm text-content-muted">
          No recurring task has come due in the last {count} {unitWord} yet.
          Rates appear here once instances are done, dropped or missed.
        </p>
      )}

      {trends && trends.rules.length > 0 && (
        <>
          <div
            id={HABITS_ALL}
            className={`flex scroll-mt-6 flex-col gap-2 rounded-lg border border-line bg-surface-alt/50 p-4 ${ring(HABITS_ALL)}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-content-muted">
                All recurring tasks
              </span>
              {overallRate !== null && overallSum && (
                <span className="text-sm">
                  <span className="font-semibold">{overallRate}%</span>
                  <span className="text-content-muted">
                    {" "}
                    · {overallSum.done} of {overallSum.total}
                  </span>
                </span>
              )}
            </div>
            <TrendBars
              periods={trends.periods}
              buckets={trends.overall}
              unit={unit}
              threshold={threshold}
              height={compact ? 120 : 160}
              detailed
              label={`All recurring tasks by ${unit}`}
            />
          </div>

          <div
            id={HABITS_RULES}
            className={`flex scroll-mt-6 flex-col gap-2 rounded-lg border border-line bg-surface-alt/50 p-4 ${ring(HABITS_RULES)}`}
          >
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-content-muted">
              By task, weakest first
            </span>
            {trends.rules.map((rule) => {
              const rate = rateOf(rule.sum);
              return (
                <div key={rule.rule_key} className="flex items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {splitCategory(rule.title).text}
                    </span>
                    <span className="block text-[0.6875rem] text-content-muted">
                      {rule.cadence ?? "recurring"} · {rule.sum.done} of{" "}
                      {rule.sum.total}
                    </span>
                  </span>
                  <div className={compact ? "w-28 shrink-0" : "w-56 shrink-0"}>
                    <TrendBars
                      periods={trends.periods}
                      buckets={rule.buckets}
                      unit={unit}
                      threshold={threshold}
                      height={24}
                      detailed={false}
                      label={splitCategory(rule.title).text}
                    />
                  </div>
                  <span
                    className={`w-12 shrink-0 text-right font-semibold ${
                      rate !== null && rate < threshold ? "text-danger" : ""
                    }`}
                  >
                    {rate}%
                  </span>
                </div>
              );
            })}
          </div>

          <p className="text-[0.6875rem] text-content-muted">
            Share of instances done, each counted in the {unit} it was due.
            Done-waiting counts as done; dropped and missed dailies count as
            not done; an open weekly or monthly waits until it is closed.
            The dashed line is the rate alert threshold ({threshold}%). Done
            and dropped days stay counted after their task is deleted. A
            renamed task or a changed schedule starts a new row unless its
            rule has an id, which keeps the history on one row.
          </p>
        </>
      )}
    </div>
  );

  if (compact) return column;
  // the page scrolls as a whole so the rail can stick; the column keeps
  // its width and the pair centres together
  return (
    <div ref={scroller} className="h-full w-full overflow-y-auto">
      <div className="flex w-full items-start justify-center gap-6 p-6">
        {column}
        {showIndex && <TrackerIndex groups={indexGroups} active={active} onJump={jumpTo} />}
      </div>
    </div>
  );
}

export default function Tracker() {
  return <TrackerView />;
}
