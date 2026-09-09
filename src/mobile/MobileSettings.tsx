import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store";
import { LockSettings } from "./MobileLock";
import MobileVaultFolder from "./MobileVaultFolder";

/** Matches THEME_PRESETS in src-tauri/src/config.rs. */
const THEME_PRESETS = [
  "default",
  "black",
  "vscode",
  "nord",
  "gruvbox",
  "solarized",
] as const;
import type {
  AppConfig,
  BackupEntry,
  BackupsOverview,
  ConflictEntry,
  DropboxPull,
  DropboxStatus,
  DropboxSync,
  List,
  LockState,
  SyncStanding,
} from "../types";

/**
 * Phone settings: the sync link, and the handful of switches that mean
 * something on a phone. The desktop's appearance, layout and profile
 * tabs are deliberately absent - they describe a window, and this does
 * not have one (ROADMAP.md Phase 5 revisits them).
 */
export default function MobileSettings() {
  const vaultPath = useAppStore((s) => s.vaultPath);
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const setError = useAppStore((s) => s.setError);
  const [status, setStatus] = useState<DropboxStatus | null>(null);
  const [pull, setPull] = useState<DropboxPull | null>(null);
  const [sync, setSync] = useState<DropboxSync | null>(null);
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [showConflicts, setShowConflicts] = useState(false);
  const [standing, setStanding] = useState<SyncStanding | null>(null);
  const [lock, setLock] = useState<LockState | null>(null);
  const [folder, setFolder] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadConflicts = useCallback(() => {
    void invoke<ConflictEntry[]>("sync_conflicts_list")
      .then(setConflicts)
      .catch(() => {});
    void invoke<SyncStanding>("sync_standing")
      .then(setStanding)
      .catch(() => {});
  }, []);

  useEffect(() => {
    void invoke<DropboxStatus>("dropbox_status")
      .then(setStatus)
      .catch(() => {});
    void invoke<LockState>("app_lock_state")
      .then(setLock)
      .catch(() => {});
    loadConflicts();
    const unlisten = Promise.all([
      listen<[number, number]>("dropbox-pull-progress", (e) =>
        setProgress(e.payload),
      ),
      listen<[number, number]>("dropbox-sync-progress", (e) =>
        setProgress(e.payload),
      ),
    ]);
    return () => void unlisten.then((fns) => fns.forEach((fn) => fn()));
  }, [loadConflicts]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setProgress(null);
      loadConflicts();
    }
  };

  return (
    <div className="flex flex-col gap-6 px-4 py-5">
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Dropbox</h2>
        <p className="text-sm text-content-muted">
          {status?.connected
            ? `Linked. Token refreshes in ${Math.round(
                status.expires_in_secs / 60,
              )} min.`
            : "Not linked."}
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
        {/* One button for the everyday case. Pull and push exist below
            for the two moments they are actually the right verb: setting
            a device up, and forcing this device's copy upward. */}
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setSync(await invoke<DropboxSync>("dropbox_sync"));
              await useAppStore.getState().refresh();
            })
          }
          className="rounded-lg bg-accent px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Syncing..." : "Sync now"}
        </button>
        {progress && (
          <p className="text-sm text-content-muted">
            {progress[0]} / {progress[1]} files
          </p>
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
            <label className="flex items-center justify-between gap-3 pt-1">
              <span className="text-sm">Sync automatically</span>
              <input
                type="checkbox"
                checked={config.sync_auto}
                onChange={(e) =>
                  void updateConfig({ sync_auto: e.target.checked })
                }
                className="h-6 w-6"
              />
            </label>
            {config.sync_auto && (
              <>
                <label className="flex items-center justify-between gap-3">
                  <span className="min-w-0 text-sm">
                    Also when leaving the app
                    <span className="block text-xs text-content-muted">
                      Android freezes a backgrounded app; without this the last
                      thing you did waits here until you come back.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={config.sync_on_leave}
                    onChange={(e) =>
                      void updateConfig({ sync_on_leave: e.target.checked })
                    }
                    className="h-6 w-6 shrink-0"
                  />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm">Every, minutes</span>
                  <input
                    type="number"
                    min={1}
                    max={720}
                    value={config.sync_interval_minutes}
                    onChange={(e) =>
                      void updateConfig({
                        sync_interval_minutes: Number(e.target.value) || 15,
                      })
                    }
                    className="w-20 rounded-lg border border-line bg-surface-alt px-3 py-2"
                  />
                </label>
              </>
            )}
          </>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer py-2 text-content-muted">
            One-way actions
          </summary>
          <div className="flex flex-col gap-2 pt-1">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setPull(await invoke<DropboxPull>("dropbox_pull_vault"));
                  await useAppStore.getState().refresh();
                })
              }
              className="rounded-lg border border-line px-4 py-3 disabled:opacity-50"
            >
              Pull the whole vault down
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await invoke("dropbox_push_vault");
                })
              }
              className="rounded-lg border border-line px-4 py-3 disabled:opacity-50"
            >
              Push this device's changes up
            </button>
            {pull && (
              <p>
                Pulled {pull.files}, skipped {pull.skipped} already current
                {pull.failed.length > 0 && `, ${pull.failed.length} failed`}.
              </p>
            )}
          </div>
        </details>
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
              className="self-start text-sm text-accent"
            >
              {conflicts.length} decision{conflicts.length === 1 ? "" : "s"}{" "}
              {showConflicts ? "▴" : "▾"}
            </button>
            {showConflicts && (
              <ul className="flex flex-col gap-3">
                {conflicts.map((entry, i) => (
                  <li
                    key={`${entry.at}-${entry.path}-${entry.field}-${i}`}
                    className="rounded-lg border border-line p-3 text-sm"
                  >
                    <div className="break-all font-medium">{entry.path}</div>
                    <div className="text-xs text-content-muted">
                      {entry.field} · {entry.at.slice(0, 16).replace("T", " ")}
                    </div>
                    <div className="mt-2 break-words">
                      <span className="text-content-muted">Kept: </span>
                      {entry.kept}
                      {entry.kept_by && ` (${entry.kept_by})`}
                    </div>
                    <div className="break-words text-warn">
                      <span className="text-content-muted">Dropped: </span>
                      {entry.discarded}
                      {entry.discarded_by && ` (${entry.discarded_by})`}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {lock && <LockSettings state={lock} onChange={setLock} />}

      {config && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Appearance</h2>
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
            <span className="text-sm">Palette</span>
            <select
              value={config.theme_preset}
              onChange={(e) =>
                void updateConfig({
                  theme_preset: e.target.value as typeof config.theme_preset,
                })
              }
              className="rounded-lg border border-line bg-surface-alt px-3 py-2"
            >
              {THEME_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Text size</span>
            <input
              type="number"
              min={10}
              max={24}
              value={config.ui_font_size}
              onChange={(e) =>
                void updateConfig({
                  ui_font_size: Number(e.target.value) || 14,
                })
              }
              className="w-20 rounded-lg border border-line bg-surface-alt px-3 py-2"
            />
          </label>
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
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={config.mobile_safe_area_top}
                  onChange={(e) =>
                    void updateConfig({
                      mobile_safe_area_top: Number(e.target.value) || 0,
                    })
                  }
                  className="w-20 rounded-lg border border-line bg-surface-alt px-3 py-2"
                />
              </label>
              <label className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="text-sm">Bottom</span>
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={config.mobile_safe_area_bottom}
                  onChange={(e) =>
                    void updateConfig({
                      mobile_safe_area_bottom: Number(e.target.value) || 0,
                    })
                  }
                  className="w-20 rounded-lg border border-line bg-surface-alt px-3 py-2"
                />
              </label>
            </div>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Engine</h2>
        <p className="text-sm text-content-muted">
          Generates recurring, scheduled and birthday tasks. Runs when the app
          comes to the foreground.
        </p>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await useAppStore.getState().runEngine();
              await useAppStore.getState().refresh();
            })
          }
          className="rounded-lg border border-line px-4 py-3 disabled:opacity-50"
        >
          Run now
        </button>
        {config && (
          <label className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm">System notifications for due tasks</span>
            <input
              type="checkbox"
              checked={config.notify_system}
              onChange={(e) =>
                void updateConfig({ notify_system: e.target.checked })
              }
              className="h-6 w-6"
            />
          </label>
        )}
      </section>

      {config && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Advanced</h2>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Snooze reminders for (min)</span>
            <input
              type="number"
              min={1}
              max={240}
              value={config.notify_snooze_minutes}
              onChange={(e) =>
                void updateConfig({
                  notify_snooze_minutes: Number(e.target.value) || 10,
                })
              }
              className="w-20 rounded-lg border border-line bg-surface-alt px-3 py-2"
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Quick-capture list</span>
            <input
              value={config.capture_list}
              onChange={(e) =>
                void updateConfig({ capture_list: e.target.value })
              }
              className="w-36 rounded-lg border border-line bg-surface-alt px-3 py-2"
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Keep done history for (days, 0 = forever)</span>
            <input
              type="number"
              min={0}
              max={3650}
              value={config.retention_days}
              onChange={(e) =>
                void updateConfig({
                  retention_days: Number(e.target.value) || 0,
                })
              }
              className="w-20 rounded-lg border border-line bg-surface-alt px-3 py-2"
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Catch up missed rules (days)</span>
            <input
              type="number"
              min={0}
              max={365}
              value={config.catchup_days}
              onChange={(e) =>
                void updateConfig({
                  catchup_days: Number(e.target.value) || 0,
                })
              }
              className="w-20 rounded-lg border border-line bg-surface-alt px-3 py-2"
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Ignore cron time of day</span>
            <input
              type="checkbox"
              checked={config.cron_ignore_time}
              onChange={(e) =>
                void updateConfig({ cron_ignore_time: e.target.checked })
              }
              className="h-6 w-6"
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Cadence colours</span>
            <input
              type="checkbox"
              checked={config.cadence_colors}
              onChange={(e) =>
                void updateConfig({ cadence_colors: e.target.checked })
              }
              className="h-6 w-6"
            />
          </label>
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
                    onChange={(e) =>
                      void updateConfig({ [key]: e.target.value })
                    }
                    className="h-8 w-10 rounded border border-line bg-surface-alt"
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      <MaintenanceSection />

      <section className="flex flex-col gap-1">
        <h2 className="font-semibold">Vault</h2>
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
      </section>
    </div>
  );
}

/**
 * The desktop Maintenance tab, sized for a thumb: delete-done sweep,
 * archived-list restore, and the restore lists for both backup kinds.
 * Confirms go through window.confirm - a custom dialog would cover the
 * very list the action refers to.
 */
function MaintenanceSection() {
  const setError = useAppStore((s) => s.setError);
  const [archived, setArchived] = useState<List[]>([]);
  const [backups, setBackups] = useState<BackupsOverview | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void invoke<List[]>("lists_archived")
      .then(setArchived)
      .catch((e) => setError(String(e)));
    void invoke<BackupsOverview>("backups_list")
      .then(setBackups)
      .catch((e) => setError(String(e)));
  }, [setError]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    try {
      await run();
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteDone = () => {
    if (!window.confirm("Delete every task marked done? This cannot be undone."))
      return;
    void act(async () => {
      const deleted = await invoke<number>("tasks_delete_done");
      setStatus(`Deleted ${deleted} done task(s)`);
      await useAppStore.getState().refresh();
    });
  };

  const restoreList = (id: number) =>
    void act(async () => {
      await invoke("list_unarchive", { id });
      await useAppStore.getState().refresh();
    });

  const restoreDb = (entry: BackupEntry) => {
    if (
      !window.confirm(
        `Restore the database from ${entry.label}? Everything created after it will be gone. The current database is kept as its own snapshot first.`,
      )
    )
      return;
    void act(async () => {
      // the whole database is being swapped: reload config, then rerun
      // the engine and refetch every view, same as opening a vault
      const config = await invoke<AppConfig>("backup_restore_db", {
        id: entry.id,
      });
      useAppStore.setState({ config });
      await useAppStore.getState().runEngine();
      await useAppStore.getState().refresh();
      setStatus(`Restored database from ${entry.label}`);
    });
  };

  const restoreConfig = (entry: BackupEntry) => {
    if (
      !window.confirm(
        `Restore ${entry.label} from ${entry.modified}? The file currently on disk is kept as its own backup first.`,
      )
    )
      return;
    void act(async () => {
      await invoke("backup_restore_config", { id: entry.id });
      setStatus(`Restored ${entry.label} - changes apply in a moment`);
    });
  };

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
    <section className="flex flex-col gap-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between text-left"
      >
        <h2 className="font-semibold">Maintenance</h2>
        <span className="text-content-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <>
          {status && (
            <p className="text-xs text-content-muted">{status}</p>
          )}
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
        </>
      )}
    </section>
  );
}
