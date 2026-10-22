import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../test/fixtures";
import { contrast, readable, setColorContext, themeColors } from "./color";

const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];

describe("readable", () => {
  afterEach(() => setColorContext(defaultConfig));

  it("lifts a dark color on the dark theme to the floor", () => {
    setColorContext({ ...defaultConfig, theme: "dark" });
    const out = readable("#1e3a8a", "text");
    expect(out).not.toBe("#1e3a8a");
    expect(contrast(rgb(out), rgb("#252526"))).toBeGreaterThanOrEqual(4.4);
    // lighter, same hue family (blue stays the dominant channel)
    const [r, g, b] = rgb(out);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it("darkens a pastel on the light theme", () => {
    setColorContext({ ...defaultConfig, theme: "light" });
    const out = readable("#c2ffce", "text");
    expect(contrast(rgb(out), rgb("#f3f3f3"))).toBeGreaterThanOrEqual(4.4);
    expect(contrast(rgb(out), rgb("#ffffff"))).toBeGreaterThanOrEqual(4.4);
  });

  it("leaves a color that already reads untouched", () => {
    setColorContext({ ...defaultConfig, theme: "dark" });
    expect(readable("#c2ffce", "text")).toBe("#c2ffce");
  });

  it("asks marks for 3:1 only", () => {
    setColorContext({ ...defaultConfig, theme: "light" });
    const mark = readable("#a3e635", "mark");
    const text = readable("#a3e635", "text");
    expect(contrast(rgb(mark), rgb("#f3f3f3"))).toBeGreaterThanOrEqual(2.95);
    expect(contrast(rgb(mark), rgb("#f3f3f3"))).toBeLessThan(
      contrast(rgb(text), rgb("#f3f3f3")),
    );
  });

  it("does nothing when the floor is off", () => {
    setColorContext({ ...defaultConfig, theme: "light", color_min_contrast: 0 });
    expect(readable("#c2ffce", "text")).toBe("#c2ffce");
  });

  it("passes non-hex values through", () => {
    expect(readable("rgb(var(--rgb-line))", "mark")).toBe(
      "rgb(var(--rgb-line))",
    );
  });

  it("reads the overridden surfaces, not only the theme name", () => {
    // a light panel override on the dark theme wants darker text
    setColorContext({
      ...defaultConfig,
      theme: "dark",
      dark: {
        ...defaultConfig.dark,
        surface_color: "#fafafa",
        surface_alt_color: "#f0f0f0",
      },
    });
    const out = readable("#fde68a", "text");
    expect(contrast(rgb(out), rgb("#f0f0f0"))).toBeGreaterThanOrEqual(4.4);
  });
});

describe("themeColors", () => {
  it("gives each theme its own set", () => {
    expect(themeColors({ ...defaultConfig, theme: "dark" })).toBe(
      defaultConfig.dark,
    );
    expect(themeColors({ ...defaultConfig, theme: "light" })).toBe(
      defaultConfig.light,
    );
    expect(themeColors(null)).toBeUndefined();
  });
});
