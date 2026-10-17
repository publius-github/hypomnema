# Android Notes

Supplement to `docs/general/ARCHITECTURE.md` (the shared Rust core + React frontend map, including the phone UI under `src/mobile/` in its Frontend notes). This file covers only what is specific to the Android build. Android is a second build target of the same Tauri project, cross-compiled for `aarch64-linux-android`; iOS is not planned.

## Build (`scripts/android/build-android.sh`)

- `src-tauri/gen/android` is generated (`tauri android init`) and **not tracked**: the CLI recreates it from `tauri.conf.json` and rewrites parts of it during a build (a new plugin's Gradle module, for one). Nothing in it is hand-edited; everything a build needs there is written by the script on every run:
  - `ensure_android_project` generates the project when it is missing;
  - `sync_launcher_icons` copies the committed mipmaps from `src-tauri/icons/android/` (see Icons in the general map);
  - `configure_storage_permission` declares `MANAGE_EXTERNAL_STORAGE`, so the in-app vault folder browser can leave the app's own folders;
  - `configure_backup` sets `android:allowBackup="false"`: Auto Backup would otherwise copy the default vault (`getExternalFilesDir()`) and the `device-id` to the user's Google backup, and a restore would hand a new phone the old one's sync identity;
  - `configure_signing` signs a release with the keystore named by `ANDROID_KEYSTORE` (+ `ANDROID_KEYSTORE_PASS`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASS`), writing `keystore.properties` and a `signingConfigs` block. Without the variable a release is signed with the debug key - installable for testing, not publishable - and the script says so.
- APKs are named `Hypomnema-<version>-b<build>-<variant>-<abi>.apk`; the build number lives in `releases/android/.build-number` and increments per run, so a test device can tell two builds of one version apart. `collect_artifacts` copies them into `releases/android/` and, when `APK_COPY_DIR` is set, into that folder too (say a synced folder a test phone installs from). The script header lists the remaining environment overrides (`ANDROID_ABIS`, default `aarch64`; SDK/NDK/JDK roots; `CARGO_TARGET_DIR`; the release keystore).
- `prune_target` runs `scripts/general/prune-target.mjs` first, the same stale-output prune the Windows build scripts do (see the Build section of `docs/windows/ARCHITECTURE.md`); it covers `target/aarch64-linux-android/` and honors `CARGO_TARGET_DIR` and `PRUNE_DAYS`.
- There is no Android CI job: `release.yml` builds the Windows installer only.

## Native code

- Plain Android API calls need no Kotlin: `PlatformWebview::jni_handle().exec()` hands the JNI environment to tracked Rust - `android_storage.rs` checks `Environment.isExternalStorageManager()` and opens the all-files-access settings screen that way (`MANAGE_EXTERNAL_STORAGE` has no runtime dialog).
- Anything the OS instantiates itself (a service, a worker, an intent filter) or that needs an activity *result* lives in a Tauri plugin with its own tracked `android/` module, which Tauri's build wires into `gen/android` on every build and whose `AndroidManifest.xml` merges into the app's. Today that is `src-tauri/plugins/google-auth/`: Google sign-in through `AuthorizationClient` and `SyncKeepAliveService`, the `dataSync` foreground service that keeps a sync pass alive while the app is put away (details in the general map's Sync entry).
- Desktop-only chrome (tray, global shortcut, updater, the capture window) is `#[cfg(desktop)]` in `lib.rs`, with `#[cfg(mobile)]` no-op stubs of the same signatures - see `docs/windows/ARCHITECTURE.md`.

## Open items

- **Dogfood run**: desktop and phone against one real vault for a stretch, every conflict-log entry given a verdict - `DOGFOOD.md` holds the protocol and the table.
- **OS-scheduled background sync** is not built. Sync runs on resume, on leaving the app, on reconnect, on a heartbeat while open and after an edit; a WorkManager worker would go into a plugin as above.
- **Share-sheet capture** is not built; its intent filter would go into a plugin manifest the same way.
- **History** is not ported: Review answers "how did the week go?" on a phone. Revisit if the dogfood run says otherwise.
- **Release keystore**: none exists yet. The Google OAuth Android client is registered for the debug key's SHA-1, so a release keystore also needs its own Android client registered for its SHA-1.
