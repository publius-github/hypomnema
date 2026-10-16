import { useState } from "react";
import { useAppStore } from "../store";
import {
  SettingsFocusContext,
  type SettingsFocus,
} from "../components/SettingsGroup";
import {
  SETTINGS_TABS,
  searchSettings,
  type SearchHit,
  type SettingsTab,
} from "../lib/settingsCatalog";
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

  // a hit names the field, so the jump opens the group holding it
  const jump = (hit: SearchHit) => {
    setTab(hit.tab);
    setFocus({ group: hit.group });
    setQuery("");
  };

  return (
    // The column is exactly as wide as the tab strip on one line (w-fit
    // over a nowrap strip; the search and the tab body are sized 0 with
    // min-w-full, so they take that width instead of setting it) - every
    // tab fits at any font size, and nothing gets wider than that. A
    // window narrower than the strip caps it at the window and the
    // strip wraps.
    <div className="mx-auto flex h-full w-fit min-w-0 max-w-full flex-col gap-4 p-6">
      <div className="relative flex w-0 min-w-full flex-col gap-2">
        <input
          className="input w-full max-w-md"
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
        {query.trim() !== "" && (
          <div className="absolute top-10 z-20 flex w-full max-w-md flex-col overflow-hidden rounded-md border border-line bg-surface-alt shadow-lg">
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

      <div className="flex flex-wrap gap-1 whitespace-nowrap border-b border-line">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t.id
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
        <div className="flex min-h-0 w-0 min-w-full flex-1 flex-col gap-5 overflow-y-auto pb-10">
          {tab === "general" && <GeneralTab />}
          {tab === "tasks" && <TasksTab />}
          {tab === "recurring" && <RecurringTab />}
          {tab === "capture" && <CaptureTab />}
          {tab === "data" && <DataTab />}
          {tab === "sync" && <SyncTab />}
          {/* the rest is in the files: say where, one click away */}
          <p className="border-t border-line pt-3 text-xs text-content-muted">
            Colors and fine-tuning (spacing, timings, sync cadence) live in
            the config files:{" "}
            <button
              className="text-accent hover:underline"
              onClick={() => openConfigFile("colors.yml")}
            >
              colors.yml
            </button>{" "}
            (shared by your devices) and{" "}
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
