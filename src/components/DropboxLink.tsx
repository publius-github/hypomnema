import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DropboxListing, DropboxPull, DropboxStatus } from "../types";

/**
 * Android vault linking (docs/android/ROADMAP.md Phase 2). A phone has no
 * synced Dropbox folder to point a file picker at - Spike A settled that -
 * so the vault is reached through the Dropbox API instead, and this screen
 * is where the device gets authorized.
 *
 * The code is pasted by hand on purpose: the authorize URL asks for no
 * redirect, so Dropbox shows the code on its own page and nothing here
 * depends on an intent-filter surviving `tauri android init`. Swapping in
 * a real redirect later only changes how `code` arrives.
 */
export default function DropboxLink() {
  const [status, setStatus] = useState<DropboxStatus | null>(null);
  const [code, setCode] = useState("");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [listing, setListing] = useState<DropboxListing | null>(null);
  const [marker, setMarker] = useState<string | null>(null);
  const [pull, setPull] = useState<DropboxPull | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A pull is hundreds of round trips; the backend reports how far it
  // has got so this does not look like a frozen screen.
  useEffect(() => {
    const unlisten = listen<[number, number]>("dropbox-pull-progress", (e) =>
      setProgress(e.payload),
    );
    return () => void unlisten.then((fn) => fn());
  }, []);

  useEffect(() => {
    void invoke<DropboxStatus>("dropbox_status")
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);

  /** Every action here is one round trip that can fail; funnel them. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const startAuth = () =>
    run(async () => {
      const url = await invoke<string>("dropbox_auth_url");
      await openUrl(url);
      setAwaitingCode(true);
    });

  const connect = () =>
    run(async () => {
      const next = await invoke<DropboxStatus>("dropbox_connect", {
        code: code.trim(),
      });
      setStatus(next);
      setAwaitingCode(false);
      setCode("");
    });

  const listFiles = () =>
    run(async () => {
      setListing(await invoke<DropboxListing>("dropbox_list_files"));
    });

  const pullVault = () =>
    run(async () => {
      setPull(null);
      setProgress([0, 0]);
      try {
        setPull(await invoke<DropboxPull>("dropbox_pull_vault"));
      } finally {
        setProgress(null);
      }
    });

  const writeMarker = () =>
    run(async () => {
      setMarker(await invoke<string>("dropbox_write_marker"));
    });

  const disconnect = () =>
    run(async () => {
      await invoke("dropbox_disconnect");
      setStatus({ connected: false, expires_in_secs: 0 });
      setListing(null);
    });

  return (
    <div className="mx-auto flex h-full max-w-md flex-col gap-4 overflow-auto px-6 py-8">
      <h1 className="text-2xl font-semibold">Connect Dropbox</h1>
      <p className="text-sm text-content-muted">
        Hypomnema reads and writes your vault through Dropbox&apos;s API,
        inside its own app folder — the one Dropbox creates when you
        authorize, named after the app you registered, under{" "}
        <code>Apps/</code> (or its translation). It never sees the rest of
        your Dropbox.
      </p>

      {!status?.connected && (
        <>
          <button
            disabled={busy}
            onClick={() => void startAuth()}
            className="rounded-lg bg-accent px-5 py-2.5 font-medium text-white disabled:opacity-50"
          >
            {awaitingCode ? "Open Dropbox again" : "Authorize in browser"}
          </button>
          {awaitingCode && (
            <div className="flex flex-col gap-2">
              <label className="text-sm text-content-muted" htmlFor="dbx-code">
                Paste the code Dropbox showed you:
              </label>
              <input
                id="dbx-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="rounded-lg border border-line bg-surface-alt px-3 py-2"
              />
              <button
                disabled={busy || code.trim() === ""}
                onClick={() => void connect()}
                className="rounded-lg bg-accent px-5 py-2.5 font-medium text-white disabled:opacity-50"
              >
                Connect
              </button>
            </div>
          )}
        </>
      )}

      {status?.connected && (
        <>
          <p className="text-sm">
            Connected. Access token refreshes in{" "}
            {Math.round(status.expires_in_secs / 60)} min.
          </p>
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => void listFiles()}
              className="rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-50"
            >
              List app folder
            </button>
            <button
              disabled={busy}
              onClick={() => void pullVault()}
              className="rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-50"
            >
              Pull vault
            </button>
            <button
              disabled={busy}
              onClick={() => void writeMarker()}
              className="rounded-lg border border-line px-4 py-2 disabled:opacity-50"
            >
              Mark folder
            </button>
            <button
              disabled={busy}
              onClick={() => void disconnect()}
              className="rounded-lg border border-line px-4 py-2 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
          {progress && (
            <p className="text-sm text-content-muted">
              Pulling {progress[0]}
              {progress[1] > 0 ? ` / ${progress[1]}` : ""} files...
            </p>
          )}
          {pull && (
            <div className="text-sm">
              <p>
                Pulled {pull.files} file{pull.files === 1 ? "" : "s"} (
                {Math.round(pull.bytes / 1024)} KB) from{" "}
                {pull.vault_root === "" ? (
                  "the app folder itself"
                ) : (
                  <code>{pull.vault_root}</code>
                )}
                .
              </p>
              {pull.failed.length > 0 && (
                <p className="mt-1 text-warn">
                  {pull.failed.length} file
                  {pull.failed.length === 1 ? "" : "s"} could not be fetched:{" "}
                  {pull.failed.slice(0, 3).join(", ")}
                  {pull.failed.length > 3 ? ", ..." : ""}
                </p>
              )}
            </div>
          )}
          {marker && (
            <p className="text-sm">
              Wrote <code>{marker}</code> into the linked folder. Search
              Dropbox for that name on the desktop to see exactly which
              folder this phone is talking to.
            </p>
          )}
          {listing !== null && (
            <div className="rounded-lg border border-line p-3 text-sm">
              <p className="mb-2 text-content-muted">
                {listing.files.length} file
                {listing.files.length === 1 ? "" : "s"}, {listing.folders}{" "}
                folder{listing.folders === 1 ? "" : "s"}, {listing.deleted}{" "}
                deleted entr{listing.deleted === 1 ? "y" : "ies"}
              </p>
              {listing.files.length === 0 && (
                <p className="text-content-muted">
                  {listing.folders > 0
                    ? "Folders are here but no files - the vault's contents may still be uploading."
                    : "This app folder is empty. On the desktop, check the vault sits inside the folder Dropbox itself created when you authorized - its name matches the app you registered, which is not necessarily “Hypomnema” - and that Dropbox has finished syncing. A vault in a folder you made by hand is invisible to this app."}
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {listing.files.map((path) => (
                  <li key={path} className="truncate font-mono text-xs">
                    {path}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
