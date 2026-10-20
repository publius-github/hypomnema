import { useEffect, useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store";
import MobileVaultSetup from "../mobile/MobileVaultSetup";

export default function VaultPicker() {
  const selectVault = useAppStore((s) => s.selectVault);
  const createExampleVault = useAppStore((s) => s.createExampleVault);
  const error = useAppStore((s) => s.error);
  const clearError = useAppStore((s) => s.clearError);
  // null until the backend answers; the desktop picker below would only
  // fail on Android (its folder dialog is desktop-only), so wait rather
  // than flash the wrong screen.
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  useEffect(() => {
    void invoke("platform_is_mobile")
      .then(setIsMobile)
      .catch((e) => {
        // Fall back to the user agent, not to the desktop picker: that
        // picker cannot work on Android at all, so quietly rendering it
        // there is indistinguishable from "the new build didn't
        // install" - which is exactly how one real mix-up presented.
        setProbeError(errorMessage(e));
        setIsMobile(/Android/i.test(navigator.userAgent));
      });
  }, []);

  const pick = async () => {
    clearError();
    try {
      const path = await open({
        directory: true,
        title: "Select vault folder",
      });
      if (typeof path === "string") {
        await selectVault(path);
      }
    } catch (e) {
      useAppStore.setState({ error: errorMessage(e) });
    }
  };

  const tryExample = async () => {
    clearError();
    try {
      const path = await open({
        directory: true,
        title: "Select an empty folder for the example vault",
      });
      if (typeof path === "string") {
        await createExampleVault(path);
      }
    } catch (e) {
      useAppStore.setState({ error: errorMessage(e) });
    }
  };

  if (isMobile === null) return null;
  if (isMobile) return <MobileVaultSetup />;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <h1 className="text-2xl font-semibold">Welcome to Hypomnema</h1>
      <p className="max-w-md text-content-muted">
        Choose a vault folder. It will hold the task database, journal
        entries, and configuration files. Back up or sync this one folder to
        capture everything.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => void pick()}
          className="rounded-lg bg-accent-fill px-5 py-2.5 font-medium text-white hover:opacity-90"
        >
          Select vault folder
        </button>
        <button
          onClick={() => void tryExample()}
          className="rounded-lg border border-line px-5 py-2.5 font-medium hover:border-accent hover:text-accent"
        >
          Try it with an example
        </button>
      </div>
      <p className="max-w-md text-xs text-content-muted">
        A new vault starts with a few lists, tasks and rules to edit or
        delete. An existing folder of Markdown notes works too - the app
        adds its own files under .hypomnema and leaves yours where they
        are. The example needs an empty folder and adds a welcome note and
        a journal entry to look around in.
      </p>
      {probeError && (
        <p className="max-w-md text-sm text-warn">
          Could not ask the backend which platform this is ({probeError}), so
          this is a guess from the user agent.
        </p>
      )}
      {error && <p className="max-w-md text-sm text-danger">{error}</p>}
    </div>
  );
}
