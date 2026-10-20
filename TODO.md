# TODO (temporary, delete before the first public release)

Open items left after the audit (state as of 2026-10-20). Audit reports themselves are kept in the bundle `~/wrk/backups/app-hypomnema-audit-branch-2026-10-20.bundle`.

## Before the repository goes public

- [ ] O-2: move `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` and `HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_SECRET` from repository secrets into the GitHub environment `release` with a required reviewer; delete them from repository secrets. The workflow already references the environment. On the first tag check that the `release` job waits for approval and that `npm run build` runs before the tauri step.
- [ ] Close Dependabot PR #2-#10 if any are still open (recreated after the history rewrite). The branch `dependabot/github_actions/development/actions-...` still exists on origin.
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
- [ ] F-091: the Android library list check in `build-android.sh` is FIXED but unverified; confirm on the next APK build.

## First release

- [ ] O-17: `release.sh --check`, then `release.sh`. Verify that the `release` job starts, `verify` produces notes, `latest.json` contains the `nsis` key, anonymous `curl -I .../releases/latest/download/latest.json` returns 302/200 after publishing the draft, and `gh attestation verify <exe> --repo publius-github/hypomnema` passes.
- [ ] O-18: screenshot for README (`docs/screenshot.png`, uncomment the TODO) from the "Try it with an example" vault, no personal data.
- [ ] O-26: repeat the phase 12 synthesis prompt as a verification pass, once after going public and once after the first release.

## Android (does not block the source release)

- [ ] O-33: spike, time-box 1 day. Can the vault live in a folder chosen through Storage Access Framework (`ACTION_OPEN_DOCUMENT_TREE`, persistable URI permission) given the file core (`std::fs` + `notify` watcher on paths)? Options: (1) vault only in app-private storage plus export/import, (2) SAF plus an app-private cache with two-way sync, (3) keep all-files-access and skip Google Play (sideload / GitHub Releases). Deliverable: recommendation with trade-offs and an estimate; O-30 (b)-(c) are decided only after this.
- [ ] O-30: Google Play publication (paid, built by the owner). (a) `MANAGE_EXTERNAL_STORAGE` under Play policy, see O-33; (b) release keystore and an Android OAuth client on its SHA-1 (debug client stays for dev); (c) Play Console: listing, Data safety (Drive appdata, no analytics), privacy URL on Pages; (d) no Android CI job while the build stays local (F-076 stays open). Update the README Status line when published.
