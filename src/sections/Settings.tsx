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
  type SettingsGroupId,
  type SettingsTab,
} from "../lib/settingsCatalog";
import ProfilesTab from "./settings/ProfilesTab";
import AppearanceTab from "./settings/AppearanceTab";
import ViewsTab from "./settings/ViewsTab";
import TaskCardsTab from "./settings/TaskCardsTab";
import ColumnsTab from "./settings/ColumnsTab";
import RecurringTab from "./settings/RecurringTab";
import CaptureTab from "./settings/CaptureTab";
import DataTab from "./settings/DataTab";

/**
 * One tab per thing being configured rather than per kind of setting:
 * the global chrome (Appearance), the pages (Views), the task card, the
 * columns tasks sit in, the recurring machinery, capture and alerts,
 * and the vault's data. Inside a group, look, geometry and behavior sit
 * together - "make the Done block quieter" is one question, not three
 * tabs. The map itself (groups, fields, search terms) lives in
 * `lib/settingsCatalog.ts`; groups sitting fully at their defaults
 * render collapsed behind a Customize affordance (SettingsGroup).
 */
export default function Settings() {
  const [tab, setTab] = useState<SettingsTab>("appearance");
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<SettingsFocus | null>(null);
  // The page used to sit in a fixed narrow column, which pushed half the
  // tab strip onto a second line on anything but a huge font. The width
  // is a setting now (0 = the whole window), like every other layout
  // proportion.
  const width = useAppStore((s) => s.config?.settings_width ?? 1120);
  const hits = searchSettings(query);

  // a hit names the field, so the jump opens the group and, when the
  // field sits behind a customization checkbox, that micro-group too
  const jump = (hit: SearchHit) => {
    setTab(hit.tab);
    setFocus({ group: hit.group, sub: hit.sub ?? null });
    setQuery("");
  };

  // the Profiles tab points at whole groups, never at one field
  const jumpToGroup = (target: SettingsTab, group: SettingsGroupId) => {
    setTab(target);
    setFocus({ group, sub: null });
  };

  return (
    <div
      className="mx-auto flex h-full w-full flex-col gap-4 p-6"
      style={{ maxWidth: width > 0 ? width : undefined }}
    >
      <div className="relative flex flex-col gap-2">
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

      <div className="flex flex-wrap gap-1 border-b border-line">
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
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-10">
          {tab === "profiles" && <ProfilesTab onJump={jumpToGroup} />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "views" && <ViewsTab />}
          {tab === "cards" && <TaskCardsTab />}
          {tab === "columns" && <ColumnsTab />}
          {tab === "recurring" && <RecurringTab />}
          {tab === "capture" && <CaptureTab />}
          {tab === "data" && <DataTab />}
        </div>
      </SettingsFocusContext.Provider>
    </div>
  );
}
