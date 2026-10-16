import type { ReactNode } from "react";
import { useAppStore } from "../store";
import {
  categoryChipColor,
  isClosed,
  LIST_GAP_STRIPES,
  listViewPlateStyle,
  tintStyle,
} from "../lib/tasks";
import type { ColumnRow, ColumnSection } from "../hooks/useColumnSections";
import type { AppConfig } from "../types";
import GapFill from "./GapFill";

/** The closed sections, each with its own fold-by-default switch. */
const CLOSED_FOLD: Record<string, keyof AppConfig> = {
  postponed: "fold_postponed",
  waiting: "fold_waiting",
  done: "fold_done",
  dropped: "fold_dropped",
};

/**
 * One column section, shared by the desktop columns and the phone's day
 * and list screens: the break before it, the plate - its cadence /
 * closed-section color, the warn tone for Priority, else the neutral
 * fill, its label bold - grown to `list_view_plate_scale` %, then its
 * rows. A plateless section (a list's backlog) gets only the break.
 *
 * The plate can carry the section's count (`section_plate_count`) and
 * stick to the top of the scrolling column (`section_plate_sticky`); a
 * click on it folds the section to the plate - each closed section
 * starts folded under its own `fold_*` switch.
 */
export default function SectionBlock({
  section,
  children,
}: {
  section: ColumnSection;
  children: ReactNode;
}) {
  const config = useAppStore((s) => s.config);
  const fold = useAppStore((s) => s.sectionFolds[section.key]);
  const setSectionFold = useAppStore((s) => s.setSectionFold);
  const { label, color, tone, stripes, rows } = section;
  const foldKey = CLOSED_FOLD[section.key] ?? null;
  const folded =
    label !== null &&
    (fold ?? (foldKey !== null && config?.[foldKey] === true));
  const closedCount = rows.filter((r) => isClosed(r.task.status)).length;
  const count =
    closedCount > 0 && foldKey === null
      ? `${closedCount}/${rows.length}`
      : `${rows.length}`;

  const plate = label !== null && (
    <div
      className={`${
        config?.section_plate_sticky ? "sticky top-0 z-10 bg-surface-alt" : ""
      }`}
    >
      <button
        type="button"
        className={`flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left font-bold uppercase tracking-wider ${
          tone === "warn"
            ? "bg-warn/15 text-warn"
            : color
              ? ""
              : "bg-line/40 text-content"
        }`}
        style={{
          ...(tone === null && color ? tintStyle(color) : {}),
          ...listViewPlateStyle(config),
        }}
        title={folded ? "Show the section" : "Fold the section"}
        onClick={() => setSectionFold(section.key, !folded)}
      >
        <span>{label}</span>
        {(config?.section_plate_count ?? true) && (
          <span className="font-normal tabular-nums opacity-70">· {count}</span>
        )}
        <span
          className={`h-px flex-1 ${
            tone === "warn" ? "bg-warn/30" : "bg-current opacity-30"
          }`}
        />
        <span className="font-normal opacity-70">{folded ? "▸" : "▾"}</span>
      </button>
    </div>
  );

  return (
    <div className="flex flex-col">
      {stripes > 0 && <GapFill stripes={stripes} />}
      {plate}
      {!folded && children}
    </div>
  );
}

/**
 * What goes ahead of a row inside a section: the category break, and
 * under `category_headers` the block's category
 * named once over its first row.
 */
export function RowLead({ row }: { row: ColumnRow }) {
  const config = useAppStore((s) => s.config);
  const hue = useAppStore((s) =>
    row.header
      ? categoryChipColor(row.header, s.lists, s.config, row.blockIndex)
      : null,
  );
  const headers = config?.category_headers ?? true;
  const bold = config?.category_header_bold ?? true;
  return (
    <>
      {row.gapBefore && (
        <GapFill stripes={LIST_GAP_STRIPES.category} />
      )}
      {headers && row.header && hue && (
        <div
          className={`truncate px-2 pt-1 ${
            bold ? "text-sm font-bold" : "text-xs font-medium"
          }`}
          style={{ color: hue }}
        >
          {row.header}
        </div>
      )}
    </>
  );
}

/**
 * The row's own category chip is redundant when its block header
 * already names it.
 */
export function labelInHeader(
  config: AppConfig | null,
  row: Pick<ColumnRow, "blocks" | "label">,
): boolean {
  return (config?.category_headers ?? true) && row.blocks && row.label !== null;
}
