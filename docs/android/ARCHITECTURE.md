# Android Notes

Supplement to `docs/general/ARCHITECTURE.md` (the shared Rust core + React frontend map, including the phone UI under `src/mobile/` in its Frontend notes). This file covers only what is specific to the Android build. Android is a second build target of the same Tauri project, cross-compiled for `aarch64-linux-android`; iOS is not planned.

## Prerequisites

The script is run from Linux or WSL - the setups it is built and tested on. What a build needs, with the versions the project builds with:

- Node, npm and Rust as for the desktop (README, *Building*); the script adds the missing `rustup` targets itself.
- JDK 17 (`java` on `PATH` or `JAVA_HOME`) - the generated project uses Android Gradle Plugin 8.11, which requires it.
- Android SDK with `ANDROID_HOME` exported: `platforms;android-36` (compileSdk/targetSdk 36, minSdk 24), `build-tools;35.0.0`, `platform-tools`, and the NDK `ndk;27.0.12077973` (found under `$ANDROID_HOME/ndk` unless `ANDROID_NDK_HOME` is set). `sdkmanager --licenses` accepted once.
- `python3` - the script patches the generated manifest and Gradle files with it.

Google sign-in on a self-built APK does not work out of the box: the project's Android OAuth client is registered for the maintainer's signing-key SHA-1 (see Open items). A build of your own needs its own Android OAuth client in Google Cloud for your key's SHA-1 (`keytool -list -v` on the keystore); without one the app works fully, with sync unavailable.

## Build (`scripts/android/build-android.sh`)

