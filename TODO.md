# TODO (temporary, delete before the first public release)

Open items left after the audit (state as of 2026-10-20). Audit reports themselves are kept in the bundle `~/wrk/backups/app-hypomnema-audit-branch-2026-10-20.bundle`.

## Before the repository goes public

- [ ] O-2: move `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` and `HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_SECRET` from repository secrets into the GitHub environment `release` with a required reviewer; delete them from repository secrets. The workflow already references the environment. On the first tag check that the `release` job waits for approval and that `npm run build` runs before the tauri step.
- [x] Close Dependabot PR #2-#10: all closed, the leftover `dependabot/github_actions/development/actions-...` branch deleted from origin on 2026-10-20.
- [ ] Decide what to do with the `audit` branch: deleted on 2026-10-20, backup in the bundle above.

## Right after going public

- [ ] Enable Private Vulnerability Reporting (Settings > Code security); SECURITY.md already points to `/security/advisories/new`.
- [ ] Enable secret scanning and Dependabot alerts.
- [ ] Branch protection on `main` and `development`.
- [ ] `pages.yml` deploy job runs only when the repository is public: check the first run.

## Live checks on the Windows machine (one session)

- [ ] O-11: installer. Per-user install, first run (onboarding), update over an existing install, uninstall (vault untouched, the "Delete the application data" checkbox clears only `%APPDATA%\com.hypomnema.app`). Use Windows Sandbox/VM or accept reinstalling on this machine (same identifier replaces the installed app).
- [ ] O-7: navigation guard. Build with `build.ps1`, run: window opens, quick capture works, a link in a task description opens the browser, `hypomnema.log` has no "refused to navigate" during normal use.
- [ ] O-31: Calendar/History/Review on edge dates, mobile "back" navigation, tray and quick capture, task mirror after an edit from the phone, Windows high-contrast theme in WebView2. Confirm the icon origin.
- [ ] O-10: two-device sync on 0.109.7 or newer. Install the APK from the Dropbox folder on the phone, edit on the phone, focus the desktop right away: the edit must be kept. Make sure the phone runs a build not older than the desktop.
- [ ] Vault export (0.111.0, Settings > Vault > "Save a copy to Downloads"): not run on a device yet. Check on the phone: the file appears in Files > Downloads > Hypomnema, opens as a zip, and the archive restores a vault when unpacked into a folder and opened. The Android cross-compile of `android_storage::save_to_downloads` is unverified until the next `build-android.sh`. Import from a zip is not built; unpacking by hand into a folder and opening it is the restore path.
- [ ] 0.112.0 phone polish (Upcoming add-on-top and tap-to-open, Recurring calendar order, Day header sync button, Lists indent): not seen on a device yet; the e2e fake is signed out, so the sync button has no visual baseline. Check the header still centres the day on the test phone with Today showing.
- [ ] F-091: the Android library list check in `build-android.sh` is FIXED but unverified; confirm on the next APK build.

## First release

- [ ] O-17: `release.sh --check`, then `release.sh`. Verify that the `release` job starts, `verify` produces notes, `latest.json` contains the `nsis` key, anonymous `curl -I .../releases/latest/download/latest.json` returns 302/200 after publishing the draft, and `gh attestation verify <exe> --repo publius-github/hypomnema` passes.
- [ ] O-18: screenshot for README (`docs/screenshot.png`, uncomment the TODO) from the "Try it with an example" vault, no personal data.
- [ ] O-26: repeat the phase 12 synthesis prompt as a verification pass, once after going public and once after the first release.

## Android (does not block the source release)

- [x] O-33 spike (done 2026-10-20). Answer: SAF does not fit the file core and is not needed; keep the current layout and go to Play with a declaration, with a no-permission fallback build ready.
  - What the code does today: the default vault on Android is `/storage/emulated/0/Android/data/<pkg>/files/vault` (`vault_places::default_vault_dir`), an app-specific directory that needs no permission, is reachable over USB MTP from a PC (on-device file managers cannot see it since Android 11; confirm MTP on the test phone), and is deleted on uninstall. `MANAGE_EXTERNAL_STORAGE` is used only so the in-app folder browser can leave the app's own folders; without the grant the app runs fully (`android_storage.rs`, the "Allow" banner in `MobileVaultFolder.tsx`). Drive sync works from either place.
  - Option 1 (app-private only) is today's behaviour minus the permission: zero code, but the vault cannot be shared with Syncthing/Dropbox/other editors and dies with an uninstall.
  - Option 2 (SAF tree + app-private cache with two-way copy) is rejected: `content://` URIs cannot be opened by `std::fs`, `rusqlite` or `notify`, so a second sync engine (SAF <-> cache) would sit next to the Drive one, with its own conflict handling and a per-file ContentResolver round trip for hundreds of small files. Estimate 2-3 weeks plus a Kotlin plugin, for a feature Drive sync already covers.
  - Option 3 (keep all-files-access) is what Obsidian ships on Play: it requests "All files" as a document management app, which the policy lists as a permitted category, provided the Permissions Declaration Form explains why SAF and app-specific storage are not enough. Hypomnema's justification is the same: a user-chosen folder of hundreds of Markdown/YAML files edited by other apps, watched for external changes, shared with third-party sync. Rejection risk is real: Google answers that non-file-managers get rejected; the review outcome cannot be predicted from policy text.
  - Recommendation: submit with the permission and the declaration (core feature: "open any folder as your vault", named in the listing and in-app). Prepare the fallback before submission: a `build-android.sh` switch that skips `configure_storage_permission`, and the Rust `all_files_access` returning "not declared" so the banner disappears (read the manifest via `PackageManager.getPackageInfo(..., GET_PERMISSIONS)` through the existing JNI path). About 2-4 hours. If Google rejects, rebuild with the switch and resubmit the same day; nothing else changes.
  - Listing / Data safety consequences: the app-specific vault is lost on uninstall; say so in onboarding or Settings > Vault, and point at Drive sync as the backup. Android/data access over USB is a stated feature of the default location; verify once on the real phone.
- [ ] O-30: Google Play publication (paid, built by the owner). (a) `MANAGE_EXTERNAL_STORAGE`: declare as document management app plus Permissions Declaration Form, fallback build without the permission ready (O-33); (b) release keystore and an Android OAuth client on its SHA-1 (debug client stays for dev); (c) Play Console: listing, Data safety (Drive appdata, no analytics), privacy URL on Pages; (d) no Android CI job while the build stays local (F-076 stays open). Android is out of the README until then (phase 1 is the desktop): when published, add it back to the intro, Install (Play link), Status, the Building snippet, the docs map and the license paragraph (Play services under the Android SDK License).
