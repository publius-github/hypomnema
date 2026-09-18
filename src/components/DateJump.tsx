import { useAppStore } from "../store";
import { addDaysISO, daysBetweenISO } from "../lib/tasks";

/**
 * Date picker in the grid header (Dashboard and Days): picking a date
 * jumps the grid so that date becomes the first visible column, past or
 * future. Its value always mirrors the current first column.
 */
export default function DateJump() {
  const today = useAppStore((s) => s.today);
  const gridOffset = useAppStore((s) => s.gridOffset);
  const setGridOffset = useAppStore((s) => s.setGridOffset);

  return (
    <input
      type="date"
      className="input px-1.5 py-0.5 text-xs"
      title="Jump to a date"
      min="1970-01-01"
      max="9999-12-31"
      value={addDaysISO(today, gridOffset)}
      onChange={(e) => {
        // typing a year fires onChange on every partial value
        // (0002-, 0020-, 0202-); each one would start a snapshot fetch
        const v = e.target.value;
        if (v && Number(v.slice(0, 4)) >= 1970) {
          setGridOffset(daysBetweenISO(today, v));
        }
      }}
    />
  );
}
