/**
 * The space between two category blocks in a list-style column, drawn
 * as a light cross-hatch in the line color so the break reads apart
 * from the hairline between two rows. The period is twice the
 * single-direction hatch it replaced, keeping the same ink density.
 */
export default function GapHatch({ height }: { height: number }) {
  return (
    <div
      className="text-line"
      style={{
        height,
        backgroundImage: [
          "repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 12px)",
          "repeating-linear-gradient(-45deg, currentColor 0 1px, transparent 1px 12px)",
        ].join(", "),
      }}
    />
  );
}
