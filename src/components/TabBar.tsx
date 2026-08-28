import { useState } from "react";
import { useAppStore } from "../store";
import type { Section } from "../types";
import type { IconName } from "./icons";
import Icon from "./icons";
import AboutModal from "./AboutModal";

const TABS: Record<string, { id: Section; label: string; icon: IconName }> = {
  dashboard: { id: "dashboard", label: "Dashboard", icon: "grid" },
  upcoming: { id: "upcoming", label: "Upcoming", icon: "clock" },
  calendar: { id: "calendar", label: "Calendar", icon: "calendar" },
  journal: { id: "journal", label: "Journal", icon: "pencil" },
  kb: { id: "kb", label: "Notes", icon: "notes" },
};

const DEFAULT_ORDER = ["dashboard", "upcoming", "calendar", "journal", "kb"];

// one shared shape for every rail button, so the highlight always
// covers icon and label alike
const railButton =
  "flex h-12 w-[72px] flex-col items-center justify-center gap-0.5 rounded-lg transition-colors";
const railLabel = "max-w-full truncate px-0.5 text-[11px] leading-tight";

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
      className={`${railButton} ${
        result === "failed" || result === "config!"
          ? "text-danger"
          : result
            ? "text-accent"
            : "text-content-muted hover:bg-line/40 hover:text-content"
      }`}
    >
      <Icon
        name="sync"
        className={`h-[18px] w-[18px] ${syncing ? "animate-spin" : ""}`}
      />
      <span className={railLabel}>{syncing ? "..." : (result ?? "Sync")}</span>
    </button>
  );
}

export default function TabBar() {
  const { section, setSection, config, updateConfig } = useAppStore();
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <nav className="flex w-20 flex-col items-center gap-1 border-r border-line bg-surface-alt py-3">
      {(config?.section_order ?? DEFAULT_ORDER)
        .map((id) => TABS[id])
        .filter(Boolean)
        .map((tab) => (
          <button
            key={tab.id}
            title={tab.label}
            onClick={() => setSection(tab.id)}
            className={`${railButton} ${
              section === tab.id
                ? "bg-accent/15 text-accent"
                : "text-content-muted hover:bg-line/40 hover:text-content"
            }`}
          >
            <Icon name={tab.icon} />
            <span className={railLabel}>{tab.label}</span>
          </button>
        ))}
      <button
        title="Search tasks (Ctrl+K)"
        onClick={() => useAppStore.getState().setSearchOpen(true)}
        className={`${railButton} text-content-muted hover:bg-line/40 hover:text-content`}
      >
        <Icon name="search" />
        <span className={railLabel}>Search</span>
      </button>
      <div className="flex-1" />
      <SyncButton />
      <button
        title="Toggle theme"
        onClick={() =>
          void updateConfig({
            theme: config?.theme === "light" ? "dark" : "light",
          })
        }
        className="flex h-12 w-[72px] items-center justify-center rounded-lg text-content-muted hover:bg-line/40 hover:text-content"
      >
        <Icon name={config?.theme === "light" ? "moon" : "sun"} />
      </button>
      <button
        title="About"
        onClick={() => setAboutOpen(true)}
        className={`${railButton} text-content-muted hover:bg-line/40 hover:text-content`}
      >
        <Icon name="info" />
        <span className={railLabel}>About</span>
      </button>
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      <button
        title="Settings"
        onClick={() => setSection("settings")}
        className={`${railButton} ${
          section === "settings"
            ? "bg-accent/15 text-accent"
            : "text-content-muted hover:bg-line/40 hover:text-content"
        }`}
      >
        <Icon name="sliders" />
        <span className={railLabel}>Settings</span>
      </button>
    </nav>
  );
}
