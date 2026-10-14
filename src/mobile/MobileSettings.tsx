import { useCallback, useEffect, useState } from "react";
import { errorKind, errorMessage, invoke } from "../lib/ipc";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store";
import { LockSettings } from "./MobileLock";
import MobileVaultFolder from "./MobileVaultFolder";
import { NumberField, Toggle } from "./controls";
import { useBackStep } from "./back";
import { ConfirmModal } from "../components/dialogs";
import ConflictList from "../components/ConflictList";

import type {
  AppConfig,
  BackupEntry,
  BackupsOverview,
  ConflictEntry,
  SyncSummary,
  GoogleStatus,
  List,
  LockState,
  SyncStanding,
} from "../types";

type Panel = "sync" | "lock" | "appearance" | "tasks" | "maintenance" | "vault";

/**
 * Phone settings: an index of panels rather than one long scroll. Seven
 * unrelated sections in a single column meant the one being looked for
 * was always somewhere under a thumb-load of the others; a grouped index
 * is what every settled mobile settings screen converges on, and each
 * row can carry its live state (linked or not, passphrase on or off) so
 * most visits never need to open a panel at all.
 *
 * The desktop's layout and profile tabs are deliberately absent - they
 * describe a window, and this does not have one (ROADMAP.md Phase 5
 * revisits them).
 */
