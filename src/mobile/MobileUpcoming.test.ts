import { describe, expect, it } from "vitest";
import { orderByCalendar } from "./MobileUpcoming";
import type { RecurringRuleView } from "../types";

const rule = (
  schedule: string,
  next_occurrence: string | null,
): RecurringRuleView => ({
  schedule,
  description: "",
  items: ["x"],
  threshold: null,
  source: "recurring.yml",
  next_occurrence,
});

describe("orderByCalendar", () => {
  it("orders by the firing's place in the year, broken rules last, and keeps file indexes", () => {
    const rows = orderByCalendar([
      rule("0 9 1 11 *", "2026-11-01 09:00"),
      rule("not cron", null),
      rule("0 9 15 3 *", "2027-03-15 09:00"),
      rule("0 8 * * *", "2026-10-21 08:00"),
      rule("0 9 * * 1", "2026-10-26 09:00"),
    ]);
    expect(rows.map((r) => r.index)).toEqual([2, 3, 4, 0, 1]);
  });
});
