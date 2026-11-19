import { describe, expect, it } from "vitest";
import { metricId } from "./Metrics";

describe("metricId", () => {
  it("makes a kebab-case id from the name, transliterating Cyrillic", () => {
    expect(metricId("Body weight", [])).toBe("body-weight");
    expect(metricId("  Push-ups / day!  ", [])).toBe("push-ups-day");
    expect(metricId("Вес утром", [])).toBe("ves-utrom");
    expect(metricId("Café", [])).toBe("cafe");
    expect(metricId("🔥", [])).toBe("metric");
  });

  it("steps around a taken id", () => {
    expect(metricId("Weight", ["weight"])).toBe("weight-2");
    expect(metricId("Weight", ["weight", "weight-2"])).toBe("weight-3");
  });
});
