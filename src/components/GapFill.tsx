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
 * `gap_fill_opacity` %. One look for the Days and Lists list views alike (Settings >
 * Views > List view).
 */
export default function GapFill({ height }: { height: number }) {
  const color = useAppStore((s) => s.config?.gap_fill_color ?? "");
  const fade = useAppStore((s) => s.config?.gap_fill_fade ?? 60);
  const inset = useAppStore((s) => s.config?.gap_fill_inset ?? 25);
  const maxBand = useAppStore((s) => s.config?.gap_fill_max_thickness ?? 6);
  const opacity = useAppStore((s) => s.config?.gap_fill_opacity ?? 100);
  // the inset sets the band for a small gap; past maxBand the band
  // stops growing and the extra height goes to the empty space around
  // it, so a tall gap gets a thin centered band rather than a smudge
  const band = Math.min(
    maxBand,
    Math.max(0, height - 2 * Math.round((height * inset) / 100)),
  );
  const pad = (height - band) / 2;
  const ramp = ((band / 2) * fade) / 100;
  const edgeMask = `linear-gradient(to right, transparent 0, #000 ${ramp}px, #000 calc(100% - ${ramp}px), transparent 100%)`;
  return (
    <div
      className={color ? undefined : "text-line"}
      style={{
        height,
        paddingTop: pad,
        paddingBottom: pad,
        color: color || undefined,
        opacity: opacity / 100,
        // paint only the content box: the padding stays empty
        backgroundClip: "content-box",
        backgroundOrigin: "content-box",
        // top and bottom edges fade in the fill itself...
        backgroundImage: `linear-gradient(to bottom, transparent 0, currentColor ${ramp}px, currentColor calc(100% - ${ramp}px), transparent 100%)`,
        // ...the left and right ones through a mask over the whole box
        maskImage: edgeMask,
        WebkitMaskImage: edgeMask,
      }}
    />
  );
}
