import { describe, expect, it } from "vitest";
import { maskDigits } from "./dateFields";

describe("maskDigits", () => {
  it("appends the hyphen the moment a segment completes while typing", () => {
    expect(maskDigits("202", [4, 2, 2], true)).toBe("202");
    expect(maskDigits("2026", [4, 2, 2], true)).toBe("2026-");
    expect(maskDigits("20260", [4, 2, 2], true)).toBe("2026-0");
    expect(maskDigits("202608", [4, 2, 2], true)).toBe("2026-08-");
    expect(maskDigits("20260830", [4, 2, 2], true)).toBe("2026-08-30");
  });

  it("does not re-append the hyphen while deleting", () => {
    expect(maskDigits("2026", [4, 2, 2], false)).toBe("2026");
    expect(maskDigits("08", [2, 2], false)).toBe("08");
  });

  it("masks MM-DD the same way", () => {
    expect(maskDigits("08", [2, 2], true)).toBe("08-");
    expect(maskDigits("083", [2, 2], true)).toBe("08-3");
    expect(maskDigits("0830", [2, 2], true)).toBe("08-30");
  });
});
