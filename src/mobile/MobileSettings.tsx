import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store";
import type { DropboxPull, DropboxStatus } from "../types";

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
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void invoke<DropboxStatus>("dropbox_status").then(setStatus).catch(() => {});
    const unlisten = listen<[number, number]>("dropbox-pull-progress", (e) =>
      setProgress(e.payload),
    );
    return () => void unlisten.then((fn) => fn());
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setProgress(null);
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
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setPull(await invoke<DropboxPull>("dropbox_pull_vault"));
              await useAppStore.getState().refresh();
            })
          }
          className="rounded-lg bg-accent px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Pulling..." : "Pull latest from Dropbox"}
        </button>
        {progress && (
          <p className="text-sm text-content-muted">
            {progress[0]} / {progress[1]} files
          </p>
        )}
        {pull && (
          <p className="text-sm">
            Pulled {pull.files}, skipped {pull.skipped} already current
            {pull.failed.length > 0 && `, ${pull.failed.length} failed`}.
          </p>
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
          This is the local copy on this device. The database is rebuilt
          here and never uploaded.
        </p>
      </section>
    </div>
  );
}
