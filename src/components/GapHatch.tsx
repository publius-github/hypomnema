import { useAppStore } from "../store";

/**
 * The space between two category blocks in a list-style column, drawn
 * as a light cross-hatch so the break reads apart from the hairline
 * between two rows. Its look is shared by the Days and Lists list views
 * (Settings > Views > List view): `gap_hatch_color` (empty = the border
 * color), `gap_hatch_spacing` (px between two parallel lines) and
 * `gap_hatch_inset` (% of the gap left empty above and below, so the
 * hatch does not touch the rows' hairlines).
 */
export default function GapHatch({ height }: { height: number }) {
  const color = useAppStore((s) => s.config?.gap_hatch_color ?? "");
  const spacing = useAppStore((s) => s.config?.gap_hatch_spacing ?? 12);
  const inset = useAppStore((s) => s.config?.gap_hatch_inset ?? 25);
  const pad = Math.round((height * inset) / 100);
  return (
    <div
      className={color ? undefined : "text-line"}
      style={{
        height,
        paddingTop: pad,
        paddingBottom: pad,
        color: color || undefined,
        // paint only the content box: the padding stays empty
        backgroundClip: "content-box",
        backgroundOrigin: "content-box",
        backgroundImage: [
          `repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px ${spacing}px)`,
          `repeating-linear-gradient(-45deg, currentColor 0 1px, transparent 1px ${spacing}px)`,
        ].join(", "),
      }}
    />
  );
}
