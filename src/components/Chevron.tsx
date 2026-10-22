/**
 * A drawn ‹ / › for the period arrows. The glyphs sit on the font's
 * baseline with its side bearings, so in a button they never land in
 * the middle; the stroke does, and its 1em box follows the button's
 * font size like the glyph did.
 */
export default function Chevron({ back = false }: { back?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={back ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}
