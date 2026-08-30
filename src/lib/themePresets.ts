import type { AppConfig } from "../types";

/** The six chrome tokens a theme preset overrides (hex). */
export interface ThemeColors {
  surface: string;
  surfaceAlt: string;
  content: string;
  contentMuted: string;
  accent: string;
  line: string;
}

export const THEME_TOKEN_VARS: Record<keyof ThemeColors, string> = {
  surface: "--color-surface",
  surfaceAlt: "--color-surface-alt",
  content: "--color-content",
  contentMuted: "--color-content-muted",
  accent: "--color-accent",
  line: "--color-line",
};

// Named presets besides "default" (the stylesheet palette). Each preset
// carries a dark and a light variant; the active theme picks its side.
const PRESETS: Record<string, { dark: ThemeColors; light: ThemeColors }> = {
  black: {
    // OLED-flat dark; the light side is a plain high-contrast white
    dark: {
      surface: "#000000",
      surfaceAlt: "#101013",
      content: "#e6e9ee",
      contentMuted: "#9aa2ae",
      accent: "#6091ff",
      line: "#26282e",
    },
    light: {
      surface: "#ffffff",
      surfaceAlt: "#fafafa",
      content: "#111318",
      contentMuted: "#5a626e",
      accent: "#2563eb",
      line: "#e5e7eb",
    },
  },
  vscode: {
    // VS Code Dark+ / Light+ chrome (editor background, side bar,
    // borders and the classic blue accent)
    dark: {
      surface: "#1e1e1e",
      surfaceAlt: "#252526",
      content: "#d4d4d4",
      contentMuted: "#8c8c8c",
      accent: "#3794ff",
      line: "#3c3c3c",
    },
    light: {
      surface: "#ffffff",
      surfaceAlt: "#f3f3f3",
      content: "#333333",
      contentMuted: "#6f6f6f",
      accent: "#005fb8",
      line: "#e0e0e0",
    },
  },
  nord: {
    dark: {
      surface: "#2e3440",
      surfaceAlt: "#3b4252",
      content: "#d8dee9",
      contentMuted: "#94a0b8",
      accent: "#88c0d0",
      line: "#434c5e",
    },
    light: {
      surface: "#eceff4",
      surfaceAlt: "#e5e9f0",
      content: "#2e3440",
      contentMuted: "#4c566a",
      accent: "#5e81ac",
      line: "#d8dee9",
    },
  },
  gruvbox: {
    dark: {
      surface: "#282828",
      surfaceAlt: "#3c3836",
      content: "#ebdbb2",
      contentMuted: "#a89984",
      accent: "#83a598",
      line: "#504945",
    },
    light: {
      surface: "#fbf1c7",
      surfaceAlt: "#f2e5bc",
      content: "#3c3836",
      contentMuted: "#665c54",
      accent: "#076678",
      line: "#d5c4a1",
    },
  },
  solarized: {
    dark: {
      surface: "#002b36",
      surfaceAlt: "#073642",
      content: "#93a1a1",
      contentMuted: "#657b83",
      accent: "#268bd2",
      line: "#0e4956",
    },
    light: {
      surface: "#fdf6e3",
      surfaceAlt: "#eee8d5",
      content: "#073642",
      contentMuted: "#586e75",
      accent: "#268bd2",
      line: "#d3cbb2",
    },
  },
};

export const THEME_PRESET_LABELS: Record<string, string> = {
  default: "Default",
  black: "Black / White",
  vscode: "VS Code",
  nord: "Nord",
  gruvbox: "Gruvbox",
  solarized: "Solarized",
};

/**
 * The chrome colors a config resolves to, or null when the stylesheet
 * per-theme defaults should stay in effect (the "default" preset).
 */
export function resolveThemeColors(config: AppConfig): ThemeColors | null {
  const preset = PRESETS[config.theme_preset];
  if (!preset) return null;
  return config.theme === "light" ? preset.light : preset.dark;
}
