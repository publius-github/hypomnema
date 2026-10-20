import type { ReactNode } from "react";
import { addDaysISO } from "../lib/tasks";

export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDaysISO(today, 1)) return "Tomorrow";
  if (date === addDaysISO(today, -1)) return "Yesterday";
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

/** The date under the day's name: "Wed, 14 Oct". */
function dateLine(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// Drawn rather than glyphs (‹ ⌕ ≡): a glyph's size is the system font's
// to decide and came out tiny next to the day's name; strokes in
// currentColor take the button's tint like the tab bar's icons do.
const ICON = {
  viewBox: "0 0 24 24",
  width: 24,
  height: 24,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const SearchIcon = () => (
  <svg {...ICON} width={22} height={22}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const MenuIcon = () => (
  <svg {...ICON} width={22} height={22}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const Chevron = ({ back }: { back?: boolean }) => (
  <svg {...ICON}>
    <path d={back ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
  </svg>
);

export const SyncIcon = () => (
  <svg {...ICON} width={20} height={20}>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);

/**
 * The header the day-at-a-time screens (Day, Journal) share, so they
 * read the same: a left action, the day's name over its date with
 * ‹ › around it - the label doubles as the date picker - and Today on
 * the right only away from today, next to whatever the screen puts in
 * the right slot (the Day's sync button). The side slots are equal
 * while the right one holds a single control, which keeps the day in
 * the true centre; with Today beside it the centre gives a little.
 */
export default function DayHeader({
  date,
  today,
  onDate,
  left,
  right,
  status,
}: {
  date: string;
  today: string;
  onDate: (date: string) => void;
  /** The left slot's button (search on Day, the entry list on Journal). */
  left: ReactNode;
  /** The right slot's own control, kept beside Today. */
  right?: ReactNode;
  /** A short mark after the date line ("Saving..."), if any. */
  status?: ReactNode;
}) {
  return (
    <header className="grid grid-cols-[3.25rem_1fr_auto] items-center border-b border-line px-1 py-1.5">
      <div className="flex justify-center">{left}</div>
      <div className="flex min-w-0 items-center justify-center">
        <button
          onClick={() => onDate(addDaysISO(date, -1))}
          aria-label="Previous day"
          className="flex h-11 w-11 shrink-0 items-center justify-center text-content-muted"
        >
          <Chevron back />
        </button>
        {/* a transparent date input laid over the label opens the system
            calendar, without the input's own mm/dd/yyyy field showing */}
        <label className="relative min-w-0 flex-1 text-center">
          <div className="truncate font-semibold leading-tight">
            {dayLabel(date, today)}
          </div>
          <div className="truncate text-xs leading-tight text-content-muted">
            {dateLine(date)}
            {status}
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && onDate(e.target.value)}
            aria-label="Jump to date"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <button
          onClick={() => onDate(addDaysISO(date, 1))}
          aria-label="Next day"
          className="flex h-11 w-11 shrink-0 items-center justify-center text-content-muted"
        >
          <Chevron />
        </button>
      </div>
      {/* Today only away from today; the slot keeps its width so
          nothing shifts while the day changes */}
      <div className="flex min-w-[3.25rem] items-center justify-end">
        {date !== today && (
          <button
            onClick={() => onDate(today)}
            aria-label="Back to today"
            className="h-11 px-2 text-sm font-semibold text-accent"
          >
            Today
          </button>
        )}
        {right}
      </div>
    </header>
  );
}

/** A left-slot icon button for `DayHeader`. */
export function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-11 w-11 items-center justify-center text-content-muted"
    >
      {children}
    </button>
  );
}
