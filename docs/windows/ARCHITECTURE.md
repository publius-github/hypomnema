# Windows Desktop Notes

Supplement to `docs/general/ARCHITECTURE.md` (the shared Rust core + React frontend map). This file covers only what's specific to the Windows desktop build: the desktop-only chrome in `lib.rs`, and the Windows build/release flow. Android's equivalents live under `docs/android/`.

## Desktop-only chrome (`lib.rs`)

Single instance: `tauri-plugin-single-instance` (desktop-only dependency, registered first in `run`) turns a second launch - typically a shortcut clicked while the app sits in the tray under `tray_icon` - into `show_main` on the running instance and an immediate exit, so two copies never fight over the capture shortcut (the loser's banner read "HotKey already registered") or write the same vault.

Two windows: `main` (the app) and `capture`, a small hidden always-on-top window pre-created in `.setup()` that `src/main.tsx` routes to `CaptureWindow.tsx` via the `#/capture` hash - one input calling `capture_task` (task into the `capture_list` list, created manual+favorite on first use via `tasks::ensure_inbox`; the command emits `vault-updated` so the main window refreshes). Shown by the OS-global shortcut `capture_shortcut` and the tray menu; hidden on Esc, focus loss or close, never destroyed. The tray (`tray_icon`, Settings' "Keep running in the tray": the icon with menu Show / Quick capture / Quit, left click shows main, and a main-window close that hides instead of quitting) is synced from the config in setup, on vault open, on `config_set` and on the watcher reload; a shortcut that fails to parse/register surfaces in the error banner and never blocks saving.

Google sign-in (`google_auth.rs`) is desktop-only too: the consent page opens in the default browser and returns to a one-shot listener on `127.0.0.1:<free port>`, which answers with a "you can close this tab" page; the main window is brought back to the front afterwards. The desktop sync scheduler (`sync_scheduler.rs`) starts in setup, hears main-window focus from `on_window_event`, and gets one last pass from the `RunEvent::Exit` handler (`run` now builds the app and runs it with an event callback).

None of this exists on mobile: the tray, global-shortcut and updater plugins, and the pre-created capture window are `#[cfg(desktop)]`-only in `lib.rs`; mobile gets no-op `#[cfg(mobile)]` stubs with the same signatures so shared call sites need no branching.

## Build

- `scripts/windows/build.sh` (Linux/WSL) / `scripts/windows/build.ps1` (Windows) run `npm ci && tauri build` and copy the produced NSIS installer into `releases/windows/`; they sign updater artifacts only if `~/.tauri/hypomnema.key` is present (the updater's private signing key). `build.sh` on macOS or Linux only smoke-checks the pipeline (it produces that platform's bundle, not a shippable Windows installer).
- Google sign-in needs the desktop OAuth client secret compiled in (`google_auth.rs`, `option_env!("HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_SECRET")`): Google treats a desktop client's secret as non-confidential, but secret scanners flag it in a public repo, so it lives in the Windows user environment, never in git. `build.ps1` (`Import-GoogleClientSecret`) copies the user-level value into the process when the shell lacks it (a shell opened before it was set, or one launched from WSL) and warns when it is missing - such a build works, with sign-in reported unavailable. `release.yml` passes the repository secret of the same name to `tauri-action`, plus the optional repository variable `HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_ID` (a self-build's own client; unset keeps the project's id).
- Artifacts land in `src-tauri/target/release/bundle/`; `scripts/windows/build.ps1` additionally copies the `.exe` into `releases/windows/<name>-<version>.exe`.

## Release

- `scripts/windows/release.sh` / `release.ps1` = version bump (via the same logic as `scripts/general/bump.sh`) + commit + tag `v<version>` + push - triggers `release.yml`.
- `release.yml` (tag `v*`): fails first if the tag doesn't match `VERSION`, then builds a Windows-only NSIS installer via `tauri-action` and attaches it to a draft GitHub Release. Only one job (`build-windows`) exists today; an Android release job would be a separate addition, not a change to this flow.
- Updater endpoint = `releases/latest/download/latest.json` (a GitHub Release asset path, unrelated to the local `releases/windows/` folder); secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`. The draft release must be published for `latest.json` to be servable. The check runs once per start from `App.tsx` (`lib/updater.ts`), once the config is loaded, and only while `update_check` (Settings > General > Updates, default on) is set.
