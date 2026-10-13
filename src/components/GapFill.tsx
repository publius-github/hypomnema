import { useAppStore } from "../store";

/**
 * The space between two category blocks (or two sections) in a
 * list-style column, filled with a soft band of color so the break
 * reads apart from the hairline between two rows. The band floats
 * clear of the rows: `gap_fill_inset` % of the gap stays empty above
 * and below it, and it never grows thicker than
 * `gap_fill_max_thickness` px - a tall gap keeps a thin centered band.
 * Its edges do not cut off but fade out to nothing on all four sides,
 * `gap_fill_fade` % of each half of the band being the ramp - the same
 * ramp length vertically and horizontally, so the corners soften
 * evenly. Color: `gap_fill_color`, empty = the border color, at
 * `gap_fill_opacity` %. One look for the Days and Lists list views
 * alike (Settings > Views > List view).
 *
 * `stripes` draws that many bands (1 = category, 2 = section, 3 = the
 * closed sections - see `listGapStripe`), each sized as if it had its
 * own `height / stripes` slot, but the empty space is spread evenly:
 * row-to-band and band-to-band distances are all the same, so a
 * multi-stripe gap reads as one rhythm instead of tight pairs where
 * two slots' paddings would have added up.
 */
export default function GapFill({
  height,
  stripes = 1,
}: {
  height: number;
  stripes?: number;
}) {
  const color = useAppStore((s) => s.config?.gap_fill_color ?? "");
  const fade = useAppStore((s) => s.config?.gap_fill_fade ?? 60);
  const inset = useAppStore((s) => s.config?.gap_fill_inset ?? 25);
  const maxBand = useAppStore((s) => s.config?.gap_fill_max_thickness ?? 6);
  const opacity = useAppStore((s) => s.config?.gap_fill_opacity ?? 100);
  // the inset sets the band for a small slot; past maxBand the band
  // stops growing and the extra height goes to the empty space around
  // it, so a tall gap gets a thin band rather than a smudge
  const slot = height / stripes;
  const band = Math.min(
    maxBand,
    Math.max(0, slot - 2 * Math.round((slot * inset) / 100)),
  );
  const ramp = ((band / 2) * fade) / 100;
  const edgeMask = `linear-gradient(to right, transparent 0, #000 ${ramp}px, #000 calc(100% - ${ramp}px), transparent 100%)`;
  return (
    <div
      className={`flex flex-col justify-evenly ${color ? "" : "text-line"}`}
      style={{
        height,
        color: color || undefined,
        opacity: opacity / 100,
      }}
    >
      {Array.from({ length: stripes }, (_, i) => (
        <div
          key={i}
          style={{
            height: band,
            // top and bottom edges fade in the fill itself...
            backgroundImage: `linear-gradient(to bottom, transparent 0, currentColor ${ramp}px, currentColor calc(100% - ${ramp}px), transparent 100%)`,
            // ...the left and right ones through a mask over the band
            maskImage: edgeMask,
            WebkitMaskImage: edgeMask,
          }}
        />
      ))}
    </div>
  );
}
