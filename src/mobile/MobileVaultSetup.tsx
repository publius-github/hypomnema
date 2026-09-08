import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import DropboxLink from "../components/DropboxLink";

/**
 * First run on a phone.
 *
 * A local vault is the default and the whole app works without ever
 * touching Dropbox - it is a local-first app, and the phone is just
 * another device that has one. Dropbox is a way to *sync* a vault
 * between devices, and treating it as the only way to *have* one on a
 * phone (which this screen used to) confused a sync backend with the
 * storage model.
 */
export default function MobileVaultSetup() {
  const [dropbox, setDropbox] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setError = useAppStore((s) => s.setError);

  useEffect(() => {
    void invoke<string>("vault_local_path")
      .then(setPath)
      .catch(() => {});
  }, []);

  if (dropbox) {
    return (
      <div className="flex h-full flex-col">
        <button
          onClick={() => setDropbox(false)}
          className="self-start px-4 py-3 text-content-muted"
        >
          ‹ Back
        </button>
        <div className="min-h-0 flex-1 overflow-auto">
          <DropboxLink />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-5 px-6 py-8">
      <h1 className="text-2xl font-semibold">Welcome to Hypomnema</h1>
      <p className="text-sm text-content-muted">
        Everything lives in one vault folder on this device: tasks, journal
        entries, notes and the configuration behind them. Nothing needs an
        account or a network.
      </p>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void invoke<string>("vault_use_local")
            .then(() => useAppStore.getState().init())
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
        className="rounded-lg bg-accent px-5 py-3 font-medium text-white disabled:opacity-50"
      >
        Use a vault on this device
      </button>
      {path && (
        <p className="break-all text-xs text-content-muted">
          It will live at <code>{path}</code> — copy an existing vault there
          from a computer to open it instead of starting empty.
        </p>
      )}
      <button
        onClick={() => setDropbox(true)}
        className="rounded-lg border border-line px-5 py-3"
      >
        Sync with Dropbox instead
      </button>
      <p className="text-xs text-content-muted">
        Dropbox keeps a vault in step across devices. It can also be turned on
        later, from Settings.
      </p>
    </div>
  );
}
