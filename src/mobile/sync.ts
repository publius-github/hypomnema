import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { errorMessage, invoke } from "../lib/ipc";
import { warn } from "../lib/log";
import { useAppStore } from "../store";
import type { SyncActivity, SyncStanding } from "../types";

/**
 * What the Day header's sync button needs: whether a pass is running
 * (from the `sync-status` event, so an automatic pass shows too), the
 * standing after it, and a run of its own. Hidden until this phone is
 * signed in to Google - with no account there is nothing to sync and a
 * "never" under the icon would only ask a question.
 */
export function useSyncButton(): {
  shown: boolean;
  running: boolean;
  error: string | null;
  /** The last pass's time, short: "12:40" today, "14 Oct" before. */
  label: string;
  run: () => void;
} {
  const [shown, setShown] = useState(false);
  const [running, setRunning] = useState(false);
  const [standing, setStanding] = useState<SyncStanding | null>(null);
  const vaultPath = useAppStore((s) => s.vaultPath);
  const setError = useAppStore((s) => s.setError);

  const reload = useCallback(() => {
    void invoke("sync_standing")
      .then(setStanding)
      .catch((e) => warn("sync standing", e));
  }, []);

  useEffect(() => {
    if (!vaultPath) return;
    void invoke("google_status")
      .then((status) => setShown(status.signed_in))
      .catch((e) => warn("google status", e));
    reload();
    const unlisten = listen<SyncActivity>("sync-status", (event) => {
      setRunning(event.payload.running);
      if (!event.payload.running) reload();
    });
    return () => void unlisten.then((fn) => fn());
  }, [vaultPath, reload]);

  const run = useCallback(() => {
    if (running) return;
    setRunning(true);
    void invoke("sync_now")
      .then(() => useAppStore.getState().refresh())
      .catch((e) => setError(errorMessage(e)))
      .finally(() => {
        setRunning(false);
        reload();
      });
  }, [running, reload, setError]);

  return {
    shown,
    running,
    error: standing?.last_error ?? null,
    label: running ? "..." : passLabel(standing?.last_pass_at ?? null),
    run,
  };
}

/** "12:40" for a pass today, "14 Oct" for an older one, "never" for none. */
export function passLabel(at: string | null, now = new Date()): string {
  if (!at) return "never";
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "never";
  if (when.toDateString() === now.toDateString()) {
    return when.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return when.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
