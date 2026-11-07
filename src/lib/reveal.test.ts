import { describe, expect, it } from "vitest";

import { revealRange } from "./reveal";

describe("revealRange", () => {
  const text = "alpha\nBeta gamma\nbeta again";

  it("finds the match on the reported line, case-insensitive", () => {
    expect(revealRange(text, "beta", 3)).toEqual({ from: 17, to: 21 });
    expect(revealRange(text, "BETA", 2)).toEqual({ from: 6, to: 10 });
  });

  it("falls back to the first match when the line moved", () => {
    expect(revealRange(text, "alpha", 3)).toEqual({ from: 0, to: 5 });
    expect(revealRange(text, "gamma", 40)).toEqual({ from: 11, to: 16 });
  });

  it("matches Cyrillic and regex characters literally", () => {
    expect(revealRange("x\nПривет (мир)", "привет (МИР)", 2)).toEqual({
      from: 2,
      to: 14,
    });
  });

  it("gives null for a query not in the text", () => {
    expect(revealRange(text, "delta", 1)).toBeNull();
    expect(revealRange(text, "  ", 1)).toBeNull();
  });
});
