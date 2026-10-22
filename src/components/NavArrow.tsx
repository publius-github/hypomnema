import Chevron from "./Chevron";

/**
 * The ‹ / › button that steps a view by one period - days on the
 * Dashboard and Days pages, the Journal's day, the Calendar and History
 * month, the Review week. One look everywhere, since it is one
 * function everywhere.
 */
export default function NavArrow({
  dir,
  title,
  onClick,
}: {
  dir: -1 | 1;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      className="btn-ghost flex items-center justify-center px-2 py-0.5 text-sm leading-none"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <Chevron back={dir < 0} />
    </button>
  );
}
