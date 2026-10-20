import { describe, expect, it } from "vitest";
import { passLabel } from "./sync";

describe("passLabel", () => {
  const now = new Date("2026-10-20T15:00:00");

  it("is a time for a pass today and a date for an older one", () => {
    expect(passLabel("2026-10-20T12:40:00", now)).toBe("12:40");
    expect(passLabel("2026-10-20T15:05:00", now)).toBe("15:05");
    expect(passLabel("2026-10-14T12:40:00", now)).toMatch(/14/);
    expect(passLabel("2026-10-14T12:40:00", now)).not.toMatch(/12:40/);
  });

  it("says never without a pass", () => {
    expect(passLabel(null, now)).toBe("never");
    expect(passLabel("garbage", now)).toBe("never");
  });
});
