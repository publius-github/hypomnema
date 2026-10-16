import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Toggle } from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
import ConflictList from "../../components/ConflictList";
import { errorKind, errorMessage, invoke } from "../../lib/ipc";
import { useAppStore } from "../../store";
import type {
  ConflictEntry,
  SyncSummary,
  GoogleStatus,
  SyncActivity,
  SyncStanding,
} from "../../types";

/**
 * A vault inside a folder another client already syncs would be synced
 * twice - by that client and by this app - and the two fight over every
 * file. Spotted from the path alone, so the warning costs nothing.
 */
export function syncedByAnotherClient(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split(/[\\/]/).map((p) => p.toLowerCase());
  if (parts.some((p) => p === "dropbox" || p.startsWith("dropbox ("))) {
    return "Dropbox";
  }
  if (parts.some((p) => p === "onedrive" || p.startsWith("onedrive - "))) {
    return "OneDrive";
  }
  if (parts.some((p) => p === "google drive" || p === "my drive")) {
    return "Google Drive for desktop";
  }
  return null;
}

function when(at: string): string {
  return at.slice(0, 16).replace("T", " ");
}

/**
 * Google sign-in and the desktop's own sync: who is signed in, whether
 * this device is in step, and when passes run on their own.
 */
export default function SyncTab() {
  const vaultPath = useAppStore((s) => s.vaultPath);
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [standing, setStanding] = useState<SyncStanding | null>(null);
  const [conflicts, setConflicts] = useState<ConflictEntry[]>([]);
  const [signingIn, setSigningIn] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncSummary | null>(null);
  const [wiped, setWiped] = useState(false);

  const loadStanding = useCallback(() => {
    void invoke("sync_standing")
      .then(setStanding)
      .catch(() => setStanding(null));
    void invoke("sync_conflicts_list")
      .then(setConflicts)
      .catch(() => setConflicts([]));
  }, []);

  useEffect(() => {
    void invoke("google_status")
      .then(setGoogle)
      .catch((e) => useAppStore.getState().setError(errorMessage(e)));
    loadStanding();
    // passes started by the scheduler report here too
    const unlisten = listen<SyncActivity>("sync-status", (event) => {
      setRunning(event.payload.running);
      if (!event.payload.running) loadStanding();
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [loadStanding]);

  const signIn = async () => {
    setSigningIn(true);
    try {
      setGoogle(await invoke("google_sign_in"));
      loadStanding();
    } catch (e) {
      useAppStore.getState().setError(errorMessage(e));
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    try {
      setGoogle(await invoke("google_sign_out"));
      setResult(null);
      loadStanding();
    } catch (e) {
      useAppStore.getState().setError(errorMessage(e));
    }
  };

  const syncNow = async (resetFirst = false) => {
    setRunning(true);
    setWiped(false);
    try {
      if (resetFirst) await invoke("sync_reset_space");
      setResult(await invoke("sync_now"));
      await useAppStore.getState().refresh();
    } catch (e) {
      if (errorKind(e) === "remote_wiped") setWiped(true);
      else useAppStore.getState().setError(errorMessage(e));
    } finally {
      setRunning(false);
      loadStanding();
    }
  };

  if (!config) return null;
  const otherClient = syncedByAnotherClient(vaultPath);

  return (
    <>
      <SettingsGroup id="sync.account">
        {google && !google.available && !google.signed_in && (
          <p className="text-sm text-content-muted">
            This build cannot sign in to Google (it was built without the
            Google client secret).
          </p>
        )}
        {google?.signed_in ? (
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-sm">
                Signed in as{" "}
                <span className="select-text font-medium">{google.email}</span>
                {google.name && (
                  <span className="text-content-muted"> ({google.name})</span>
                )}
              </span>
              <button
                className="btn-ghost shrink-0 px-3 py-1 text-xs"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </div>
            <p className="text-xs text-content-muted">
              The vault is kept in a hidden app folder in this account's
              Google Drive. Another device signed in to the same account
              syncs with it.
            </p>
          </section>
        ) : (
          google?.available && (
            <section className="flex flex-col gap-2">
              <p className="text-xs text-content-muted">
                Optional. Signing in keeps this vault in step with your other
                devices through a hidden app folder in your Google Drive; the
                app sees nothing else there.
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="btn-primary w-fit px-3 py-1 text-sm disabled:opacity-50"
                  disabled={signingIn}
                  onClick={() => void signIn()}
                >
                  {signingIn ? "Waiting for the browser..." : "Sign in with Google"}
                </button>
                {signingIn && (
                  <button
                    className="btn-ghost px-3 py-1 text-xs"
                    onClick={() => void invoke("google_sign_in_cancel")}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </section>
          )
        )}

        {otherClient && (
          <p className="rounded border border-warn/40 bg-warn/10 p-2 text-xs">
            This vault sits inside a {otherClient} folder. With Google sync on
            as well, two programs would sync the same files and fight over
            them - move the vault out of that folder first.
          </p>
        )}

        {google?.signed_in && (
          <section className="flex flex-col gap-2">
            {standing && (
              <p className="text-sm">
                {standing.pending === 0
                  ? "Nothing waiting to go up."
                  : `${standing.pending} change${
                      standing.pending === 1 ? "" : "s"
                    } waiting to go up.`}
                {standing.last_pass_at && (
                  <span className="block text-xs text-content-muted">
                    Last sync {when(standing.last_pass_at)}
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
              className="btn-primary w-fit px-3 py-1 text-sm disabled:opacity-50"
              disabled={running}
              onClick={() => void syncNow()}
            >
              {running ? "Syncing..." : "Sync now"}
            </button>
            {wiped && (
              <div className="flex flex-col gap-2 rounded border border-warn/40 bg-warn/10 p-2 text-xs">
                <p>
                  Most of what this device had synced is gone from Google
                  Drive at once, so nothing was deleted here. If the Drive
                  copy was wiped, upload this vault again; if the deletions
                  were intended, raise the limit below and sync.
                </p>
                <button
                  className="btn-ghost w-fit px-3 py-1 text-xs"
                  disabled={running}
                  onClick={() => void syncNow(true)}
                >
                  Upload this vault again
                </button>
              </div>
            )}
            {result && (
              <p className="text-xs text-content-muted">
                {result.downloaded} in, {result.uploaded} out
                {result.merged > 0 && `, ${result.merged} merged`}
                {result.removed_locally + result.removed_remotely > 0 &&
                  `, ${result.removed_locally + result.removed_remotely} removed`}
                .
                {result.conflicted_copies.length > 0 && (
                  <span className="block text-warn">
                    Kept aside: {result.conflicted_copies.join(", ")}
                  </span>
                )}
                {result.failed.length > 0 && (
                  <span className="block text-danger">
                    Failed: {result.failed.join(", ")}
                  </span>
                )}
              </p>
            )}
          </section>
        )}

        {conflicts.length > 0 && (
          <section className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm font-medium">
                Sync conflicts ({conflicts.length}
                {conflicts.some((c) => c.open) &&
                  `, ${conflicts.filter((c) => c.open).length} to review`}
                )
              </span>
              <button
                className="btn-ghost px-2 py-0.5 text-xs"
                onClick={() =>
                  void invoke("sync_conflicts_clear").then(loadStanding)
                }
              >
                Clear
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              <ConflictList
                entries={conflicts}
                compact
                onChanged={loadStanding}
              />
            </div>
          </section>
        )}
      </SettingsGroup>

      <SettingsGroup id="sync.schedule">
        <Toggle
          checked={config.sync_auto}
          label="Sync automatically"
          hint="Passes run on their own while signed in: at start, every few minutes, shortly after edits, when the window comes to the front and on quit. Off leaves only Sync now. The timings are in app.yml (Notes > Config)."
          onChange={(v) => void updateConfig({ sync_auto: v })}
        />
      </SettingsGroup>
    </>
  );
}
