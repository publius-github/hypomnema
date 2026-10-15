import type { AppConfig } from "../types";

/**
 * Theme-adaptive object colors. Every object color (cadence plates and
 * stripes, chips, status marks, the header and marker tones) is one hex
 * for both themes; a hex tuned for dark panels is unreadable on light
 * ones and the other way round. `readable` keeps the hue and chroma and
 * moves only the OKLCH lightness - lighter on a dark theme, darker on a
 * light one - just far enough to reach `color_min_contrast` against the
 * panels. A color that already reads is returned untouched, so a picked
 * color stays the picked color wherever it works.
 */

/** Alpha of the tint behind colored text (plates, chips) - `26` hex. */
const TINT_ALPHA = 0x26 / 255;
/** WCAG 1.4.11: a non-text mark needs 3:1, never more. */
const MARK_CONTRAST = 3;

type Rgb = [number, number, number];

interface ColorContext {
  /** the backgrounds an object color must read on (page and panel) */
  backgrounds: Rgb[];
  /** lighten (dark theme) or darken (light theme) */
  lighten: boolean;
  /** contrast floor for text; 0 = adapt nothing */
  floor: number;
}

// the stylesheet's VS Code Dark+ / Light+ surfaces (src/styles.css)
const THEME_SURFACES = {
  dark: ["#1e1e1e", "#252526"],
  light: ["#ffffff", "#f3f3f3"],
} as const;

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as Rgb;
}

function toHex(rgb: Rgb): string {
  return (
    "#" +
    rgb
      .map((v) =>
        Math.round(Math.min(1, Math.max(0, v)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

const toLinear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const fromLinear = (v: number) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function toOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab -> sRGB, or null when the color falls outside the gamut. */
function fromOklab([L, a, b]: Rgb): Rgb | null {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (lin.some((v) => v < -1e-4 || v > 1 + 1e-4)) return null;
  return lin.map((v) => fromLinear(Math.min(1, Math.max(0, v)))) as Rgb;
}

/** Lightness `L` at the color's hue, chroma cut back into the gamut. */
function atLightness(lab: Rgb, L: number): Rgb {
  const chroma = Math.hypot(lab[1], lab[2]);
  for (let k = 1; k >= 0; k -= 0.02) {
    const scale = chroma > 0 ? k : 0;
    const rgb = fromOklab([L, lab[1] * scale, lab[2] * scale]);
    if (rgb) return rgb;
  }
  return fromOklab([L, 0, 0]) ?? [L, L, L];
}

function blend(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return bg.map((v, i) => v + (fg[i] - v) * alpha) as Rgb;
}

/** The worst contrast of `rgb` over every background (optionally on its
 *  own tint laid over that background). */
function worstContrast(rgb: Rgb, tinted: boolean): number {
  return Math.min(
    ...context.backgrounds.map((bg) =>
      contrast(rgb, tinted ? blend(rgb, bg, TINT_ALPHA) : bg),
    ),
  );
}

function contextFor(config: AppConfig | null): ColorContext {
  const dark = config?.theme !== "light";
  const defaults = THEME_SURFACES[dark ? "dark" : "light"];
  const backgrounds = [
    parseHex(config?.surface_color ?? "") ?? parseHex(defaults[0])!,
    parseHex(config?.surface_alt_color ?? "") ?? parseHex(defaults[1])!,
  ];
  const darkest = Math.min(...backgrounds.map(luminance));
  return {
    backgrounds,
    // the surfaces decide, not the theme name: a light override on the
    // dark theme still wants darker text
    lighten: darkest < 0.18,
    floor: (config?.color_min_contrast ?? 45) / 10,
  };
}

// below the helpers: contextFor needs them initialized
let context: ColorContext = contextFor(null);
const cache = new Map<string, string>();

/** Called with every config change (store `applyTheme`), before render. */
export function setColorContext(config: AppConfig | null) {
  context = contextFor(config);
  cache.clear();
}

/**
 * `hex` moved just far enough in lightness to read on the current
 * theme: `tint` (text on its own tint - plates and chips) and `text`
 * (plain text on the panel) to the contrast floor, `mark` (stripes,
 * dots, checkbox fills) to 3:1 at most. Anything
 * that is not a #rrggbb color, and everything while the floor is off,
 * comes back as given.
 */
export function readable(
  hex: string,
  kind: "tint" | "text" | "mark" = "tint",
): string {
  if (context.floor < 1) return hex;
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const key = `${kind}${hex}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const target =
    kind === "mark" ? Math.min(context.floor, MARK_CONTRAST) : context.floor;
  const tinted = kind === "tint";
  let result = hex;
  if (worstContrast(rgb, tinted) < target) {
    const lab = toOklab(rgb);
    // binary search the smallest lightness step that reaches the target;
    // the far end (white / black) is the best this hue can do
    let lo = lab[0];
    let hi = context.lighten ? 1 : 0;
    let best = atLightness(lab, hi);
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const candidate = atLightness(lab, mid);
      if (worstContrast(candidate, tinted) >= target) {
        best = candidate;
        hi = mid;
      } else {
        lo = mid;
      }
    }
    result = toHex(best);
  }
  cache.set(key, result);
  return result;
}
