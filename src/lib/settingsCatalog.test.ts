import { describe, expect, it } from "vitest";
import {
  EXCLUDED_KEYS,
  SETTINGS_CATALOG,
  SETTINGS_GROUPS,
  SETTINGS_TABS,
  groupKeys,
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
      expect(used.has(tab.id)).toBe(true);
    }
  });

  it("shows no color: the scheme is colors.yml's", () => {
    // the field names a color, or tunes how colors are picked
    const colorish = SETTINGS_CATALOG.filter((e) => /color/.test(e.key));
    expect(colorish).toEqual([]);
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
  it("finds a setting by its label, and nothing that lives in the files", () => {
    expect(searchSettings("snooze").map((h) => h.key)).toEqual([]);
    expect(searchSettings("tray").map((h) => h.key)).toContain("tray_icon");
  });

  it("finds a setting by its raw config key", () => {
    expect(searchSettings("tasks_mirror_today").map((h) => h.key)).toEqual([
      "tasks_mirror_today",
    ]);
  });

  it("requires every term to match, in any order", () => {
    const hits = searchSettings("lists alphabetically").map((h) => h.key);
    expect(hits).toEqual(["lists_sort_alpha"]);
    expect(searchSettings("alphabetically lists").map((h) => h.key)).toEqual(
      hits,
    );
  });

  it("reports the tab and group a hit lives on", () => {
    const [hit] = searchSettings("theme palette");
    expect(hit.tab).toBe("general");
    expect(hit.groupTitle).toBe("Theme");
  });

  it("is empty for a blank query", () => {
    expect(searchSettings("   ")).toEqual([]);
  });
});
