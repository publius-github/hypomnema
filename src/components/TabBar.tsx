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

// the highlight is a square around the icon; the label sits under it
// and only changes color, so the selection reads compact
const railButton = "group flex w-[72px] flex-col items-center gap-0.5 py-0.5";
const railBox =
  "flex h-10 w-12 items-center justify-center rounded-lg transition-colors";
const railLabel = "max-w-full truncate px-0.5 text-[11px] leading-tight";

function RailButton({
  active = false,
  danger = false,
  accent = false,
  title,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  danger?: boolean;
  accent?: boolean;
  title: string;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const tone = danger
    ? "text-danger"
    : accent || active
      ? "text-accent"
      : "text-content-muted";
  return (
    <button className={railButton} title={title} onClick={onClick}>
      <span
        className={`${railBox} ${tone} ${
          active
            ? "bg-accent/15"
            : "group-hover:bg-line/40 group-hover:text-content"
        }`}
      >
        {children}
      </span>
      <span className={`${railLabel} ${tone}`}>{label}</span>
    </button>
  );
}

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
    <RailButton
      title="Re-read config files and regenerate tasks"
      label={syncing ? "..." : (result ?? "Sync")}
      danger={result === "failed" || result === "config!"}
      accent={Boolean(result) && result !== "failed" && result !== "config!"}
      onClick={() => void sync()}
    >
      <Icon
        name="sync"
        className={`h-[18px] w-[18px] ${syncing ? "animate-spin" : ""}`}
      />
    </RailButton>
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
          <RailButton
            key={tab.id}
            title={tab.label}
            label={tab.label}
            active={section === tab.id}
            onClick={() => setSection(tab.id)}
          >
            <Icon name={tab.icon} />
          </RailButton>
        ))}
      <RailButton
        title="Search tasks (Ctrl+K)"
        label="Search"
        onClick={() => useAppStore.getState().setSearchOpen(true)}
      >
        <Icon name="search" />
      </RailButton>
      <div className="flex-1" />
      <SyncButton />
      <button
        title="Toggle theme"
        onClick={() =>
          void updateConfig({
            theme: config?.theme === "light" ? "dark" : "light",
          })
        }
        className="flex h-10 w-12 items-center justify-center rounded-lg text-content-muted hover:bg-line/40 hover:text-content"
      >
        <Icon name={config?.theme === "light" ? "moon" : "sun"} />
      </button>
      <RailButton title="About" label="About" onClick={() => setAboutOpen(true)}>
        <Icon name="info" />
      </RailButton>
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      <RailButton
        title="Settings"
        label="Settings"
        active={section === "settings"}
        onClick={() => setSection("settings")}
      >
        <Icon name="sliders" />
      </RailButton>
    </nav>
  );
}
