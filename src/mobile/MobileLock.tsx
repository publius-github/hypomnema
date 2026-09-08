import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LockState } from "../types";

/**
 * The passphrase section of phone Settings, and the screen that asks for
 * it after a cold start.
 *
 * Off by default, and the copy says exactly what it does rather than
 * implying more: it seals the Dropbox refresh token, which is a standing
 * grant to the whole app folder. It does not encrypt the vault - those
 * are plain files a desktop reads directly, and pretending otherwise
 * would be the worse failure here (ROADMAP.md Phase 4).
 */
export function LockSettings({
  state,
  onChange,
}: {
  state: LockState;
  onChange: (next: LockState) => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const act = async (run: () => Promise<LockState>) => {
    setError(null);
    try {
      onChange(await run());
      setPassphrase("");
      setConfirm("");
      setOpen(false);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">Passphrase</h2>
      <p className="text-sm text-content-muted">
        {state.enabled
          ? "The Dropbox token on this device is encrypted. You will be asked for the passphrase after the app is fully closed and reopened."
          : "Encrypt the Dropbox token stored on this device. It is a standing grant to the whole app folder, so it is worth covering if the phone is lost. Your notes and tasks stay as plain files either way - the desktop reads them directly."}
      </p>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="self-start rounded-lg border border-line px-4 py-2 text-sm"
        >
          {state.enabled ? "Remove passphrase" : "Set a passphrase"}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder={state.enabled ? "Current passphrase" : "Passphrase"}
            className="rounded-lg border border-line bg-surface-alt px-3 py-2"
          />
          {!state.enabled && (
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Again"
              className="rounded-lg border border-line bg-surface-alt px-3 py-2"
            />
          )}
          {!state.enabled && (
            <p className="text-xs text-warn">
              There is no way to recover it. Forgetting it means linking Dropbox
              again, which costs nothing but the consent screen.
            </p>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!state.enabled && passphrase !== confirm) {
                  setError("The two passphrases do not match.");
                  return;
                }
                void act(() =>
                  invoke<LockState>(
                    state.enabled ? "app_lock_disable" : "app_lock_enable",
                    { passphrase },
                  ),
                );
              }}
              className="rounded-lg bg-accent px-4 py-2 font-medium text-white"
            >
              {state.enabled ? "Remove" : "Set"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setError(null);
                setPassphrase("");
                setConfirm("");
              }}
              className="rounded-lg border border-line px-4 py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {state.enabled && state.unlocked && (
        <button
          onClick={() => void act(() => invoke<LockState>("app_lock_now"))}
          className="self-start text-sm text-content-muted"
        >
          Lock now
        </button>
      )}
    </section>
  );
}

/**
 * Shown instead of the app when a passphrase is set and this session has
 * not been given it.
 *
 * Only sync is actually gated - the vault on this device is readable
 * either way - so this offers a way past it rather than pretending to be
 * a wall it is not. Claiming more protection than exists is how people
 * end up trusting a phone with something they should not.
 */
export function LockScreen({
  onUnlocked,
  onSkip,
}: {
  onUnlocked: (state: LockState) => void;
  onSkip: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    void invoke<LockState>("app_unlock", { passphrase })
      .then(onUnlocked)
      .catch((e) => setError(String(e)));
  };

  return (
    <div className="safe-area h-full">
      <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-xl font-semibold">Passphrase</h1>
        <p className="text-sm text-content-muted">
          Needed to reach the Dropbox link on this device.
        </p>
        <input
          autoFocus
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="rounded-lg border border-line bg-surface-alt px-3 py-3"
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          onClick={submit}
          className="rounded-lg bg-accent px-4 py-3 font-medium text-white"
        >
          Unlock
        </button>
        <button onClick={onSkip} className="text-sm text-content-muted">
          Continue without syncing
        </button>
      </div>
    </div>
  );
}