export default function MobileSettings() {
  const vaultPath = useAppStore((s) => s.vaultPath);
  const config = useAppStore((s) => s.config);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [standing, setStanding] = useState<SyncStanding | null>(null);
  const [lock, setLock] = useState<LockState | null>(null);
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

  const panels: { id: Panel; label: string; hint: string }[] = [
    { id: "sync", label: "Sync", hint: syncHint },
    {
      id: "appearance",
      label: "Appearance",
      hint: config
        ? `${config.theme === "dark" ? "Dark" : "Light"} · ${config.ui_font_size}px`
        : "Theme, text size",
    },
    {
      id: "tasks",
      label: "Tasks & engine",
      hint: "Notifications, snooze, retention",
    },
    {
      id: "maintenance",
      label: "Maintenance",
      hint: "Backups, archived lists, cleanup",
    },
    { id: "vault", label: "Vault", hint: vaultPath ?? "none" },
    // only while one is left over from the Dropbox days, to remove it
    ...(lock?.enabled
      ? [{ id: "lock" as Panel, label: "Passphrase", hint: "On - no longer needed" }]
      : []),
  ];

  if (panel) {
    const entry = panels.find((p) => p.id === panel);
    return (
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-3">
          <button
            onClick={() => setPanel(null)}
            className="px-2 py-1 text-content-muted"
          >
            ‹ Settings
          </button>
          <span className="font-semibold">{entry?.label}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
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
            <LockSettings state={lock} onChange={setLock} />
          )}
          {panel === "appearance" && config && (
            <AppearancePanel config={config} />
          )}
          {panel === "tasks" && config && <TasksPanel config={config} />}
          {panel === "maintenance" && <MaintenancePanel />}
          {panel === "vault" && <VaultPanel vaultPath={vaultPath} />}
        </div>
      </div>
    );
  }

  return (
    <ul>
      {panels.map((entry) => (
        <li key={entry.id} className="border-b border-line/60">
          <button
            onClick={() => setPanel(entry.id)}
            className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
          >
            <span className="min-w-0">
              <span className="block">{entry.label}</span>
              <span className="block truncate text-xs text-content-muted">
                {entry.hint}
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-content-muted">
              ›
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Google sync panel. Signed out, it is the sign-in - the first-run
 * screen promises "it can be turned on later, from Settings", and this
 * is where that promise is kept. Signed in, it is the everyday sync
 * button plus the switches.
 */
function SyncPanel({
  google,
  setGoogle,
  standing,
  conflicts,
  setConflicts,
  reload,
}: {
  google: GoogleStatus | null;
  setGoogle: (next: GoogleStatus) => void;
  standing: SyncStanding | null;
  conflicts: ConflictEntry[];
  setConflicts: (next: ConflictEntry[]) => void;
  reload: () => void;
}) {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const setError = useAppStore((s) => s.setError);
  const [sync, setSync] = useState<SyncSummary | null>(null);
  const [showConflicts, setShowConflicts] = useState(false);
  // decisions that left a conflicted copy still in the vault
  const openConflicts = conflicts.filter((c) => c.open).length;
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  // Set when a pass stopped on the mass-deletion guard: the remote lost
  // most of what this device had synced, and only the user can say
  // whether that is a wipe to repair or deletions to accept.
  const [wiped, setWiped] = useState(false);
  // Google stopped accepting this device's grant; only a fresh sign-in
  // helps, so the panel offers it in place.
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const unlisten = listen<[number, number]>("sync-progress", (e) =>
      setProgress(e.payload),
    );
    return () => void unlisten.then((fn) => fn());
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setWiped(false);
      setExpired(false);
    } catch (e) {
      const kind = errorKind(e);
      if (kind === "remote_wiped") setWiped(true);
      if (kind === "sign_in_expired") setExpired(true);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setProgress(null);
      reload();
    }
  };

  const syncNow = (resetFirst = false) =>
    run(async () => {
      if (resetFirst) await invoke("sync_reset_space");
      setSync(await invoke("sync_now"));
      await useAppStore.getState().refresh();
    });

  const signIn = () =>
    run(async () => {
      const next = await invoke("google_sign_in");
      setGoogle(next);
      // the first pass joins this vault with what Drive already holds
      if (next.signed_in) {
        setSync(await invoke("sync_now"));
        await useAppStore.getState().refresh();
      }
    });

  if (!google?.signed_in) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-content-muted">
          Optional. Signing in keeps this vault in step with your other devices
          through a hidden app folder in your Google Drive; the app sees
          nothing else there. Sign in with the same account on every device.
        </p>
        <button
          disabled={busy || google?.available === false}
          onClick={() => void signIn()}
          className="rounded-lg bg-accent px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Signing in..." : "Sign in with Google"}
        </button>
        {progress && (
          <p className="text-sm text-content-muted">
            {progress[0]} / {progress[1]} files
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <p className="text-sm">
          Signed in as <span className="font-medium">{google.email}</span>
          {google.name && (
            <span className="text-content-muted"> ({google.name})</span>
          )}
        </p>
        {/* Answered from disk, not from the network: a phone with no
            signal can still say exactly what it is holding, which is
            what makes editing offline legible rather than a leap of
            faith. */}
        {standing && (
          <p className="text-sm">
            {standing.pending === 0
              ? "Nothing waiting to go up."
              : `${standing.pending} change${
                  standing.pending === 1 ? "" : "s"
                } waiting to go up.`}
            {standing.last_pass_at && (
              <span className="block text-xs text-content-muted">
                Last tried{" "}
                {standing.last_pass_at.slice(0, 16).replace("T", " ")}
              </span>
            )}
            {standing.last_error && (
              <span className="block break-words text-xs text-warn">
                {standing.last_error}
              </span>
            )}
          </p>
        )}
        <button
          disabled={busy}
          onClick={() => void syncNow()}
          className="rounded-lg bg-accent px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Syncing..." : "Sync now"}
        </button>
        {progress && (
          <p className="text-sm text-content-muted">
            {progress[0]} / {progress[1]} files
          </p>
        )}
        {expired && (
          <button
            disabled={busy}
            onClick={() => void signIn()}
            className="rounded-lg border border-warn/60 px-4 py-2 text-sm disabled:opacity-50"
          >
            Sign in again
          </button>
        )}
        {wiped && (
          <div className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
            <p>
              Most of what this phone had synced is gone from Google Drive at
              once, so nothing was deleted here. If the Drive copy was wiped,
              upload this vault again; if the deletions were intended, raise
              the limit below and sync.
            </p>
            <button
              disabled={busy}
              onClick={() => void syncNow(true)}
              className="rounded-lg border border-line px-4 py-2 disabled:opacity-50"
            >
              Upload this vault again
            </button>
          </div>
        )}
        {sync && (
          <p className="text-sm">
            {sync.downloaded} in, {sync.uploaded} out
            {sync.merged > 0 && `, ${sync.merged} merged`}
            {sync.removed_locally + sync.removed_remotely > 0 &&
              `, ${sync.removed_locally + sync.removed_remotely} removed`}
            .
            {sync.conflicted_copies.length > 0 && (
              <span className="block text-warn">
                Kept aside: {sync.conflicted_copies.join(", ")}
              </span>
            )}
            {sync.failed.length > 0 && (
              <span className="block text-danger">
                {sync.failed.length} file
                {sync.failed.length === 1 ? "" : "s"} failed.
              </span>
            )}
          </p>
        )}
        {config && (
          <>
            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-sm">Sync automatically</span>
              <Toggle
                checked={config.sync_auto}
                onChange={(next) => void updateConfig({ sync_auto: next })}
                label="Sync automatically"
              />
            </div>
            {config.sync_auto && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 text-sm">
                    Also when leaving the app
                    <span className="block text-xs text-content-muted">
                      Android freezes a backgrounded app; without this the last
                      thing you did waits here until you come back.
                    </span>
                  </span>
                  <Toggle
                    checked={config.sync_on_leave}
                    onChange={(next) =>
                      void updateConfig({ sync_on_leave: next })
                    }
                    label="Sync when leaving the app"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 text-sm">
                    Seconds after an edit
                    <span className="block text-xs text-content-muted">
                      How soon a change goes up. Short keeps the two devices
                      from editing the same thing apart.
                    </span>
                  </span>
                  <NumberField
                    value={config.sync_debounce_seconds}
                    min={5}
                    max={3600}
                    onCommit={(next) =>
                      void updateConfig({ sync_debounce_seconds: next })
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">Interval (minutes)</span>
                  <NumberField
                    value={config.sync_interval_minutes}
                    min={1}
                    max={720}
                    onCommit={(next) =>
                      void updateConfig({ sync_interval_minutes: next })
                    }
                  />
                </div>
              </>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-sm">
                Stop if this % vanishes at once
                <span className="block text-xs text-content-muted">
                  A wiped Drive folder or another account looks like
                  everything being deleted. 100 turns the check off.
                </span>
              </span>
              <NumberField
                value={config.sync_mass_delete_guard_percent}
                min={5}
                max={100}
                onCommit={(next) =>
                  void updateConfig({ sync_mass_delete_guard_percent: next })
                }
              />
            </div>
          </>
        )}
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setGoogle(await invoke("google_sign_out"));
              setSync(null);
            })
          }
          className="mt-2 rounded-lg border border-danger/50 px-4 py-3 text-danger disabled:opacity-50"
        >
          Sign out
        </button>
        <p className="text-xs text-content-muted">
          Signing out stops syncing; the vault on this phone stays as it is.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Conflicts</h2>
          {conflicts.length > 0 && (
            <button
              onClick={() =>
                void invoke("sync_conflicts_clear").then(() => setConflicts([]))
              }
              className="text-sm text-content-muted"
            >
              Clear
            </button>
          )}
        </div>
        {conflicts.length === 0 ? (
          <p className="text-sm text-content-muted">
            Nothing has had to be decided between two devices.
          </p>
        ) : (
          <>
            <button
              onClick={() => setShowConflicts((v) => !v)}
              className={`self-start text-sm ${
                openConflicts > 0 ? "font-medium text-warn" : "text-accent"
              }`}
            >
              {openConflicts > 0
                ? `${openConflicts} to review · `
                : ""}
              {conflicts.length} decision{conflicts.length === 1 ? "" : "s"}{" "}
              {showConflicts ? "▴" : "▾"}
            </button>
            {showConflicts && <ConflictList entries={conflicts} />}
          </>
        )}
      </section>
    </div>
  );
}

