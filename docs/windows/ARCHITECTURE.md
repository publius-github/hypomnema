# Windows Desktop Notes

Supplement to `docs/general/ARCHITECTURE.md` (the shared Rust core + React frontend map). This file covers only what's specific to the Windows desktop build: the desktop-only chrome in `lib.rs`, and the Windows build/release flow. Android's equivalents live under `docs/android/`.

## Desktop-only chrome (`lib.rs`)

Single instance: `tauri-plugin-single-instance` (desktop-only dependency, registered first in `run`) turns a second launch - typically a shortcut clicked while the app sits in the tray under `close_to_tray` - into `show_main` on the running instance and an immediate exit, so two copies never fight over the capture shortcut (the loser's banner read "HotKey already registered") or write the same vault.

Two windows: `main` (the app) and `capture`, a small hidden always-on-top window pre-created in `.setup()` that `src/main.tsx` routes to `CaptureWindow.tsx` via the `#/capture` hash - one input calling `capture_task` (task into the `capture_list` list, created manual+favorite on first use via `tasks::ensure_inbox`; the command emits `vault-updated` so the main window refreshes). Shown by the OS-global shortcut `capture_shortcut` and the tray menu; hidden on Esc, focus loss or close, never destroyed. The tray icon (`tray_icon`, menu Show / Quick capture / Quit, left click shows main) and `close_to_tray` (main window close hides instead of quitting; forced off without the tray) are synced from the config in setup, on vault open, on `config_set` and on the watcher reload; a shortcut that fails to parse/register surfaces in the error banner and never blocks saving.

None of this exists on mobile: the tray, global-shortcut and updater plugins, and the pre-created capture window are `#[cfg(desktop)]`-only in `lib.rs`; mobile gets no-op `#[cfg(mobile)]` stubs with the same signatures so shared call sites need no branching (see `docs/android/SPIKES.md`, Spike B).

## Build

- `scripts/windows/build.sh` (Linux/WSL) / `scripts/windows/build.ps1` (Windows) run `npm ci && tauri build` and copy the produced NSIS installer into `releases/windows/`; they sign updater artifacts only if `~/.tauri/app-pkb.key` is present. A `build.sh` run on this dev machine only smoke-checks the pipeline (produces a macOS bundle, not a shippable Windows installer) - see CLAUDE.md's "This machine" note.
- Artifacts land in `src-tauri/target/release/bundle/`; `scripts/windows/build.ps1` additionally copies the `.exe` into `releases/windows/<name>-<version>.exe`.

## Release

- `scripts/windows/release.sh` / `release.ps1` = version bump (via the same logic as `scripts/general/bump.sh`) + commit + tag `v<version>` + push - triggers `release.yml`.
- `release.yml` (tag `v*`): fails first if the tag doesn't match `VERSION`, then builds a Windows-only NSIS installer via `tauri-action` and attaches it to a draft GitHub Release. Only one job (`build-windows`) exists today; an Android release job would be a separate addition, not a change to this flow.
- Updater endpoint = `releases/latest/download/latest.json` (a GitHub Release asset path, unrelated to the local `releases/windows/` folder); secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`. The draft release must be published for `latest.json` to be servable.
