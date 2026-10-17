// The H cut out of two interlocking brackets on a 5x5 grid of 112px cells,
// plus the folded page corner. Same geometry as src-tauri/icons/icon.svg.
const MARK = [
  "M344 232H792V680H680V344H568V456H456V344H344Z",
  "M232 344H344V680H456V568H568V680H680V792H232Z",
  "M710 710H762L710 762Z",
];

/** The app mark: the dog-eared H on a paper-white tile. */
export default function AppLogo({ size = 64 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      role="img"
      aria-label="Hypomnema logo"
    >
      <rect x="48" y="48" width="928" height="928" rx="208" fill="#FFFFFF" />
      <rect
        x="54"
        y="54"
        width="916"
        height="916"
        rx="202"
        fill="none"
        stroke="#000000"
        strokeOpacity="0.14"
        strokeWidth="12"
      />
      <g fill="#111111">
        {MARK.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}
