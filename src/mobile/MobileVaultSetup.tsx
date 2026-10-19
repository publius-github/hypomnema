import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import { warn } from "../lib/log";
import MobileVaultFolder from "./MobileVaultFolder";
import GoogleSignInButton from "../components/GoogleSignInButton";

/**
 * First run on a phone.
 *
 * A local vault is the default and the whole app works without ever
 * signing in - it is a local-first app, and the phone is just another
 * device that has one. Google is a way to *sync* a vault between
 * devices, not the way to *have* one.
 *
 * Signing in here pulls the vault the other device already keeps in
 * Drive; with nothing there yet, a fresh local vault starts and its
 * first pass uploads it.
 */
export default function MobileVaultSetup() {
  const [screen, setScreen] = useState<"start" | "folder">("start");
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const setError = useAppStore((s) => s.setError);

  useEffect(() => {
    void invoke("vault_local_path")
      .then(setPath)
      .catch((e) => setError(errorMessage(e)));
    const unlisten = listen<[number, number]>("sync-progress", (e) =>
      setProgress(e.payload),
    );
    return () => void unlisten.then((fn) => fn());
  }, [setError]);

  const signIn = async () => {
    setSigningIn(true);
    try {
      const status = await invoke("google_sign_in");
      if (!status.signed_in) return;
      const pulled = await invoke("google_pull_vault");
      if (!pulled) await invoke("vault_use_local");
      await useAppStore.getState().init();
      // nothing in Drive yet: this vault becomes the one there
      if (!pulled) {
        void invoke("sync_now").catch((e) => warn("first upload", e));
      } else if (pulled.failed.length > 0) {
        setError(
          `${pulled.failed.length} file(s) could not be fetched; the next sync tries again.`,
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSigningIn(false);
      setProgress(null);
    }
  };

  if (screen === "folder") {
    return (
      <MobileVaultFolder
        onChosen={() => setScreen("start")}
        onCancel={() => setScreen("start")}
      />
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
          disabled={busy || signingIn}
          onClick={() => {
            setBusy(true);
            void invoke("vault_use_local")
              .then(() => useAppStore.getState().init())
              .catch((e) => setError(errorMessage(e)))
              .finally(() => setBusy(false));
          }}
          className="rounded-lg bg-accent-fill px-5 py-3 font-medium text-white disabled:opacity-50"
        >
          Use a vault on this device
        </button>
        {path && (
          <p className="break-all text-xs text-content-muted">
            <code>{path}</code>
          </p>
        )}
        <button
          disabled={busy || signingIn}
          onClick={() => setScreen("folder")}
          className="rounded-lg border border-line px-5 py-3 disabled:opacity-50"
        >
          Choose a folder…
        </button>
        <GoogleSignInButton
          disabled={busy}
          busy={signingIn}
          onClick={() => void signIn()}
          className="justify-center"
        />
        {progress && (
          <p className="text-sm text-content-muted">
            Bringing the vault down: {progress[0]} / {progress[1]} files
          </p>
        )}
        <p className="text-xs text-content-muted">
          Signing in keeps a vault in step with your other devices through a
          hidden app folder in your Google Drive. It can also be turned on
          later, from Settings.
        </p>
      </div>
    </div>
  );
}