function AppearancePanel({ config }: { config: AppConfig }) {
  const updateConfig = useAppStore((s) => s.updateConfig);
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm">Theme</span>
        <select
          value={config.theme}
          onChange={(e) =>
            void updateConfig({
              theme: e.target.value as typeof config.theme,
            })
          }
          className="rounded-lg border border-line bg-surface-alt px-3 py-2"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm">Text size</span>
        <NumberField
          value={config.ui_font_size}
          min={10}
          max={24}
          onCommit={(next) => void updateConfig({ ui_font_size: next })}
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">Cadence colours</span>
        <Toggle
          checked={config.cadence_colors}
          onChange={(next) => void updateConfig({ cadence_colors: next })}
          label="Cadence colours"
        />
      </div>
      {config.cadence_colors && (
        <div className="flex flex-wrap gap-3">
          {(
            [
              ["Daily", "cadence_color_daily"],
              ["Weekly", "cadence_color_weekly"],
              ["Monthly", "cadence_color_monthly"],
              ["Yearly", "cadence_color_yearly"],
              ["Exact", "cadence_color_exact"],
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="color"
                value={config[key]}
                onChange={(e) => void updateConfig({ [key]: e.target.value })}
                className="h-8 w-10 rounded border border-line bg-surface-alt"
              />
              {label}
            </label>
          ))}
        </div>
      )}
      {/* Column counts, pane splits and saved profiles are absent on
          purpose: they describe a window, and this app's window on a
          phone is the phone. A layout tab here would be a list of
          settings that change nothing visible. */}
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <span className="text-sm">Screen edges</span>
        <p className="text-xs text-content-muted">
          Android draws this app under the status bar and the navigation
          bar, and the layout normally learns where they are from the
          system. If the header still sits under the clock, or the tabs
          under the gesture bar, raise these until it clears. 0 means "trust
          the system".
        </p>
        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="text-sm">Top</span>
            <NumberField
              value={config.mobile_safe_area_top}
              min={0}
              max={200}
              onCommit={(next) =>
                void updateConfig({ mobile_safe_area_top: next })
              }
            />
          </label>
          <label className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="text-sm">Bottom</span>
            <NumberField
              value={config.mobile_safe_area_bottom}
              min={0}
              max={200}
              onCommit={(next) =>
                void updateConfig({ mobile_safe_area_bottom: next })
              }
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function TasksPanel({ config }: { config: AppConfig }) {
  const updateConfig = useAppStore((s) => s.updateConfig);
  const setError = useAppStore((s) => s.setError);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-content-muted">
        The engine generates recurring, scheduled and birthday tasks. It runs
        when the app comes to the foreground.
      </p>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void useAppStore
            .getState()
            .runEngine()
            .then(() => useAppStore.getState().refresh())
            .catch((e) => setError(errorMessage(e)))
            .finally(() => setBusy(false));
        }}
        className="rounded-lg border border-line px-4 py-3 disabled:opacity-50"
      >
        Run the engine now
      </button>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="text-sm">System notifications for due tasks</span>
        <Toggle
          checked={config.notify_system}
          onChange={(next) => void updateConfig({ notify_system: next })}
          label="System notifications for due tasks"
        />
      </div>
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm">Snooze reminders for (min)</span>
        <NumberField
          value={config.notify_snooze_minutes}
          min={1}
          max={240}
          onCommit={(next) =>
            void updateConfig({ notify_snooze_minutes: next })
          }
        />
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-sm">
          Done tasks on the day screen
          <span className="block text-xs text-content-muted">
            In place keeps them inside their daily/weekly sections.
          </span>
        </span>
        <select
          value={config.done_display}
          onChange={(e) =>
            void updateConfig({
              done_display: e.target.value as AppConfig["done_display"],
            })
          }
          className="rounded-lg border border-line bg-surface-alt px-3 py-2"
        >
          <option value="inline">In place</option>
          <option value="separate">Own Done section</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm">Quick-capture list</span>
        <input
          defaultValue={config.capture_list}
          onBlur={(e) => {
            if (e.target.value !== config.capture_list)
              void updateConfig({ capture_list: e.target.value });
          }}
          className="w-36 rounded-lg border border-line bg-surface-alt px-3 py-2"
        />
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-sm">
          Keep done history (days)
          <span className="block text-xs text-content-muted">
            0 keeps it forever.
          </span>
        </span>
        <NumberField
          value={config.retention_days}
          min={0}
          max={3650}
          onCommit={(next) => void updateConfig({ retention_days: next })}
        />
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm">Catch up missed rules (days)</span>
        <NumberField
          value={config.catchup_days}
          min={0}
          max={365}
          onCommit={(next) => void updateConfig({ catchup_days: next })}
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">Ignore cron time of day</span>
        <Toggle
          checked={config.cron_ignore_time}
          onChange={(next) => void updateConfig({ cron_ignore_time: next })}
          label="Ignore cron time of day"
        />
      </div>
    </div>
  );
}

