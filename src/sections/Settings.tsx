import { useState } from "react";
import AppearanceTab from "./settings/AppearanceTab";
import PlannerTab from "./settings/PlannerTab";
import CalendarTab from "./settings/CalendarTab";
import NavigationTab from "./settings/NavigationTab";
import FilesTab from "./settings/FilesTab";
import MaintenanceTab from "./settings/MaintenanceTab";

const TABS = [
  { id: "appearance", label: "Appearance" },
  { id: "planner", label: "Planner" },
  { id: "calendar", label: "Calendar" },
  { id: "navigation", label: "Navigation" },
  { id: "files", label: "Files" },
  { id: "maintenance", label: "Maintenance" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function Settings() {
  const [tab, setTab] = useState<Tab>("appearance");

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 p-6">
      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t.id
                ? "border-b-2 border-accent text-accent"
                : "text-content-muted hover:text-content"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-10">
        {tab === "appearance" && <AppearanceTab />}
        {tab === "planner" && <PlannerTab />}
        {tab === "calendar" && <CalendarTab />}
        {tab === "navigation" && <NavigationTab />}
        {tab === "files" && <FilesTab />}
        {tab === "maintenance" && <MaintenanceTab />}
      </div>
    </div>
  );
}
