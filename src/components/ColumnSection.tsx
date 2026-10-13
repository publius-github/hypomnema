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

/** The closed sections `closed_sections_collapsed` folds by default. */
const CLOSED_KEYS = ["postponed", "waiting", "done"];

/**
 * The color a section is marked with: its plate tint, the warn tone for
 * Priority, else the border color - the rail of a section panel, and
 * the stripe color its rows can leave to the rail.
 */
export function sectionColor(section: Pick<ColumnSection, "color" | "tone">) {
  if (section.tone === "warn") return "rgb(var(--color-warn))";
  return section.color ?? "rgb(var(--color-line))";
}

/**
 * One column section, shared by the desktop columns and the phone's day
 * and list screens: the break before it, the plate - its cadence /
 * closed-section color, the warn tone for Priority, else the neutral
 * fill - grown to `list_view_plate_scale` %, then its rows. A
 * plateless section (a list's backlog) gets only the break.
 *
 * With `section_cards` the section is a framed panel with one rail in
 * its color down the left edge, and the break before it is plain space
 * (`section_gap`) instead of separator stripes. The plate can carry the
 * section's count (`section_plate_count`) and stick to the top of the
 * scrolling column (`section_plate_sticky`); a click on it folds the
 * section to the plate - closed sections start folded under
 * `closed_sections_collapsed`.
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
  const cards = config?.section_cards ?? true;
  const folded =
    label !== null &&
    (fold ??
      ((config?.closed_sections_collapsed ?? true) &&
        CLOSED_KEYS.includes(section.key)));
  const closedCount = rows.filter((r) => isClosed(r.task.status)).length;
  const count =
    closedCount > 0 && !CLOSED_KEYS.includes(section.key)
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
        className={`flex w-full items-center gap-1.5 px-1.5 py-0.5 text-left font-semibold uppercase tracking-wider ${
          cards ? "" : "rounded"
        } ${
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

  if (!cards) {
    return (
      <div className="flex flex-col">
        {stripes > 0 && <GapFill stripes={stripes} />}
        {plate}
        {!folded && children}
      </div>
    );
  }
  return (
    <div
      className="flex flex-col overflow-clip rounded-md border border-line/70"
      style={{
        marginTop: stripes > 0 ? (config?.section_gap ?? 16) : 0,
        borderLeft: `3px solid ${sectionColor(section)}`,
      }}
    >
      {plate}
      {!folded && children}
    </div>
  );
}

/**
 * What goes ahead of a row inside a section: the category break (the
 * gap band, or empty space without `category_gap_bands` under
 * `section_cards`), and under `category_headers` the block's category
 * named once over its first row.
 */
export function RowLead({ row }: { row: ColumnRow }) {
  const config = useAppStore((s) => s.config);
  const hue = useAppStore((s) =>
    row.header
      ? categoryChipColor(row.header, s.lists, s.config, row.blockIndex)
      : null,
  );
  const cards = config?.section_cards ?? true;
  const bands = !cards || (config?.category_gap_bands ?? false);
  const headers = config?.category_headers ?? true;
  return (
    <>
      {row.gapBefore && (
        <GapFill stripes={LIST_GAP_STRIPES.category} bands={bands} />
      )}
      {headers && row.header && hue && (
        <div
          className="truncate px-2 pt-1 text-xs font-semibold"
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

/** The rail a section panel draws, or null outside `section_cards`. */
export function railColor(
  config: AppConfig | null,
  section: Pick<ColumnSection, "color" | "tone">,
): string | null {
  return (config?.section_cards ?? true) ? sectionColor(section) : null;
}
