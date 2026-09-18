import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";
import { warn } from "./log";

/**
 * Checks GitHub Releases for a newer version; on user consent downloads,
 * installs, and relaunches. Failures are silent by design: no network or
 * no published release must never disturb normal use.
 */
export async function checkForUpdates(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;
    const install = await ask(
      `Version ${update.version} is available (current ${update.currentVersion}). Install and restart?`,
      { title: "Update available", kind: "info" },
    );
    if (!install) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    // offline, dev build, or no release yet
    warn("update check", e);
  }
}
