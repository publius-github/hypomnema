import { useState } from "react";
import { useAppStore } from "../store";
import type { Section } from "../types";
import type { IconName } from "./icons";
import Icon from "./icons";
import AboutModal from "./AboutModal";

const TABS: { id: Section; label: string; icon: IconName }[] = [
  { id: "dashboard", label: "Dashboard", icon: "grid" },
  { id: "upcoming", label: "Upcoming", icon: "clock" },
  { id: "recurring", label: "Recurring", icon: "repeat" },
  { id: "calendar", label: "Calendar", icon: "calendar" },
  { id: "journal", label: "Journal", icon: "pencil" },
  { id: "kb", label: "Notes", icon: "notes" },
];

function SyncButton() {
  const { runEngine, refresh } = useAppStore();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    const outcome = await runEngine();
    await refresh();
    setSyncing(false);
    if (!outcome) {
      setResult("failed");
    } else if (outcome.errors.length > 0) {
      setResult("config!");
    } else {
      const changed =
        outcome.generated + outcome.carried_over + outcome.removed;
      setResult(changed > 0 ? `+${changed}` : "up to date");
    }
    window.setTimeout(() => setResult(null), 2500);
  };

  return (
    <button
      title="Re-read config files and regenerate tasks"
      onClick={() => void sync()}
      className={`flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors ${
        result === "failed" || result === "config!"
          ? "text-red-500"
          : result
            ? "text-accent"
            : "text-content-muted hover:bg-line/40 hover:text-content"
      }`}
    >
      <Icon
        name="sync"
        className={`h-[18px] w-[18px] ${syncing ? "animate-spin" : ""}`}
      />
      <span className="text-[9px] leading-tight">
        {syncing ? "..." : (result ?? "Sync")}
      </span>
    </button>
  );
}

export default function TabBar() {
  const { section, setSection, config, updateConfig } = useAppStore();
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <nav className="flex w-16 flex-col items-center gap-1 border-r border-line bg-surface-alt py-3">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          title={tab.label}
          onClick={() => setSection(tab.id)}
          className={`flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors ${
            section === tab.id
              ? "bg-accent/15 text-accent"
              : "text-content-muted hover:bg-line/40 hover:text-content"
          }`}
        >
          <Icon name={tab.icon} />
          <span className="text-[9px] leading-tight">
            {tab.label.split(" ")[0]}
          </span>
        </button>
      ))}
      <div className="flex-1" />
      <SyncButton />
      <button
        title="Toggle theme"
        onClick={() =>
          void updateConfig({
            theme: config?.theme === "light" ? "dark" : "light",
          })
        }
        className="flex h-12 w-12 items-center justify-center rounded-lg text-content-muted hover:bg-line/40 hover:text-content"
      >
        <Icon name={config?.theme === "light" ? "moon" : "sun"} />
      </button>
      <button
        title="About"
        onClick={() => setAboutOpen(true)}
        className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-lg text-content-muted transition-colors hover:bg-line/40 hover:text-content"
      >
        <Icon name="info" />
        <span className="text-[9px] leading-tight">About</span>
      </button>
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      <button
        title="Settings"
        onClick={() => setSection("settings")}
        className={`flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors ${
          section === "settings"
            ? "bg-accent/15 text-accent"
            : "text-content-muted hover:bg-line/40 hover:text-content"
        }`}
      >
        <Icon name="sliders" />
        <span className="text-[9px] leading-tight">Settings</span>
      </button>
    </nav>
  );
}
