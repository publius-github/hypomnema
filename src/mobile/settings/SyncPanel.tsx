import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { errorKind, errorMessage, invoke } from "../../lib/ipc";
import { useAppStore } from "../../store";
import ConflictList from "../../components/ConflictList";
import GoogleSignInButton from "../../components/GoogleSignInButton";
import type {
  ConflictEntry,
  GoogleStatus,
  SyncStanding,
  SyncSummary,
} from "../../types";
import { ActionRow, Section, Sheet, SwitchRow } from "./rows";

/**
 * The Google sync panel. Signed out, it is the sign-in - the first-run
 * screen promises "it can be turned on later, from Settings", and this
 * is where that promise is kept. Signed in, it is the everyday sync
 * button plus the switches.
 */
export default function SyncPanel({
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
      <div className="flex flex-col gap-3 px-4 py-4">
        <p className="text-sm text-content-muted">
          Optional. Signing in keeps this vault in step with your other devices
          through a hidden app folder in your Google Drive; the app sees
          nothing else there. Sign in with the same account on every device.
        </p>
        <GoogleSignInButton
          disabled={google?.available === false}
          busy={busy}
          onClick={() => void signIn()}
          className="justify-center"
        />
        {progress && (
          <p className="text-sm text-content-muted">
            {progress[0]} / {progress[1]} files
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2 px-4 pt-4">
        <p className="text-sm">
          {google.email}
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
              <span className="block wrap-break-word text-xs text-warn">
                {standing.last_error}
              </span>
            )}
          </p>
        )}
        <button
          disabled={busy}
          onClick={() => void syncNow()}
          className="rounded-lg bg-accent-fill px-4 py-3 font-medium text-white disabled:opacity-50"
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
              the limit in app.yml and sync.
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
      </div>

      {config && (
        <Section title="Settings">
          <SwitchRow
            label="Sync automatically"
            hint="On launch, on return, on leaving, after edits and every few minutes"
            checked={config.sync_auto}
            onChange={(v) => void updateConfig({ sync_auto: v })}
          />
          <SwitchRow
            label="Sync task card settings"
            hint="Settings > Tasks as on your other devices; off keeps this phone's own"
            checked={config.sync_card_settings}
            onChange={(v) => void updateConfig({ sync_card_settings: v })}
          />
        </Section>
      )}

      <Section title="Conflicts">
        <ActionRow
          label={
            conflicts.length === 0
              ? "No conflicts"
              : `${conflicts.length} decision${conflicts.length === 1 ? "" : "s"}`
          }
          hint={
            openConflicts > 0 ? (
              <span className="text-warn">{openConflicts} to review</span>
            ) : conflicts.length === 0 ? (
              "Nothing has had to be decided between two devices"
            ) : undefined
          }
          disabled={conflicts.length === 0}
          trailing={conflicts.length === 0 ? null : "›"}
          onClick={() => setShowConflicts(true)}
        />
      </Section>

      <Section footer="Signing out stops syncing; the vault on this phone stays as it is.">
        <ActionRow
          label="Sign out"
          danger
          disabled={busy}
          trailing={null}
          onClick={() =>
            void run(async () => {
              setGoogle(await invoke("google_sign_out"));
              setSync(null);
            })
          }
        />
      </Section>

      {showConflicts && (
        <Sheet title="Conflicts" onClose={() => setShowConflicts(false)}>
          <div className="px-4 pb-4">
            <ConflictList entries={conflicts} onChanged={reload} />
            <button
              onClick={() =>
                void invoke("sync_conflicts_clear").then(() => {
                  setConflicts([]);
                  setShowConflicts(false);
                })
              }
              className="mt-3 w-full rounded-lg border border-line px-4 py-2 text-sm text-content-muted"
            >
              Clear the log
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
