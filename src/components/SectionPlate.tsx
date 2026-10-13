import { useAppStore } from "../store";
import { listViewPlateStyle, tintStyle } from "../lib/tasks";
import type { ColumnSection } from "../hooks/useColumnSections";
import GapFill from "./GapFill";

/**
 * The head of a column section, shared by the desktop columns and the
 * phone's day and list screens: the separator stripes before it, then
 * the plate - its cadence / closed-section color, the warn tone for
 * Priority, else the neutral fill - grown to `list_view_plate_scale` %
 * with its label. A plateless section (a list's backlog) gets only the
 * stripes.
 */
export default function SectionPlate({
  section,
}: {
  section: Pick<ColumnSection, "label" | "color" | "tone" | "stripes">;
}) {
  const config = useAppStore((s) => s.config);
  const { label, color, tone, stripes } = section;
  return (
    <>
      {stripes > 0 && <GapFill stripes={stripes} />}
      {label !== null && (
        <div
          className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
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
        >
          <span>{label}</span>
          <span
            className={`h-px flex-1 ${
              tone === "warn" ? "bg-warn/30" : "bg-current opacity-30"
            }`}
          />
        </div>
      )}
    </>
  );
}