function VaultPanel({ vaultPath }: { vaultPath: string | null }) {
  const [folder, setFolder] = useState(false);
  // hardware back closes the vault-folder chooser before leaving the panel
  useBackStep(folder, () => setFolder(false));
  return (
    <div className="flex flex-col gap-1">
      <p className="break-all text-xs text-content-muted">
        {vaultPath ?? "none"}
      </p>
      <p className="text-xs text-content-muted">
        The vault lives on this device. Its database is rebuilt here from the
        text files and is never uploaded.
      </p>
      <button
        onClick={() => setFolder(true)}
        className="mt-2 self-start rounded-lg border border-line px-4 py-2 text-sm"
      >
        Move to another folder
      </button>
      {folder && (
        <MobileVaultFolder
          onChosen={() => setFolder(false)}
          onCancel={() => setFolder(false)}
        />
      )}
    </div>
  );
}

/**
 * The desktop Data tab's cleanup and restores, sized for a thumb: delete-done sweep,
 * archived-list restore, and the restore lists for both backup kinds.
 * Destructive actions confirm through the in-app ConfirmModal (the
 * WebView's native confirm is unstyled and, on Android, easy to dismiss
 * by accident); the dialog names what it is about to do.
 */
function MaintenancePanel() {
  const setError = useAppStore((s) => s.setError);
  const [archived, setArchived] = useState<List[]>([]);
  const [backups, setBackups] = useState<BackupsOverview | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    label: string;
    run: () => void;
  } | null>(null);

  const load = useCallback(() => {
    void invoke("lists_archived")
      .then(setArchived)
      .catch((e) => setError(errorMessage(e)));
    void invoke("backups_list")
      .then(setBackups)
      .catch((e) => setError(errorMessage(e)));
  }, [setError]);

  useEffect(load, [load]);

  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    try {
      await run();
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteDone = () =>
    setConfirm({
      title: "Delete every task marked done?",
      message: "This cannot be undone.",
      label: "Delete",
      run: () =>
        void act(async () => {
          const deleted = await invoke("tasks_delete_done");
          setStatus(`Deleted ${deleted} done task(s)`);
          await useAppStore.getState().refresh();
        }),
    });

  const restoreList = (id: number) =>
    void act(async () => {
      await invoke("list_unarchive", { id });
      await useAppStore.getState().refresh();
    });

  const restoreDb = (entry: BackupEntry) =>
    setConfirm({
      title: `Restore the database from ${entry.label}?`,
      message:
        "Everything created after it will be gone. The current database is kept as its own snapshot first.",
      label: "Restore",
      run: () =>
        void act(async () => {
      // the whole database is being swapped: reload config, then rerun
      // the engine and refetch every view, same as opening a vault
      const config = await invoke("backup_restore_db", {
        id: entry.id,
      });
      useAppStore.setState({ config });
      await useAppStore.getState().runEngine();
      await useAppStore.getState().refresh();
      setStatus(`Restored database from ${entry.label}`);
        }),
    });

  const restoreConfig = (entry: BackupEntry) =>
    setConfirm({
      title: `Restore ${entry.label} from ${entry.modified}?`,
      message: "The file currently on disk is kept as its own backup first.",
      label: "Restore",
      run: () =>
        void act(async () => {
          await invoke("backup_restore_config", { id: entry.id });
          setStatus(`Restored ${entry.label} - changes apply in a moment`);
        }),
    });

  const backupList = (
    title: string,
    entries: BackupEntry[],
    onRestore: (entry: BackupEntry) => void,
  ) => (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-content-muted">
        {title}
      </span>
      {entries.length === 0 ? (
        <p className="text-xs text-content-muted">No snapshots yet.</p>
      ) : (
        entries.map((entry) => (
          <div key={entry.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            <span className="shrink-0 text-xs text-content-muted">
              {entry.modified}
            </span>
            <button
              disabled={busy}
              onClick={() => onRestore(entry)}
              className="shrink-0 rounded border border-line px-2 py-1 text-xs disabled:opacity-50"
            >
              Restore
            </button>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            confirm.run();
          }}
        />
      )}
      {status && <p className="text-xs text-content-muted">{status}</p>}
      <button
        disabled={busy}
        onClick={deleteDone}
        className="rounded-lg border border-danger/50 px-4 py-2 text-danger disabled:opacity-50"
      >
        Delete all done tasks
      </button>
      {archived.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-content-muted">
            Archived lists
          </span>
          {archived.map((list) => (
            <div key={list.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{list.name}</span>
              <button
                disabled={busy}
                onClick={() => restoreList(list.id)}
                className="shrink-0 rounded border border-line px-2 py-1 text-xs disabled:opacity-50"
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
      {backups && (
        <>
          {backupList("Database snapshots", backups.db, restoreDb)}
          {backupList("Config file backups", backups.config, restoreConfig)}
        </>
      )}
    </div>
  );
}
