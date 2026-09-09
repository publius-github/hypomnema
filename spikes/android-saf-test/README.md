# Android SAF spike (docs/android/ROADMAP.md Phase 0, Spike A)

Throwaway app, **not part of the real Hypomnema build**. It exists to answer
one question before `FilesystemSyncProvider` gets built for real: can a
normal Android app get read/write access to a folder the Dropbox app keeps
live-synced, via the Storage Access Framework (SAF), and does that access
survive an app restart and a device reboot?

No Rust, no Tauri, no vault/engine code - just the raw
`ACTION_OPEN_DOCUMENT_TREE` + persistable-URI-permission calls that a real
`FilesystemSyncProvider` would need to build on. See
`docs/android/SPIKES.md` for how this fits the rest of Phase 0, and
`docs/android/ROADMAP.md`'s Spike A section for the exit criteria this
checklist is built from.

Package id `com.hypomnema.safspike` - deliberately different from the real
app's `com.hypomnema.app`, so this installs side by side without touching it.

## Build

```bash
cd spikes/android-saf-test
echo "sdk.dir=$ANDROID_HOME" > local.properties   # not committed, machine-local
./gradlew assembleDebug
```

Produces `app/build/outputs/apk/debug/app-debug.apk` (~3MB, plain Kotlin,
no webview bundled). Verified building clean on this machine's existing
Android SDK/NDK setup (same `ANDROID_HOME`, AGP/Kotlin/Gradle versions as
`src-tauri/gen/android`).

## Install on your phone

With the phone connected over USB (USB debugging on) and Dropbox already
signed in and syncing a vault folder there:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or copy the APK over and open it on-device (allow "install unknown apps"
for whatever file manager/app you use to open it).

## Test checklist (work through in order)

1. **Launch the app.** It should say "No folder linked yet."
2. **Tap "1. Pick synced folder"** and, in the system folder picker, navigate
   into the Dropbox-synced folder that holds (or will hold) your vault - or a
   dedicated subfolder of it, matching the "own subfolder, not the Dropbox
   root" guidance in ROADMAP.md Phase 4. Grant access. The log should show
   the picked `content://...` URI and "took a persistable permission grant."
3. **Tap "2. Write test file."** Confirm the log shows a success line with a
   timestamp.
4. **Check on desktop** (the machine your vault normally lives on) that
   `hypomnema-saf-test.txt` appeared in that Dropbox folder, with the phone's
   model name and the same timestamp inside it. This is the phone→Dropbox
   direction of the exit criterion.
5. **Edit that file from desktop** (change the text, save) and wait for
   Dropbox to show it as synced.
6. **Tap "3. Read test file"** on the phone. It should show your edited
   content, not the phone's original write. This is the Dropbox→phone
   direction.
7. **Tap "4. List folder contents"** any time to sanity-check what the app
   can currently see in the folder.
8. **Restart-survival test:** force-stop the app (Android Settings → Apps →
   Hypomnema SAF Spike → Force stop), then relaunch it from the launcher.
   The log on launch should say "Restored access... (permission survived
   this app restart)" **without** re-showing the folder picker. If it asks
   you to pick again, that's a fail for this exit criterion.
9. **Reboot-survival test:** reboot the phone entirely, relaunch the app,
   and confirm the same "restored access" message appears with no re-prompt.
10. **Background-sync check (informational, not pass/fail on its own):**
    with the app closed (not force-stopped) and the phone not touched for a
    while, edit the test file from desktop, then reopen the app and tap
    "3. Read test file" without tapping "Pick" again - see whether Dropbox
    had already synced the new content down in the background, or only after
    you opened the Dropbox app itself. Note whatever you observe in
    `docs/android/SPIKES.md`, since Spike A's exit criteria explicitly ask
    about "background-sync behavior when the app isn't foregrounded."
11. **Tap "5. Forget folder"** if you want to reset and redo the picker flow
    (e.g. to compare a subfolder vs. the Dropbox root, or the official
    Dropbox app vs. a third-party sync client per ROADMAP.md's fallback
    plan).

## Reporting back

Whatever the outcome (full pass, partial, or fail on a specific step), it
goes into `docs/android/SPIKES.md` under Spike A as the verdict - that's
what unblocks Phase 1's `FilesystemSyncProvider` decision (ship it as
default, ship it as opt-in, or drop it per ROADMAP.md's fallback plan). Worth
noting explicitly: which app/service is doing the syncing (official Dropbox
app vs. a third-party client), the Android version, and anything odd around
step 10's background-sync timing.
