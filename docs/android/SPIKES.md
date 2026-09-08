# Phase 0 — Spike log

Status as of 2026-09-07, from a headless Linux/WSL2 dev sandbox with no
physical Android device or emulator attached. Work happened on branch
`mobile/android-spike-b` in `app-hypomnema` (uncommitted — see below).

## Spike B — Rust core cross-compiles for Android — PASSED (toolchain + on-device run)

**What was verified:**
- Installed: `aarch64/armv7/i686/x86_64-linux-android` Rust targets, Android
  NDK r27, platform android-34, build-tools 34.0.0.
- `cargo tauri android init` scaffolds `src-tauri/gen/android` cleanly on
  top of the existing desktop crate — no separate project needed, matching
  the "Android as a build target of the same Tauri project" model
  (ROADMAP.md's chosen layout).
- Minimal target-gating applied to `src-tauri/src/lib.rs` (nothing in
  `engine.rs`/`tasks.rs`/`vault.rs`/etc. touched):
  - `#[cfg_attr(mobile, tauri::mobile_entry_point)]` on `run()`.
  - Tray, global-shortcut, and updater plugins/registration now
    `#[cfg(desktop)]`; `sync_tray`/`sync_global_shortcut` get `#[cfg(mobile)]`
    no-op stubs (same signatures) so every call site elsewhere in `lib.rs`
    needed no changes.
  - The pre-created quick-capture window is `#[cfg(desktop)]`-only.
  - `show_main`/`show_capture` are `#[cfg(desktop)]` (only reachable from
    tray code); `show_main` used `WebviewWindow::unminimize`, which doesn't
    exist on mobile's window API — this was the one real compile error hit,
    fixed by the same cfg-gate.
- `cargo check` on the desktop (host) target still passes after these
  changes — parity with existing desktop behavior isn't touched.
- `npx tauri android build -t aarch64 -d` **succeeds end to end**: Rust lib
  compiles for `aarch64-linux-android`, Gradle build completes, produces
  `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
  (174MB debug build).

**Verified on-device (2026-09-08):** installed and launched on a physical
phone. The webview renders (the shared `VaultPicker.tsx` "Welcome to
Hypomnema" screen shows, as expected - no vault-linking UI exists yet).
Tapping "Select vault folder" round-trips a real `invoke` call from the
webview through to a Rust-side plugin (`tauri-plugin-dialog`'s `open`
command) and back, surfacing its error in the same error-banner UI path the
desktop build uses - confirming the full IPC chain works end to end on
Android, not just that the process boots. The error itself ("folder picker
is not implemented on mobile") is `tauri-plugin-dialog`'s own message: its
directory-picker isn't implemented for Android, since a folder picker there
needs SAF (`ACTION_OPEN_DOCUMENT_TREE`), a different API than the desktop
file-dialog this shared component currently calls. That's the exact,
already-tracked gap Spike A / the Phase 2 vault-linking screen exist to
close - not a regression or a sign anything here is further along than
Phase 0.

**Verdict: proceed with Tauri 2 + shared Rust core (REQUIREMENTS.md §4).**
Both toolchain risk and on-device risk from ROADMAP.md's Spike B are
resolved. Nothing left blocking the start of Phase 1's real plumbing work.

## Spike A — Filesystem (SAF) access to a Dropbox-synced folder — FAILED (2026-09-08)

Tested with `spikes/android-saf-test/` (throwaway SAF-permission app, see its
README.md) against a real device with the official Dropbox Android app
signed in and syncing. Result: the official Dropbox app does not expose a
live-synced folder to other apps' filesystem/SAF access the way a desktop
Dropbox client mounts one - there is no folder to point
`ACTION_OPEN_DOCUMENT_TREE` at that Dropbox itself keeps in sync in the
background. This is exactly the risk REQUIREMENTS.md §5-A and ROADMAP.md
flagged going in, now confirmed rather than theoretical.

**Verdict: `FilesystemSyncProvider` is dropped for v1**, per ROADMAP.md's
own fallback plan for this exact outcome. `DropboxApiSyncProvider` (direct
OAuth + `files/upload`/`download`/`list_folder`) becomes the sole sync
backend for launch, not just the default - see ROADMAP.md's Phase 1/Phase 2
updates. Nothing else in the roadmap needed to change; the API backend was
never contingent on this spike passing.

Not pursued further per this result: the "third-party sync client with SAF
exposure (FolderSync/Autosync)" fallback ROADMAP.md's Spike A description
mentioned as a next thing to try if the official app failed - direct API
integration is the more robust path anyway (real `rev`-based optimistic
concurrency vs. hash/mtime guessing) and doesn't add a dependency on a third
app the user has to keep configured, so there was no reason to chase it.

`spikes/android-saf-test/` stays in the repo as a record of this result;
no further use planned for it (see "revisit... if a cleaner Android
mechanism appears" in ROADMAP.md's Phase 0 fallback note, for if this ever
gets reopened later).

## `src-tauri/gen/android` is not tracked (decided 2026-09-08)

The generated Android project is in `.gitignore`: `tauri android init`
recreates it deterministically from `tauri.conf.json`, and the CLI rewrites
parts of it on its own during a build - adding `tauri-plugin-opener` as a
Cargo dependency was enough for it to rewrite `tauri.settings.gradle` and
`app/tauri.build.gradle.kts` with the plugin's Gradle module, with no
manual step.

**Nothing in there is hand-edited any more.** It used to be: the release
build type was changed by hand to sign with the auto-generated debug
keystore, and that edit had to be re-applied after every regeneration or a
release build came out unsigned and uninstallable. `build-android.sh` now
does the signing setup itself on every run (`configure_signing`), writing
`keystore.properties` and injecting a real `signingConfigs` block when
`ANDROID_KEYSTORE` is set. The script that needs the file is the script
that writes it, which is the only arrangement a regenerated directory can
support.

## Working tree note

Everything on `mobile/android-spike-b` is still **uncommitted**, per "commit
only when asked": the `lib.rs` target-gating, the `spikes/android-saf-test/`
throwaway app, the Dropbox sync modules, and the Android link screen. The
plan is to land it as one batch with a minor version bump once the link
screen is confirmed working on a real device - an unverified feature isn't
one worth bumping for.


## Two things the phone build learned the hard way (2026-09-08)

**The app draws under the system bars.** `targetSdk = 36`, and Android has
enforced edge-to-edge since API 35: the status bar and the navigation bar
sit *over* the WebView, so the header lands under the clock and the tab bar
under the gesture bar unless the layout moves out of the way itself. The
fix is `viewport-fit=cover` in `index.html` plus `.safe-area` in
`src/styles.css`, applied to every screen that owns the viewport - the
`position: fixed` overlays included, since they ignore padding on an
ancestor. `env(safe-area-inset-*)` is the real answer where the WebView
reports insets; because it does not always (Chromium on Android has
historically reported the display cutout and not the system bars), each
edge takes `max(env(...), var(--safe-*))` and the floor is a setting.

**There is no folder picker.** Tauri's dialog plugin picks files, not
directories, and SAF hands back a `content://` tree rather than a path the
Rust core can open - the same wall Spike A hit from the other side. The
first attempt at working around it was a list of preset locations plus a
box to type a path into, which is not a chooser; it is a questionnaire.
`vault_places.rs` now backs a real in-app browser instead - tap a folder
to enter, Up to leave, one button takes the folder you are standing in -
and reports per directory whether the app can **write** there (probed by
writing a file and deleting it again) and whether a vault is already
there, since on Android neither is visible from the path and both change
what the button should say. `build-android.sh` declares
`MANAGE_EXTERNAL_STORAGE` so the browser can leave the app's own folders,
and the app asks for it itself rather than sending anyone hunting through
Settings.

**Calling Android from Rust needs no Kotlin.** That was the assumption
behind "this is blocked on `gen/android`", and it was wrong for this
case: `PlatformWebview::jni_handle().exec(|env, activity, _|)` hands the
JNI environment to ordinary tracked Rust (`src-tauri/src/android_storage.rs`).
`Environment.isExternalStorageManager()` answers whether access is
granted, and an `Intent` on
`android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` opens this
app's own entry on the permission screen - `MANAGE_EXTERNAL_STORAGE` has
no runtime dialog, so a settings screen is as close to "the app asks" as
Android allows.

What this does *not* reach is anything needing an activity **result**
(`startActivityForResult`), which is what a SAF folder picker would
need - receiving one still means Kotlin in the generated project. Fire
-and-forget intents and plain method calls are enough here.
