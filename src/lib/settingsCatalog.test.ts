import { describe, expect, it } from "vitest";
import {
  EXCLUDED_KEYS,
  SETTINGS_CATALOG,
  SETTINGS_GROUPS,
  SETTINGS_TABS,
  groupKeys,
  profileCoverage,
  profileGroups,
  profileGroupsByTab,
  searchSettings,
  type SettingsGroupId,
} from "./settingsCatalog";
import { defaultConfig } from "../test/fixtures";
import type { AppConfig } from "../types";

const catalogued = new Set(SETTINGS_CATALOG.map((e) => e.key));
const excluded = new Set(EXCLUDED_KEYS.map((e) => e.key));

describe("the settings catalog", () => {
  it("files every config field in a group or names why it has no control", () => {
    const missing = (Object.keys(defaultConfig) as (keyof AppConfig)[]).filter(
      (key) => !catalogued.has(key) && !excluded.has(key),
    );
    expect(missing).toEqual([]);
  });

  it("names no field that no longer exists", () => {
    const unknown = [...catalogued, ...excluded].filter(
      (key) => !(key in defaultConfig),
    );
    expect(unknown).toEqual([]);
  });

  it("lists every field exactly once", () => {
    expect(catalogued.size).toBe(SETTINGS_CATALOG.length);
    const both = SETTINGS_CATALOG.filter((e) => excluded.has(e.key));
    expect(both).toEqual([]);
  });

  it("puts every group on a real tab and gives it fields or actions", () => {
    const tabs = new Set(SETTINGS_TABS.map((t) => t.id));
    for (const [id, group] of Object.entries(SETTINGS_GROUPS)) {
      expect(tabs.has(group.tab)).toBe(true);
      // a group with no fields must be one that carries actions instead
      // (the cleanup sweep), never an empty header
      if (groupKeys(id as SettingsGroupId).length === 0) {
        expect(group.always).toBe(true);
      }
    }
  });

  it("leaves no tab without groups", () => {
    const used = new Set(Object.values(SETTINGS_GROUPS).map((g) => g.tab));
    for (const tab of SETTINGS_TABS) {
      // Profiles is the one tab that is a screen rather than a set of
      // fields
      if (tab.id === "profiles") continue;
      expect(used.has(tab.id)).toBe(true);
    }
  });
});

describe("knobs groups", () => {
  it("holds fields, since its header is the switch", () => {
    const knobs = (Object.keys(SETTINGS_GROUPS) as SettingsGroupId[]).filter(
      (id) => SETTINGS_GROUPS[id].knobs,
    );
    expect(knobs.length).toBeGreaterThan(0);
    for (const id of knobs) {
      expect(groupKeys(id).length).toBeGreaterThan(0);
    }
  });
});

describe("searchSettings", () => {
  it("finds a setting by its label", () => {
    expect(searchSettings("snooze").map((h) => h.key)).toContain(
      "notify_snooze_minutes",
    );
  });

  it("finds a setting by its raw config key", () => {
    expect(searchSettings("tasks_mirror_ids").map((h) => h.key)).toEqual([
      "tasks_mirror_ids",
    ]);
  });

  it("requires every term to match, in any order", () => {
    const hits = searchSettings("waiting fold").map((h) => h.key);
    expect(hits).toEqual(["fold_waiting"]);
    expect(searchSettings("fold waiting").map((h) => h.key)).toEqual(hits);
  });

  it("reports the tab and group a hit lives on", () => {
    const [hit] = searchSettings("theme palette");
    expect(hit.tab).toBe("appearance");
    expect(hit.groupTitle).toBe("Theme");
  });

  it("is empty for a blank query", () => {
    expect(searchSettings("   ")).toEqual([]);
  });
});

describe("profileCoverage", () => {
  const keys: (keyof AppConfig)[] = [
    "cron_weekday_labels",
    "cron_everyday_label",
    "habit_rate_chip",
    "habit_rate_alert_color",
    "theme",
  ];

  it("reports a fully covered group", () => {
    expect(
      profileCoverage("appearance.theme", [
        "theme",
        "accent_color",
        "surface_color",
        "surface_alt_color",
        "line_color",
        "color_min_contrast",
        "content_color",
        "content_muted_color",
      ]),
    ).toBe("all");
  });

  it("reports a partly covered group", () => {
    // completion rate: the chip toggle travels with a profile, the
    // threshold and window do not
    expect(profileCoverage("cards.rate", keys)).toBe("some");
  });

  it("reports an untouched group", () => {
    expect(profileCoverage("data.mirror", keys)).toBe("none");
  });

  it("says nothing before the scope has loaded", () => {
    expect(profileCoverage("appearance.theme", null)).toBe("unknown");
  });

  it("folds the covered groups by tab, in page order", () => {
    const rows = profileGroupsByTab([
      ...keys,
      "closed_sections_sort_alpha",
      "lists_page_align_rows",
    ]);
    expect(rows.map((r) => r.tab)).toEqual([
      "appearance",
      "views",
      "cards",
      "columns",
    ]);
    expect(rows[1].groups.map((g) => g.title)).toEqual(["Lists page"]);
    // a tab a profile never touches does not get an empty row
    expect(rows.some((r) => r.tab === "data")).toBe(false);
  });

  it("lists the covered groups for the Profiles tab", () => {
    const groups = profileGroups(keys);
    expect(groups.map((g) => g.id)).toEqual([
      "appearance.theme",
      "cards.markers",
      "cards.rate",
    ]);
    expect(groups.find((g) => g.id === "cards.markers")?.partial).toBe(false);
    expect(groups.find((g) => g.id === "cards.rate")?.partial).toBe(true);
  });
});
