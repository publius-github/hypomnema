import type { AppConfig } from "../types";

/** The seven markdown token colors driven by the --md-* CSS vars. */
export interface MdColors {
  heading: string;
  bold: string;
  italic: string;
  code: string;
  link: string;
  quote: string;
  marker: string;
}

export const MD_TOKENS: { key: keyof MdColors; label: string }[] = [
  { key: "heading", label: "Headings" },
  { key: "bold", label: "Bold" },
  { key: "italic", label: "Italic" },
  { key: "code", label: "Inline code" },
  { key: "link", label: "Links / checkboxes" },
  { key: "quote", label: "Quotes / comments" },
  { key: "marker", label: "List markers / syntax" },
];

// Named presets besides "vscode" (which is the per-theme stylesheet
// default from dark_vs.json / light_vs.json) and "custom" (the
// md_color_* config values). Monokai and One Dark are dark-native
// palettes and apply the same set on both themes; GitHub has real
// light and dark variants.
const PRESETS: Record<string, { dark: MdColors; light: MdColors }> = {
  monokai: {
    dark: {
      heading: "#a6e22e",
      bold: "#f92672",
      italic: "#fd971f",
      code: "#e6db74",
      link: "#66d9ef",
      quote: "#75715e",
      marker: "#f92672",
    },
    light: {
      heading: "#a6e22e",
      bold: "#f92672",
      italic: "#fd971f",
      code: "#e6db74",
      link: "#66d9ef",
      quote: "#75715e",
      marker: "#f92672",
    },
  },
  "one-dark": {
    dark: {
      heading: "#e06c75",
      bold: "#d19a66",
      italic: "#c678dd",
      code: "#98c379",
      link: "#61afef",
      quote: "#5c6370",
      marker: "#56b6c2",
    },
    light: {
      heading: "#e06c75",
      bold: "#d19a66",
      italic: "#c678dd",
      code: "#98c379",
      link: "#61afef",
      quote: "#5c6370",
      marker: "#56b6c2",
    },
  },
  github: {
    dark: {
      heading: "#79c0ff",
      bold: "#79c0ff",
      italic: "#d2a8ff",
      code: "#a5d6ff",
      link: "#a5d6ff",
      quote: "#8b949e",
      marker: "#ff7b72",
    },
    light: {
      heading: "#0550ae",
      bold: "#0550ae",
      italic: "#8250df",
      code: "#0a3069",
      link: "#0a3069",
      quote: "#57606a",
      marker: "#cf222e",
    },
  },
};

export const MD_PRESET_LABELS: Record<string, string> = {
  vscode: "VS Code (Dark+/Light+)",
  monokai: "Monokai",
  "one-dark": "One Dark",
  github: "GitHub",
  custom: "Custom",
};

/**
 * The markdown colors a config resolves to, or null when the stylesheet
 * per-theme defaults should stay in effect (the "vscode" preset).
 */
export function resolveMdColors(config: AppConfig): MdColors | null {
  if (config.md_preset === "custom") {
    return {
      heading: config.md_color_heading,
      bold: config.md_color_bold,
      italic: config.md_color_italic,
      code: config.md_color_code,
      link: config.md_color_link,
      quote: config.md_color_quote,
      marker: config.md_color_marker,
    };
  }
  const preset = PRESETS[config.md_preset];
  if (!preset) return null;
  return config.theme === "light" ? preset.light : preset.dark;
}
