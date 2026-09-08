import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import type { DirListing } from "../types";

/**
 * A folder browser, because Android has none to borrow.
 *
 * Tauri's dialog plugin picks files rather than directories, and the
 * Storage Access Framework hands back a `content://` tree the Rust core
 * cannot open as a path - so the app walks the filesystem itself. Tap a
 * folder to go in, "Up" to go out, and one button takes the folder you
 * are standing in.
 *
 * The two things it says that a file manager would not, because both are
 * invisible from a path on Android and both change what happens next: a
 * folder already holding a vault says so (opening it adopts that vault
 * rather than starting empty), and a folder this app cannot write to
 * says so *before* it is chosen rather than failing afterwards.
 */
export default function MobileVaultFolder({
  onChosen,
}: {
  onChosen: (path: string) => void;
}) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = useCallback((path?: string) => {
    setError(null);
    void invoke<DirListing>("vault_browse", { path })
      .then(setListing)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => go(), [go]);

  const use = (path: string) => {
    setBusy(true);
    setError(null);
    void invoke<string>("vault_use_path", { path })
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
    void invoke<string>("vault_browse_mkdir", {
      parent: listing.path,
      name: name.trim(),
    })
      .then((created) => go(created))
      .catch((e) => setError(String(e)));
  };

  if (!listing) {
    return (
      <p className="px-1 py-4 text-sm text-content-muted">
        {error ?? "Loading…"}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {listing.shortcuts.map((shortcut) => (
          <button
            key={shortcut.path}
            onClick={() => go(shortcut.path)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              shortcut.path === listing.path
                ? "border-accent text-accent"
                : "border-line text-content-muted"
            }`}
          >
            {shortcut.label}
          </button>
        ))}
      </div>

      <p className="break-all font-mono text-xs text-content-muted">
        {listing.path}
      </p>

      <div className="rounded-lg border border-line">
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <button
            disabled={!listing.parent}
            onClick={() => listing.parent && go(listing.parent)}
            className="text-sm text-content-muted disabled:opacity-40"
          >
            ↑ Up
          </button>
          <button onClick={makeFolder} className="text-sm text-accent">
            + New folder
          </button>
        </div>
        <ul className="max-h-64 overflow-auto">
          {!listing.readable && (
            <li className="px-3 py-4 text-sm text-warn">
              Android does not let this app read this folder. Try one of the
              places above.
            </li>
          )}
          {listing.readable && listing.entries.length === 0 && (
            <li className="px-3 py-4 text-sm text-content-muted">
              No folders here.
            </li>
          )}
          {listing.entries.map((entry) => (
            <li
              key={entry.path}
              className="border-b border-line/60 last:border-0"
            >
              <button
                onClick={() => go(entry.path)}
                className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
              >
                <span className="flex min-w-0 items-center gap-2">
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
      </div>

      {listing.writable ? (
        <button
          disabled={busy}
          onClick={() => use(listing.path)}
          className="rounded-lg bg-accent px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {listing.has_vault
            ? "Open the vault in this folder"
            : "Put the vault in this folder"}
        </button>
      ) : (
        <p className="text-sm text-warn">
          This app cannot write here, so the vault cannot go in this folder.
        </p>
      )}

      {error && <p className="break-words text-sm text-danger">{error}</p>}
    </div>
  );
}
