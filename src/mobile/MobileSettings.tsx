import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store";
import { LockSettings } from "./MobileLock";

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
  ConflictEntry,
  DropboxPull,
  DropboxStatus,
  DropboxSync,
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

      <section className="flex flex-col gap-1">
        <h2 className="font-semibold">Vault</h2>
        <p className="break-all text-xs text-content-muted">
          {vaultPath ?? "none"}
        </p>
        <p className="text-xs text-content-muted">
          The vault lives on this device. Its database is rebuilt here from the
          text files and is never uploaded. To load an existing vault, copy its
          contents into the folder above from a computer.
        </p>
      </section>
    </div>
  );
}
