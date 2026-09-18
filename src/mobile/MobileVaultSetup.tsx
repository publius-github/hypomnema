import { useEffect, useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import DropboxLink from "../components/DropboxLink";
import MobileVaultFolder from "./MobileVaultFolder";

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
  const [screen, setScreen] = useState<"start" | "folder" | "dropbox">("start");
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setError = useAppStore((s) => s.setError);

  useEffect(() => {
    void invoke("vault_local_path")
      .then(setPath)
      .catch((e) => setError(errorMessage(e)));
  }, [setError]);

  if (screen === "folder") {
    return (
      <MobileVaultFolder
        onChosen={() => setScreen("start")}
        onCancel={() => setScreen("start")}
      />
    );
  }

  if (screen === "dropbox") {
    return (
      <div className="safe-area flex h-full flex-col">
        <button
          onClick={() => setScreen("start")}
          className="self-start px-4 py-3 text-content-muted"
        >
          ‹ Back
        </button>
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
          <DropboxLink />
        </div>
      </div>
    );
  }

  return (
    <div className="safe-area h-full">
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
            void invoke("vault_use_local")
              .then(() => useAppStore.getState().init())
              .catch((e) => setError(errorMessage(e)))
              .finally(() => setBusy(false));
          }}
          className="rounded-lg bg-accent px-5 py-3 font-medium text-white disabled:opacity-50"
        >
          Use a vault on this device
        </button>
        {path && (
          <p className="break-all text-xs text-content-muted">
            <code>{path}</code>
          </p>
        )}
        <button
          onClick={() => setScreen("folder")}
          className="rounded-lg border border-line px-5 py-3"
        >
          Choose a folder…
        </button>
        <button
          onClick={() => setScreen("dropbox")}
          className="rounded-lg border border-line px-5 py-3"
        >
          Sync with Dropbox instead
        </button>
        <p className="text-xs text-content-muted">
          Dropbox keeps a vault in step across devices. It can also be turned on
          later, from Settings.
        </p>
      </div>
    </div>
  );
}
