import { describe, expect, it } from "vitest";
import { formatTableBlock, isTableLine } from "./markdownTable";

describe("formatTableBlock", () => {
  it("pads every column to the widest cell across all rows", () => {
    const out = formatTableBlock([
      "| Author | Title | Year |",
      "|---|---|---|",
      "| Эмиль Золя | Тереза Ракен | 1867 |",
      "| Алексис Киви | Семеро братьев | 1870 |",
    ]);
    expect(out).toEqual([
      "| Author       | Title          | Year |",
      "| ------------ | -------------- | ---- |",
      "| Эмиль Золя   | Тереза Ракен   | 1867 |",
      "| Алексис Киви | Семеро братьев | 1870 |",
    ]);
    // every formatted line ends up the same visual width
    const widths = new Set(out.map((l) => [...l].length));
    expect(widths.size).toBe(1);
  });

  it("realigns a table whose rows were padded inconsistently", () => {
    const messy = [
      "| Эмиль Золя                 | Тереза Ракен                                   | 1867      |",
      "| Алексис Киви               | Семеро братьев                                   | 1870      |",
    ];
    const out = formatTableBlock(messy);
    expect(out).toEqual([
      "| Эмиль Золя   | Тереза Ракен   | 1867 |",
      "| Алексис Киви | Семеро братьев | 1870 |",
    ]);
  });

  it("keeps separator alignment colons and counts code points", () => {
    const out = formatTableBlock([
      "| a | b |",
      "|:---|--:|",
      "| 𝕏 longer | y |",
    ]);
    expect(out).toEqual([
      "| a        | b   |",
      "| :------- | --: |",
      "| 𝕏 longer | y   |",
    ]);
  });

  it("detects table lines", () => {
    expect(isTableLine("| a |")).toBe(true);
    expect(isTableLine("  | a |")).toBe(true);
    expect(isTableLine("plain text")).toBe(false);
  });
});
