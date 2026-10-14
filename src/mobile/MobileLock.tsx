import { useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import type { LockState } from "../types";

/**
 * The passphrase section of phone Settings - now only the way out of it.
 *
 * The passphrase sealed the Dropbox refresh token, the one standing
 * secret a phone used to hold. Google sync keeps no token in this app on
 * Android (Play services holds the grant), so there is nothing left for
 * it to protect, and offering to set one would claim protection that
 * does not exist. A phone that had it on keeps this panel until it is
 * removed.
 */
export function LockSettings({
  state,
  onChange,
}: {
  state: LockState;
  onChange: (next: LockState) => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setError(null);
    try {
      onChange(await invoke("app_lock_disable", { passphrase }));
      setPassphrase("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (!state.enabled) {
    return (
      <p className="text-sm text-content-muted">
        No passphrase is set, and none is needed: Google access on this phone is
        held by Android&apos;s Play services, not stored by this app.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <p className="text-sm text-content-muted">
        A passphrase is still set from the Dropbox days. It protects nothing
        now - Google access on this phone is held by Play services, not by this
        app - so it can be removed.
      </p>
      <input
        type="password"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        placeholder="Current passphrase"
        className="rounded-lg border border-line bg-surface-alt px-3 py-2"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        onClick={() => void remove()}
        className="self-start rounded-lg bg-accent px-4 py-2 font-medium text-white"
      >
        Remove passphrase
      </button>
    </section>
  );
}
