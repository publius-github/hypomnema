import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import type { VaultPlace } from "../types";

/**
 * Choosing where the vault lives, on a platform with no folder picker.
 *
 * Android has none to offer: Tauri's dialog plugin picks files, and the
 * Storage Access Framework hands back a `content://` tree rather than a
 * path the Rust core could open. So this lists the places a vault
 * plausibly goes, each already probed by the backend for whether this
 * phone lets the app write there, and takes a typed path for anything
 * else. A row that says "cannot write here" up front beats a picker that
 * accepts the choice and fails afterwards.
 */
export default function MobileVaultFolder({
  onChosen,
}: {
  onChosen: (path: string) => void;
}) {
  const [places, setPlaces] = useState<VaultPlace[] | null>(null);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void invoke<VaultPlace[]>("vault_places")
      .then(setPlaces)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(load, [load]);

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

  return (
    <div className="flex flex-col gap-3">
      {places?.map((place) => (
        <div
          key={place.path}
          className="flex flex-col gap-1 rounded-lg border border-line p-3"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{place.label}</span>
            {place.has_vault && (
              <span className="shrink-0 text-xs text-accent">
                vault already here
              </span>
            )}
          </div>
          <p className="text-xs text-content-muted">{place.note}</p>
          <p className="break-all font-mono text-xs text-content-muted">
            {place.path}
          </p>
          {place.writable ? (
            <button
              disabled={busy}
              onClick={() => use(place.path)}
              className="mt-1 self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {place.has_vault ? "Open this vault" : "Use this folder"}
            </button>
          ) : (
            <p className="mt-1 text-xs text-warn">
              This phone does not let the app write here.
            </p>
          )}
        </div>
      ))}

      <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
        <span className="font-medium">Another folder</span>
        <p className="text-xs text-content-muted">
          A full path. It is checked by writing a file there and deleting it
          again, so a folder that will not work says so now rather than later.
        </p>
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="/storage/emulated/0/…"
          className="rounded-lg border border-line bg-surface-alt px-3 py-2 font-mono text-sm"
        />
        <button
          disabled={busy || !custom.trim()}
          onClick={() => use(custom.trim())}
          className="self-start rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-50"
        >
          Use this folder
        </button>
      </div>

      {error && <p className="break-words text-sm text-danger">{error}</p>}
    </div>
  );
}
