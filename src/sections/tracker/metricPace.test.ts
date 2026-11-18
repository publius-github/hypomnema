import { describe, expect, it } from "vitest";
import { goalDate, pace } from "./Metrics";
import type { MetricSeries } from "../../types";

const series = (points: [string, number | null, number | null][]): MetricSeries => ({
  metric: "weight",
  start: points[0][0],
  end: points[points.length - 1][0],
  points: points.map(([date, value, avg]) => ({ date, value, avg })),
});

describe("pace", () => {
  it("runs from the line's first point to its last, per week", () => {
    const s = series([
      ["2026-11-01", 102, 102],
      ["2026-11-05", 103.3, 101],
      ["2026-11-08", 100, 101.3],
    ]);
    // the mean line: 102 -> 101.3 over 7 days
    expect(pace(s, true)?.rate).toBeCloseTo(-0.7);
    // the values: 102 -> 100 over 7 days
    expect(pace(s, false)?.rate).toBeCloseTo(-2);
  });

  it("needs its ends three days apart and skips periods with nothing measured", () => {
    expect(pace(series([["2026-11-01", 1, 1], ["2026-11-03", 2, 2]]), false)).toBeNull();
    const weeks = series([
      ["2026-10-05", 90, null],
      ["2026-10-12", null, null],
      ["2026-10-19", 89, null],
    ]);
    expect(pace(weeks, false)?.rate).toBeCloseTo(-0.5);
  });
});

describe("goalDate", () => {
  it("projects the pace onto the goal", () => {
    expect(goalDate("2026-11-18", 101, 90, -1)).toBe("2027-02-03");
  });
  it("gives none moving away, standing still or past two years", () => {
    expect(goalDate("2026-11-18", 101, 90, 0.5)).toBeNull();
    expect(goalDate("2026-11-18", 101, 90, 0)).toBeNull();
    expect(goalDate("2026-11-18", 101, 90, -0.05)).toBeNull();
  });
});