- `src-tauri/gen/android` is generated (`tauri android init`) and **not tracked**: the CLI recreates it from `tauri.conf.json` and rewrites parts of it during a build (a new plugin's Gradle module, for one). Nothing in it is hand-edited; everything a build needs there is written by the script on every run:
  - `ensure_android_project` generates the project when it is missing;
  - `sync_launcher_icons` copies the committed mipmaps from `src-tauri/icons/android/` (see Icons in the general map);
  - `configure_storage_permission` declares `MANAGE_EXTERNAL_STORAGE`, so the in-app vault folder browser can leave the app's own folders;
  - `configure_backup` sets `android:allowBackup="false"`: Auto Backup would otherwise copy the default vault (`getExternalFilesDir()`) and the `device-id` to the user's Google backup, and a restore would hand a new phone the old one's sync identity;
  - `configure_signing` signs a release with the keystore named by `ANDROID_KEYSTORE` (+ `ANDROID_KEYSTORE_PASS`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASS`), writing `keystore.properties` and a `signingConfigs` block. Without the variable a release is signed with the debug key - installable for testing, not publishable - and the script says so;
  - `check_android_notices` resolves `universalReleaseRuntimeClasspath` through Gradle and stops the build when it differs from `scripts/general/notices/android-libraries.txt`, printing what to add or remove - the Android half of `THIRD_PARTY_LICENSES.txt` has no CI job, so this is where it is checked.
- APKs are named `Hypomnema-<version>-b<build>-<variant>-<abi>.apk`; the build number lives in `releases/android/.build-number` and increments per run, so a test device can tell two builds of one version apart. `collect_artifacts` copies them into `releases/android/` and, when `APK_COPY_DIR` is set, into that folder too (say a synced folder a test phone installs from). The script header lists the remaining environment overrides (`ANDROID_ABIS`, default `aarch64`; SDK/NDK/JDK roots; `CARGO_TARGET_DIR`; the release keystore).
- `prune_target` runs `scripts/general/prune-target.mjs` first, the same stale-output prune the Windows build scripts do (see the Build section of `docs/windows/ARCHITECTURE.md`); it covers `target/aarch64-linux-android/` and honors `CARGO_TARGET_DIR` and `PRUNE_DAYS`.
- There is no Android CI job: `release.yml` builds the Windows installer only.

## Native code

- Plain Android API calls need no Kotlin: `PlatformWebview::jni_handle().exec()` hands the JNI environment to tracked Rust - `android_storage.rs` checks `Environment.isExternalStorageManager()` and opens the all-files-access settings screen that way (`MANAGE_EXTERNAL_STORAGE` has no runtime dialog), and writes the vault export into `Download/Hypomnema/` through `MediaStore.Downloads` (Android 10+, no permission; the copy of a vault kept in the app-specific folder, which an uninstall deletes).
- Anything the OS instantiates itself (a service, a worker, an intent filter) or that needs an activity *result* lives in a Tauri plugin with its own tracked `android/` module, which Tauri's build wires into `gen/android` on every build and whose `AndroidManifest.xml` merges into the app's. Today that is `src-tauri/plugins/google-auth/` (Google sign-in through `AuthorizationClient` and `SyncKeepAliveService`, the `dataSync` foreground service that keeps a sync pass alive while the app is put away - details in the general map's Sync entry) and `src-tauri/plugins/widget/` (the home-screen list widget, below).
- **Home-screen list widget** (`src-tauri/plugins/widget/android/`, package `com.hypomnema.widget`): plain `RemoteViews`, no Glance or Compose, so it adds no library to `android-libraries.txt`. One widget shows one list - its colour dot, name and open count over a scrolling checklist of its tasks; a row tap ticks the task (unticks it on a checklist, where ticked items stay at the bottom struck through), the name opens the app on the list and + opens it with the add field focused; a priority task carries an accent bar. `ListWidgetProvider` draws it and receives the row taps, `ListWidgetService` is the rows' `RemoteViewsFactory`, `ListWidgetConfigureActivity` is the launcher's placement (and "reconfigure") screen that picks the list, `WidgetStore` is the shared state, and `WidgetPlugin` is the core's door. The widget never runs the core: it draws from `filesDir/widget/data.json`, which the core publishes through the plugin after every export (`widget.rs` in the general map), and a tap appends a `{"task","status"}` line to the queue file the core named in that publish, which the core drains (while running, through a watcher; else at the next launch). Until the core has applied a tap and published again the tap is held as pending in the widget's `SharedPreferences`, so the row flips at once and stays flipped through a republish that predates the drain; pending entries are dropped as soon as the published data reflects them. The list a widget shows is stored per widget id in the same preferences and forgotten when the widget is removed; a list that is gone shows "List not found". The widget's theme is its own light/dark pair in `values`/`values-night` - RemoteViews cannot read the vault's `colors.yml`. A tap's launch intent carries the list id and the add flag as extras, which `WidgetPlugin` takes from the activity's intent (`load`) or a later one (`onNewIntent`) and hands to the core once.
- Desktop-only chrome (tray, global shortcut, updater, the capture window) is `#[cfg(desktop)]` in `lib.rs`, with `#[cfg(mobile)]` no-op stubs of the same signatures - see `docs/windows/ARCHITECTURE.md`.

## Open items

- **Dogfood run**: desktop and phone against one real vault for a stretch, every conflict-log entry given a verdict - `DOGFOOD.md` holds the protocol and the table.
- **OS-scheduled background sync** is not built. Sync runs on resume, on leaving the app, on reconnect, on a heartbeat while open and after an edit; a WorkManager worker would go into a plugin as above.
- **Share-sheet capture** is not built; its intent filter would go into a plugin manifest the same way.
- **The widget's checks** run only on a device: there is no Android CI job and the Kotlin half compiles only in `build-android.sh`. The core half (`widget.rs`) has desktop unit tests. Two points to confirm on the first build: that the generated `TauriActivity` forwards `onNewIntent` to the plugins (Tauri's `PluginManager.onNewIntent` exists for it), and that the launcher honours `FLAG_ACTIVITY_SINGLE_TOP` on the launch intent so a widget tap resumes the running activity rather than recreating it.
- **History** is not ported: Review answers "how did the week go?" on a phone. Revisit if the dogfood run says otherwise.
- **Release keystore**: none exists yet. The Google OAuth Android client is registered for the debug key's SHA-1, so a release keystore also needs its own Android client registered for its SHA-1.
