import { useState } from "react";
import { useAppStore } from "../store";
import {
  SettingsFocusContext,
  type SettingsFocus,
} from "../components/SettingsGroup";
import {
  SETTINGS_GROUPS,
  SETTINGS_TABS,
  searchSettings,
  groupKeys,
  tabShowsWithoutAdvanced,
  type SearchHit,
  type SettingsGroupId,
  type SettingsTab,
} from "../lib/settingsCatalog";
import { isGroupCustomized } from "../lib/settingsGroups";
import GeneralTab from "./settings/GeneralTab";
import TasksTab from "./settings/TasksTab";
import RecurringTab from "./settings/RecurringTab";
import CaptureTab from "./settings/CaptureTab";
import DataTab from "./settings/DataTab";
import SyncTab from "./settings/SyncTab";

/**
 * A short page by design: General (theme, fonts, left bar), Tasks,
 * the recurring machinery, capture and alerts, data and sync - what a
 * person sets up once. Colors and fine-tuning live in colors.yml and
 * app.yml (Notes > Config). The map itself (groups, fields, search
 * terms) lives in `lib/settingsCatalog.ts`; groups sitting fully at
 * their defaults render collapsed behind a Customize affordance
 * (SettingsGroup).
 */
export default function Settings() {
  const [tab, setTab] = useState<SettingsTab>("general");
  const openConfigFile = useAppStore((s) => s.openConfigFile);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<SettingsFocus | null>(null);
  const hits = searchSettings(query);
  const showAdvanced = useAppStore((s) => s.config?.settings_advanced ?? false);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const config = useAppStore((s) => s.config);
  const defaults = useAppStore((s) => s.defaults);
  // a tab of nothing but advanced groups shows with them, once one of
  // them is in use, or when a search jumps into it
  const focusTab = focus ? SETTINGS_GROUPS[focus.group].tab : null;
  const inUse = (id: SettingsGroupId) =>
    config !== null &&
    defaults !== null &&
    isGroupCustomized(config, defaults, groupKeys(id));
  const tabs = SETTINGS_TABS.filter(
    (t) =>
      showAdvanced || t.id === focusTab || tabShowsWithoutAdvanced(t.id, inUse),
  );
  const shownTab = tabs.some((t) => t.id === tab) ? tab : "general";

  // a hit names the field, so the jump opens the group holding it
  const jump = (hit: SearchHit) => {
    setTab(hit.tab);
    setFocus({ group: hit.group });
    setQuery("");
  };

  return (
    // One column width with Upcoming (max-w-4xl): wide enough that a
    // hint reads on a line or two, capped at the window
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 p-6">
      <div className="relative flex flex-col gap-2">
        {/* the search takes the row, the advanced switch closes it at
            the tab line's right end */}
        <div className="flex items-center gap-4">
          <input
            className="input min-w-0 flex-1"
            placeholder="Search settings..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFocus(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              if (e.key === "Enter" && hits.length > 0) jump(hits[0]);
            }}
          />
          <label className="flex shrink-0 items-center gap-2 text-sm text-content-muted">
            <input
              type="checkbox"
              checked={showAdvanced}
              onChange={(e) =>
                void updateConfig({ settings_advanced: e.target.checked })
              }
            />
            Show advanced settings
          </label>
        </div>
        {query.trim() !== "" && (
          <div className="absolute top-10 z-20 flex w-full flex-col overflow-hidden rounded-md border border-line bg-surface-alt shadow-lg">
            {hits.length === 0 ? (
              <span className="px-3 py-2 text-xs text-content-muted">
                Nothing matches &quot;{query}&quot;.
              </span>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {hits.map((hit) => (
                  <button
                    key={hit.key}
                    className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-line/40"
                    onClick={() => jump(hit)}
                  >
                    <span className="min-w-0 flex-1 truncate">{hit.label}</span>
                    <span className="shrink-0 text-xs text-content-muted">
                      {SETTINGS_TABS.find((t) => t.id === hit.tab)?.label} ›{" "}
                      {hit.groupTitle}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            aria-current={shownTab === t.id ? "true" : undefined}
            className={`px-3 py-2 text-sm font-medium ${
              shownTab === t.id
                ? "border-b-2 border-accent text-accent"
                : "text-content-muted hover:text-content"
            }`}
            onClick={() => {
              setTab(t.id);
              setFocus(null);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <SettingsFocusContext.Provider value={focus}>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-10">
          {shownTab === "general" && <GeneralTab />}
          {shownTab === "tasks" && <TasksTab />}
          {shownTab === "recurring" && <RecurringTab />}
          {shownTab === "capture" && <CaptureTab />}
          {shownTab === "data" && <DataTab />}
          {shownTab === "sync" && <SyncTab />}
          {/* the rest is in the files: say where, one click away */}
          <p className="border-t border-line pt-3 text-xs text-content-muted">
            Shared by your devices:{" "}
            <button
              className="text-accent hover:underline"
              onClick={() => openConfigFile("colors.yml")}
            >
              colors.yml
            </button>{" "}
            (the colors) and{" "}
            <button
              className="text-accent hover:underline"
              onClick={() => openConfigFile("shared.yml")}
            >
              shared.yml
            </button>{" "}
            (retention, catch-up, cadence thresholds, cleanup, capture list,
            completion rate - set here, kept there). Fine-tuning (spacing,
            timings, sync cadence) is in{" "}
            <button
              className="text-accent hover:underline"
              onClick={() => openConfigFile("app.yml")}
            >
              app.yml
            </button>{" "}
            (this device).
          </p>
        </div>
      </SettingsFocusContext.Provider>
    </div>
  );
}
