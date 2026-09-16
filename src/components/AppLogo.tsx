import { useId } from "react";

// Nested contour widths of the H, widest first: each layer strokes the
// whole skeleton, light and tile-colored in turn, so the lines wrap the
// junctions like a meander. Same geometry as src-tauri/icons/icon.svg.
const LAYERS = [200, 120, 40];
const SKELETON = "M322 330V694M702 330V694M322 512H702";

/** The app mark: the meander H on a slate tile. */
export default function AppLogo({ size = 64 }: { size?: number }) {
  const tile = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      role="img"
      aria-label="Hypomnema logo"
    >
      <defs>
        <linearGradient
          id={tile}
          x1="0"
          y1="0"
          x2="0"
          y2="1024"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#565C66" />
          <stop offset="1" stopColor="#2C3036" />
        </linearGradient>
      </defs>
      <rect x="48" y="48" width="928" height="928" rx="208" fill={`url(#${tile})`} />
      <rect
        x="59"
        y="59"
        width="906"
        height="906"
        rx="197"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.55"
        strokeWidth="22"
      />
      <g fill="none" strokeLinecap="square" strokeLinejoin="miter">
        {LAYERS.map((width, i) => (
          <path
            key={width}
            d={SKELETON}
            stroke={i % 2 === 0 ? "#FFFFFF" : `url(#${tile})`}
            strokeWidth={width}
          />
        ))}
      </g>
    </svg>
  );
}
