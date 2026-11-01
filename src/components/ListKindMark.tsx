import Icon from "./icons";
import type { List } from "../types";

const TITLE =
  "Checklist: checked items stay until you uncheck them (change the type in the list settings)";

/**
 * Says a list is a checklist, wherever the list is named: a chip with
 * the word where there is room (a column or list-screen header), the
 * icon alone in a dense row (the phone's index, a group tile). A todo
 * list - the default - wears nothing.
 */
export default function ListKindMark({
  list,
  compact = false,
  phone = false,
}: {
  list: List;
  /** the icon without the word */
  compact?: boolean;
  /** the phone's larger type */
  phone?: boolean;
}) {
  if (list.kind !== "checklist") return null;
  if (compact) {
    return (
      <span
        role="img"
        aria-label="Checklist"
        title={TITLE}
        className="shrink-0 text-content-muted"
      >
        <Icon name="checklist" className={phone ? "h-4 w-4" : "h-3 w-3"} />
      </span>
    );
  }
  return (
    <span
      title={TITLE}
      className={`inline-flex shrink-0 items-center gap-1 rounded-sm border border-line text-content-muted ${
        phone ? "px-1.5 py-0.5 text-xs" : "px-1 py-px text-[0.625rem]"
      }`}
    >
      <Icon name="checklist" className={phone ? "h-3.5 w-3.5" : "h-3 w-3"} />
      Checklist
    </span>
  );
}
