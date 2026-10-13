import { describe, expect, it } from "vitest";
import { customizedCount, isGroupCustomized } from "./settingsGroups";
import type { AppConfig } from "../types";

// only the fields the tests touch matter; the helpers never enumerate
// AppConfig themselves
const base = {
  theme: "dark",
  accent_color: "",
  grid_columns: 7,
  list_task_lines: 6,
  cadence_group_order: ["exact", "general", "daily"],
} as unknown as AppConfig;

const clone = (patch: Partial<AppConfig>): AppConfig =>
  ({ ...base, ...patch }) as AppConfig;

describe("isGroupCustomized", () => {
  it("is false when every field sits at its default", () => {
    expect(
      isGroupCustomized(clone({}), base, ["theme", "accent_color"]),
    ).toBe(false);
  });

  it("detects a scalar change", () => {
    expect(
      isGroupCustomized(clone({ grid_columns: 5 }), base, [
        "theme",
        "grid_columns",
      ]),
    ).toBe(true);
  });

  it("treats an empty color override as the default", () => {
    expect(isGroupCustomized(clone({}), base, ["accent_color"])).toBe(false);
    expect(
      isGroupCustomized(clone({ accent_color: "#112233" }), base, [
        "accent_color",
      ]),
    ).toBe(true);
  });

  it("compares array fields element-wise", () => {
    expect(
      isGroupCustomized(
        clone({ cadence_group_order: ["exact", "general", "daily"] }),
        base,
        ["cadence_group_order"],
      ),
    ).toBe(false);
    expect(
      isGroupCustomized(
        clone({ cadence_group_order: ["daily", "general", "exact"] }),
        base,
        ["cadence_group_order"],
      ),
    ).toBe(true);
  });
});

describe("customizedCount", () => {
  it("counts only the fields that left their default", () => {
    const config = clone({ grid_columns: 5, list_task_lines: 10 });
    expect(
      customizedCount(config, base, ["theme", "grid_columns", "list_task_lines"]),
    ).toBe(2);
  });
});
