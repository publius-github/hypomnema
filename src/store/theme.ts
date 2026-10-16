import type { AppConfig } from "../types";
import { readable, setColorContext } from "../lib/color";

/** "#a1b2c3" -> "161 178 195" (the space-separated form the theme
 *  tokens use, so opacity modifiers keep working). */
function hexToTriplet(hex: string): string | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  return [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16))
    .join(" ");
}

/** The chrome tokens Settings > Appearance can override, by config key. */
const THEME_OVERRIDES = [
  ["--rgb-surface", "surface_color"],
  ["--rgb-surface-alt", "surface_alt_color"],
  ["--rgb-content", "content_color"],
  ["--rgb-content-muted", "content_muted_color"],
  ["--rgb-accent", "accent_color"],
  ["--rgb-line", "line_color"],
] as const;

export function applyTheme(config: AppConfig | null) {
  setColorContext(config);
  const root = document.documentElement;
  root.classList.toggle("dark", config?.theme !== "light");
  // fonts are config-driven: the UI font overrides the stylesheet
  // default, the editor font feeds CodeMirror through a CSS variable
  const ui = config?.ui_font.trim() ?? "";
  document.body.style.fontFamily = ui
    ? `"${ui}", system-ui, -apple-system, "Segoe UI", sans-serif`
    : "";
  const editor = config?.editor_font.trim() || "Consolas";
  root.style.setProperty(
    "--editor-font",
    `"${editor}", ui-monospace, SFMono-Regular, Consolas, monospace`,
  );
  // the editor size setting lives on the same scale as ui_font_size:
  // the app's main text is text-sm (87.5% of the base), so the editor
  // applies the same factor - equal settings, equal visible size
  root.style.setProperty(
    "--editor-font-size",
    `${(config?.editor_font_size ?? 16) * 0.875}px`,
  );
  // every text size derives from the root font size (rem-based tokens)
  const size = config?.ui_font_size ?? 16;
  root.style.fontSize = size === 16 ? "" : `${size}px`;
  // chrome palette: the stylesheet's VS Code Dark+/Light+ colors, with
  // the individual overrides on top; empty value = stylesheet
  for (const [name, key] of THEME_OVERRIDES) {
    const triplet = hexToTriplet(config?.[key] ?? "");
    if (triplet) root.style.setProperty(name, triplet);
    else root.style.removeProperty(name);
  }
  // done checkboxes (cards, subtasks, calendar status marks)
  if (config?.done_color) {
    root.style.setProperty("--hex-done", readable(config.done_color, "mark"));
  } else root.style.removeProperty("--hex-done");
  if (config?.waiting_color) {
    root.style.setProperty(
      "--hex-waiting",
      readable(config.waiting_color, "mark"),
    );
  } else root.style.removeProperty("--hex-waiting");
  if (config?.dropped_color) {
    root.style.setProperty(
      "--hex-dropped",
      readable(config.dropped_color, "mark"),
    );
  } else root.style.removeProperty("--hex-dropped");
}
