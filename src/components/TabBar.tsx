import { useState } from "react";
import { useAppStore } from "../store";
import type { Section } from "../types";
import AboutModal from "./AboutModal";

const TABS: { id: Section; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "▦" },
  { id: "upcoming", label: "Upcoming", icon: "◷" },
  { id: "recurring", label: "Recurring", icon: "↻" },
  { id: "journal", label: "Journal", icon: "✎" },
  { id: "kb", label: "Knowledge Base", icon: "❖" },
];

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
          className={`flex h-12 w-12 flex-col items-center justify-center rounded-lg text-lg transition-colors ${
            section === tab.id
              ? "bg-accent/15 text-accent"
              : "text-content-muted hover:bg-line/40 hover:text-content"
          }`}
        >
          <span aria-hidden>{tab.icon}</span>
          <span className="text-[9px] leading-tight">
            {tab.label.split(" ")[0]}
          </span>
        </button>
      ))}
      <div className="flex-1" />
      <button
        title="Toggle theme"
        onClick={() =>
          void updateConfig({
            theme: config?.theme === "light" ? "dark" : "light",
          })
        }
        className="flex h-12 w-12 items-center justify-center rounded-lg text-lg text-content-muted hover:bg-line/40 hover:text-content"
      >
        {config?.theme === "light" ? "☾" : "☀"}
      </button>
      <button
        title="About"
        onClick={() => setAboutOpen(true)}
        className="flex h-12 w-12 flex-col items-center justify-center rounded-lg text-lg text-content-muted transition-colors hover:bg-line/40 hover:text-content"
      >
        <span aria-hidden>ⓘ</span>
        <span className="text-[9px] leading-tight">About</span>
      </button>
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      <button
        title="Settings"
        onClick={() => setSection("settings")}
        className={`flex h-12 w-12 flex-col items-center justify-center rounded-lg text-lg transition-colors ${
          section === "settings"
            ? "bg-accent/15 text-accent"
            : "text-content-muted hover:bg-line/40 hover:text-content"
        }`}
      >
        <span aria-hidden>⚙</span>
        <span className="text-[9px] leading-tight">Settings</span>
      </button>
    </nav>
  );
}
