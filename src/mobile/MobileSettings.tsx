import { useCallback, useEffect, useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import { LockSettings } from "./MobileLock";
import { useBackStep } from "./back";
import { AboutContent, useAppVersion } from "../components/AboutModal";
import { ActionRow, ChoiceRow, Section } from "./settings/rows";
import SyncPanel from "./settings/SyncPanel";
import {
  NotificationsPanel,
  RulesPanel,
  TasksPanel,
} from "./settings/PreferencePanels";
import { MaintenancePanel, VaultPanel } from "./settings/DataPanels";

import type {
  ConflictEntry,
  GoogleStatus,
  LockState,
  SyncStanding,
} from "../types";

type Panel =
  | "sync"
  | "lock"
  | "tasks"
  | "notifications"
  | "rules"
  | "maintenance"
  | "vault"
  | "about";

const TITLES: Record<Panel, string> = {
  sync: "Sync",
  lock: "Passphrase",
  tasks: "Tasks",
  notifications: "Notifications",
  rules: "Rules",
  maintenance: "Backups & cleanup",
  vault: "Vault",
  about: "About",
};

/**
 * Phone settings, after the Android pattern: an index of panels, each
 * row carrying its live state so most visits never open one, and in a
 * panel one full-width row per setting (`settings/rows.tsx`) with the
 * choices in a sheet from the bottom. The header is this screen's own
 * - More hands its header over - so a panel shows one back step, not
 * two stacked bars.
 *
 * The desktop's layout settings are deliberately absent - they
 * describe a window, and this does not have one.
 */
export default function MobileSettings({ onExit }: { onExit: () => void }) {
  const vaultPath = useAppStore((s) => s.vaultPath);
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [standing, setStanding] = useState<SyncStanding | null>(null);
  const [lock, setLock] = useState<LockState | null>(null);
  const version = useAppVersion();
  // hardware back closes the open panel before leaving Settings
  useBackStep(panel !== null, () => setPanel(null));

  const loadSyncState = useCallback(() => {
    void invoke("sync_conflicts_list")
      .then(setConflicts)
      .catch((e) => useAppStore.getState().setError(errorMessage(e)));
    void invoke("sync_standing")
      .then(setStanding)
      .catch((e) => useAppStore.getState().setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    void invoke("google_status")
      .then(setGoogle)
      .catch((e) => useAppStore.getState().setError(errorMessage(e)));
    void invoke("app_lock_state")
      .then(setLock)
      .catch((e) => useAppStore.getState().setError(errorMessage(e)));
    loadSyncState();
  }, [loadSyncState]);

  const syncHint = !google
    ? "Google Drive"
    : google.signed_in
      ? `${google.email ?? "Signed in"}${
          standing && standing.pending > 0
            ? ` · ${standing.pending} waiting`
            : ""
        }${conflicts.length > 0 ? ` · ${conflicts.length} conflicts` : ""}`
      : "Not signed in";

  const header = (back: string, onBack: () => void, title: string) => (
    <header className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-3">
      <button onClick={onBack} className="px-2 py-1 text-content-muted">
        ‹ {back}
      </button>
      <span className="font-semibold">{title}</span>
    </header>
  );

  if (panel) {
    return (
      <div className="flex h-full flex-col">
        {header("Settings", () => setPanel(null), TITLES[panel])}
        <div className="min-h-0 flex-1 overflow-auto pb-6">
          {panel === "sync" && (
            <SyncPanel
              google={google}
              setGoogle={setGoogle}
              standing={standing}
              conflicts={conflicts}
              setConflicts={setConflicts}
              reload={loadSyncState}
            />
          )}
          {panel === "lock" && lock && (
            <div className="px-4 py-4">
              <LockSettings state={lock} onChange={setLock} />
            </div>
          )}
          {panel === "tasks" && config && <TasksPanel config={config} />}
          {panel === "notifications" && config && (
            <NotificationsPanel config={config} />
          )}
          {panel === "rules" && config && <RulesPanel config={config} />}
          {panel === "maintenance" && <MaintenancePanel />}
          {panel === "vault" && <VaultPanel vaultPath={vaultPath} />}
          {panel === "about" && (
            <div className="px-4 py-4">
              <AboutContent />
            </div>
          )}
        </div>
      </div>
    );
  }

  const open = (id: Panel) => () => setPanel(id);
  return (
    <div className="flex h-full flex-col">
      {header("More", onExit, "Settings")}
      <div className="min-h-0 flex-1 overflow-auto pb-6">
        <Section>
          <ActionRow label="Sync" hint={syncHint} onClick={open("sync")} />
        </Section>
        <Section title="Preferences">
          {config && (
            <ChoiceRow
              label="Theme"
              value={config.theme}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
              onChange={(v) => void updateConfig({ theme: v })}
            />
          )}
          <ActionRow
            label="Tasks"
            hint="Cards, day sections, sorting"
            onClick={open("tasks")}
          />
          <ActionRow
            label="Notifications"
            hint={
              config
                ? config.notify_system
                  ? "On"
                  : "Off"
                : "Due-task reminders"
            }
            onClick={open("notifications")}
          />
          <ActionRow
            label="Rules"
            hint="Capture list, overdue marks, catch-up, retention"
            onClick={open("rules")}
          />
        </Section>
        <Section title="Data">
          <ActionRow
            label="Backups & cleanup"
            hint="Snapshots, archived lists, done tasks"
            onClick={open("maintenance")}
          />
          <ActionRow
            label="Vault"
            hint={vaultPath ?? "none"}
            onClick={open("vault")}
          />
          {/* only while one is left over from an earlier version, to remove it */}
          {lock?.enabled && (
            <ActionRow
              label="Passphrase"
              hint="On - no longer needed"
              onClick={open("lock")}
            />
          )}
        </Section>
        <Section>
          <ActionRow
            label="About"
            hint={version ? `Hypomnema ${version}` : "Hypomnema"}
            onClick={open("about")}
          />
        </Section>
      </div>
    </div>
  );
}
