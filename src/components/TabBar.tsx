import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store";
import { errorMessage, invoke } from "../lib/ipc";
import type { Section, SyncActivity, SyncStanding } from "../types";
import type { IconName } from "./icons";
import Icon from "./icons";
import AboutModal from "./AboutModal";

const TABS: Record<string, { id: Section; label: string; icon: IconName }> = {
  dashboard: { id: "dashboard", label: "Dashboard", icon: "grid" },
  lists: { id: "lists", label: "Lists", icon: "list" },
  days: { id: "days", label: "Days", icon: "columns" },
  upcoming: { id: "upcoming", label: "Upcoming", icon: "clock" },
  reminders: { id: "reminders", label: "Reminders", icon: "bell" },
  calendar: { id: "calendar", label: "Calendar", icon: "calendar" },
  history: { id: "history", label: "History", icon: "chart" },
  review: { id: "review", label: "Review", icon: "review" },
  journal: { id: "journal", label: "Journal", icon: "pencil" },
  kb: { id: "kb", label: "Notes", icon: "notes" },
};

const DEFAULT_ORDER = [
  "dashboard",
  "lists",
  "days",
  "upcoming",
  "reminders",
  "calendar",
  "history",
  "review",
  "journal",
  "kb",
];

// the highlight is a square around the icon; the label sits under it
// and only changes color, so the selection reads compact.
// px everywhere on purpose (sizes, gaps, paddings): the rail must not
// move or scale with the configurable base font size (rem values do)
const railButton = "group flex w-[60px] flex-col items-center gap-[2px] py-[2px]";
const railBox =
  "flex h-[36px] w-[36px] items-center justify-center rounded-lg transition-colors";
const railLabel = "max-w-full truncate px-[2px] text-[11px] leading-[14px]";

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
      : "text-content/80";
  return (
    <button
      className={railButton}
      title={title}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
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

/** "Today" / "14 Oct" over "14:32", narrow enough for the rail. */
function syncedLines(iso: string): [string, string] {
  const when = new Date(iso);
  const sameDay = when.toDateString() === new Date().toDateString();
  return [
    sameDay
      ? "Today"
      : when.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  ];
}

/**
 * Re-reads the config and regenerates tasks, and - while a Google account
 * is signed in - runs a Drive pass right after, so one button brings the
 * window fully up to date. Under it the last pass's day and time (from
 * any trigger: this button, the scheduler, Settings), red when that pass
 * failed.
 */
function SyncButton() {
  const runEngine = useAppStore((s) => s.runEngine);
  const vaultPath = useAppStore((s) => s.vaultPath);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [standing, setStanding] = useState<SyncStanding | null>(null);

  const loadStanding = useCallback(() => {
    void invoke("google_status")
      .then((status) => setSignedIn(status.signed_in))
      .catch(() => setSignedIn(false));
    void invoke("sync_standing")
      .then(setStanding)
      .catch(() => setStanding(null));
  }, []);

  useEffect(() => {
    if (!vaultPath) return;
    loadStanding();
    // passes the scheduler starts move the stamp too
    const unlisten = listen<SyncActivity>("sync-status", (event) => {
      if (!event.payload.running) loadStanding();
    });
    // a sign-in or sign-out in Settings is picked up on the next focus
    window.addEventListener("focus", loadStanding);
    return () => {
      void unlisten.then((f) => f());
      window.removeEventListener("focus", loadStanding);
    };
  }, [vaultPath, loadStanding]);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    const outcome = await runEngine();
    let driveFailed = false;
    if (signedIn) {
      try {
        await invoke("sync_now");
        await useAppStore.getState().refresh();
      } catch (e) {
        driveFailed = true;
        useAppStore.getState().setError(errorMessage(e));
      }
      loadStanding();
    }
    setSyncing(false);
    if (!outcome || driveFailed) {
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

  const last = signedIn && standing?.last_pass_at;
  const lines = last ? syncedLines(last) : null;
  const failed = Boolean(signedIn && standing?.last_error);

  return (
    <div className="flex flex-col items-center">
      <RailButton
        title={
          signedIn
            ? "Re-read config files, regenerate tasks and sync with Google Drive"
            : "Re-read config files and regenerate tasks"
        }
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
      {lines && (
        <span
          title={
            failed
              ? `Last sync failed: ${standing?.last_error}`
              : `Last synced ${new Date(last as string).toLocaleString()}`
          }
          className={`flex flex-col items-center text-[10px] leading-[12px] ${
            failed ? "text-danger" : "text-content-muted"
          }`}
        >
          <span>{lines[0]}</span>
          <span>{lines[1]}</span>
        </span>
      )}
    </div>
  );
}

export default function TabBar() {
  const section = useAppStore((s) => s.section);
  const setSection = useAppStore((s) => s.setSection);
  const config = useAppStore((s) => s.config);
  const [aboutOpen, setAboutOpen] = useState(false);

  // hidden sections (Settings > Views) leave the rail entirely
  const order = config?.section_order ?? DEFAULT_ORDER;
  const hidden = useMemo(() => config?.section_hidden ?? [], [config]);
  const visible = useMemo(
    () =>
      order
        .filter((id) => !hidden.includes(id))
        .map((id) => TABS[id])
        .filter(Boolean),
    [order, hidden],
  );

  // hiding the section you are standing in would leave the window on a
  // page with no way back to it; step to the first one still shown
  useEffect(() => {
    if (section === "settings" || !hidden.includes(section)) return;
    setSection(visible[0]?.id ?? "settings");
  }, [section, hidden, visible, setSection]);

  return (
    <nav
      aria-label="Sections"
      className="flex w-[64px] flex-col items-center gap-[4px] border-r border-line bg-surface-alt py-[12px]">
      {visible.map((tab) => (
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
