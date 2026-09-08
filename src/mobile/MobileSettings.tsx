import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store";
import type {
  ConflictEntry,
  DropboxPull,
  DropboxStatus,
  DropboxSync,
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
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadConflicts = useCallback(() => {
    void invoke<ConflictEntry[]>("sync_conflicts_list")
      .then(setConflicts)
      .catch(() => {});
  }, []);

  useEffect(() => {
    void invoke<DropboxStatus>("dropbox_status").then(setStatus).catch(() => {});
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
                void invoke("sync_conflicts_clear").then(() =>
                  setConflicts([]),
                )
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

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Engine</h2>
        <p className="text-sm text-content-muted">
          Generates recurring, scheduled and birthday tasks. Runs when the
          app comes to the foreground.
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
          The vault lives on this device. Its database is rebuilt here from
          the text files and is never uploaded. To load an existing vault,
          copy its contents into the folder above from a computer.
        </p>
      </section>
    </div>
  );
}
