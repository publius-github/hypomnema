import { useState } from "react";
import AppearanceTab from "./settings/AppearanceTab";
import LayoutTab from "./settings/LayoutTab";
import TasksTab from "./settings/TasksTab";
import EngineTab from "./settings/EngineTab";
import CalendarTab from "./settings/CalendarTab";
import NotificationsTab from "./settings/NotificationsTab";
import FilesTab from "./settings/FilesTab";
import MaintenanceTab from "./settings/MaintenanceTab";

// One tab per concern: how it looks (Appearance), how the pages are
// laid out (Layout, incl. the section order), how cards and lists
// behave (Tasks & Lists), how tasks are generated (Engine), then the
// smaller areas. Groups sitting fully at their defaults render
// collapsed behind a Customize affordance (SettingsGroup).
const TABS = [
  { id: "appearance", label: "Appearance" },
  { id: "layout", label: "Layout" },
  { id: "tasks", label: "Tasks & Lists" },
  { id: "engine", label: "Engine" },
  { id: "calendar", label: "Calendar" },
  { id: "notifications", label: "Notifications" },
  { id: "files", label: "Files" },
  { id: "maintenance", label: "Maintenance" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function Settings() {
  const [tab, setTab] = useState<Tab>("appearance");

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 p-6">
      <div className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`px-3 py-2 text-sm font-medium ${
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
        {tab === "layout" && <LayoutTab />}
        {tab === "tasks" && <TasksTab />}
        {tab === "engine" && <EngineTab />}
        {tab === "calendar" && <CalendarTab />}
        {tab === "notifications" && <NotificationsTab />}
        {tab === "files" && <FilesTab />}
        {tab === "maintenance" && <MaintenanceTab />}
      </div>
    </div>
  );
}
