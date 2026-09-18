import { useCallback, useEffect, useState } from "react";
import { invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import type { DirListing } from "../types";

/**
 * The folder chooser, as a screen of its own.
 *
 * Android has no directory picker to hand off to - Tauri's dialog plugin
 * picks files, and the Storage Access Framework returns a `content://`
 * tree the Rust core cannot open as a path - so the app browses the
 * filesystem itself. It gets the whole display for the same reason a
 * system picker does: choosing a folder means reading a list of them,
 * and a list worth reading does not fit in a panel wedged into a
 * settings page.
 *
 * Tap a folder to enter it, "Up" to leave, and the button at the bottom
 * takes the folder currently open - the shape every file picker has, so
 * there is nothing to learn.
 *
 * Two things it shows that a plain file manager would not, because on
 * Android neither is visible from the path and both change what happens
 * next: whether a vault is already in a folder (opening it adopts that
 * vault instead of starting an empty one), and whether this app can
 * actually write there, probed by writing a file rather than guessed.
 */
export default function MobileVaultFolder({
  onChosen,
  onCancel,
}: {
  onChosen: (path: string) => void;
  onCancel: () => void;
}) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [access, setAccess] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = useCallback((path?: string) => {
    setError(null);
    void invoke("vault_browse", { path: path ?? null })
      .then(setListing)
      .catch((e) => setError(String(e)));
  }, []);

  const checkAccess = useCallback(() => {
    void invoke("storage_access")
      .then(setAccess)
      .catch(() => setAccess(true));
  }, []);

  useEffect(() => {
    go();
    checkAccess();
  }, [go, checkAccess]);

  // Granting happens in Android's own settings, so the app comes back to
  // the foreground with the answer changed under it. Re-checking on
  // return is what turns "Allow access" into a button that visibly
  // finishes rather than one that keeps sitting there.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      checkAccess();
      go(listing?.path);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [checkAccess, go, listing?.path]);

  const use = (path: string) => {
    setBusy(true);
    setError(null);
    void invoke("vault_use_path", { path })
      .then((chosen) => {
        void useAppStore.getState().init();
        onChosen(chosen);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const makeFolder = () => {
    if (!listing) return;
    const name = window.prompt("New folder name");
    if (!name?.trim()) return;
    void invoke("vault_browse_mkdir", {
      parent: listing.path,
      name: name.trim(),
    })
      .then((created) => go(created))
      .catch((e) => setError(String(e)));
  };

  return (
    <div className="safe-area fixed inset-0 z-30 flex flex-col bg-surface">
      <header className="shrink-0 border-b border-line px-2 py-3">
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="px-2 py-1 text-content-muted">
            Cancel
          </button>
          <span className="min-w-0 flex-1 truncate text-center font-semibold">
            Choose a folder
          </span>
          <button onClick={makeFolder} className="px-2 py-1 text-accent">
            New
          </button>
        </div>
        <p className="mt-1 break-all px-2 font-mono text-xs text-content-muted">
          {listing?.path ?? "…"}
        </p>
      </header>

      {access === false && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-warn/40 bg-warn/10 px-4 py-3">
          <span className="min-w-0 text-sm">
            Android has not given this app access to your files, so only its own
            folders are shown.
          </span>
          <button
            onClick={() =>
              void invoke("storage_access_request").catch((e) =>
                setError(String(e)),
              )
            }
            className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white"
          >
            Allow
          </button>
        </div>
      )}

      {listing && listing.shortcuts.length > 0 && (
        <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-line px-3 py-2">
          {listing.shortcuts.map((shortcut) => (
            <button
              key={shortcut.path}
              onClick={() => go(shortcut.path)}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm ${
                shortcut.path === listing.path
                  ? "border-accent text-accent"
                  : "border-line text-content-muted"
              }`}
            >
              {shortcut.label}
            </button>
          ))}
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-auto">
        {listing?.parent && (
          <li className="border-b border-line/60">
            <button
              onClick={() => go(listing.parent!)}
              className="flex w-full items-center gap-3 px-4 py-4 text-left"
            >
              <span aria-hidden className="text-content-muted">
                ↑
              </span>
              <span className="text-content-muted">Up one folder</span>
            </button>
          </li>
        )}
        {listing && !listing.readable && (
          <li className="px-4 py-8 text-center text-sm text-warn">
            Android does not let this app read this folder.
          </li>
        )}
        {listing?.readable && listing.entries.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-content-muted">
            No folders here.
          </li>
        )}
        {listing?.entries.map((entry) => (
          <li key={entry.path} className="border-b border-line/60">
            <button
              onClick={() => go(entry.path)}
              className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span aria-hidden className="text-content-muted">
                  ▸
                </span>
                <span className="min-w-0 break-words">{entry.name}</span>
              </span>
              {entry.has_vault && (
                <span className="shrink-0 text-xs text-accent">vault</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      <div className="shrink-0 border-t border-line p-3">
        {error && (
          <p className="mb-2 break-words text-sm text-danger">{error}</p>
        )}
        {listing && !listing.writable && (
          <p className="mb-2 text-sm text-warn">
            This app cannot write here, so the vault cannot go in this folder.
          </p>
        )}
        <button
          disabled={busy || !listing?.writable}
          onClick={() => listing && use(listing.path)}
          className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {listing?.has_vault
            ? "Open the vault here"
            : "Put the vault in this folder"}
        </button>
      </div>
    </div>
  );
}
