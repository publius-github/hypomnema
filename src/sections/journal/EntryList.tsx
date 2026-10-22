import { useEffect, useState } from "react";

const monthName = (date: string) =>
  new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1)
    .toLocaleDateString("en-US", { month: "long" });

/**
 * The Journal's entry index: years and months that fold (the open
 * entry's and the current ones start unfolded - years of daily entries
 * make a flat list endless), each level indented under the one above,
 * and above them the entries written on this calendar day in earlier
 * years.
 */
export default function EntryList({
  dates,
  current,
  today,
  onOpen,
}: {
  /** newest first */
  dates: string[];
  current: string | null;
  today: string;
  onOpen: (date: string) => void;
}) {
  // one set for both levels: a year key is "2026", a month key "2026-10"
  const [expanded, setExpanded] = useState(
    () => new Set([today.slice(0, 4), today.slice(0, 7)]),
  );
  // opening an entry of a folded year or month unfolds it
  useEffect(() => {
    if (!current) return;
    const year = current.slice(0, 4);
    const month = current.slice(0, 7);
    setExpanded((prev) =>
      prev.has(year) && prev.has(month)
        ? prev
        : new Set(prev).add(year).add(month),
    );
  }, [current]);
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const anchor = current ?? today;
  const onThisDay = dates.filter(
    (d) => d.slice(5) === anchor.slice(5) && d < anchor,
  );

  const years: { year: string; months: { month: string; dates: string[] }[] }[] =
    [];
  for (const date of dates) {
    const year = date.slice(0, 4);
    const month = date.slice(0, 7);
    let y = years[years.length - 1];
    if (y?.year !== year) {
      y = { year, months: [] };
      years.push(y);
    }
    let m = y.months[y.months.length - 1];
    if (m?.month !== month) {
      m = { month, dates: [] };
      y.months.push(m);
    }
    m.dates.push(date);
  }

  const row = (date: string, label?: string) => (
    <button
      key={date}
      className={`block w-full rounded px-2 py-1 text-left text-sm ${
        current === date
          ? "bg-accent/15 text-accent"
          : "text-content hover:bg-line/40"
      }`}
      onClick={() => onOpen(date)}
    >
      {label ?? date}
      {date === today && " (today)"}
    </button>
  );

  // a year or month row: chevron, label, count of its entries
  const fold = (
    key: string,
    label: string,
    count: number,
    weight: string,
  ) => {
    const open = expanded.has(key);
    return (
      <button
        className={`flex w-full items-center gap-1 rounded-sm px-1 py-1 text-left text-sm ${weight} hover:bg-line/40`}
        aria-expanded={open}
        onClick={() => toggle(key)}
      >
        <span className="w-3 text-content-muted">{open ? "▾" : "▸"}</span>
        {label}
        <span className="ml-auto text-xs font-normal text-content-muted">
          {count}
        </span>
      </button>
    );
  };

  const heading = "pb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-content-muted";

  return (
    <>
      {onThisDay.length > 0 && (
        <div className="pb-3">
          <div className={heading}>On this day</div>
          {onThisDay.map((date) => {
            const ago = Number(anchor.slice(0, 4)) - Number(date.slice(0, 4));
            return row(date, `${date.slice(0, 4)} · ${ago} yr ago`);
          })}
        </div>
      )}
      <div className={heading}>Entries</div>
      {years.map(({ year, months }) => {
        const count = months.reduce((n, m) => n + m.dates.length, 0);
        return (
          <div key={year}>
            {fold(year, year, count, "font-semibold")}
            {expanded.has(year) &&
              months.map(({ month, dates: inMonth }) => (
                <div key={month} className="pl-4">
                  {fold(month, monthName(`${month}-01`), inMonth.length, "font-medium")}
                  {expanded.has(month) && (
                    <div className="pb-1 pl-4">
                      {inMonth.map((date) => row(date))}
                    </div>
                  )}
                </div>
              ))}
          </div>
        );
      })}
    </>
  );
}
