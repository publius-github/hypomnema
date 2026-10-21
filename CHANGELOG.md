# Changelog

Every version of Hypomnema, newest first. Versions before 1.0 are development builds; history before 0.56.0 lives in the git log.

## 0.116.1 - 2026-10-21

Android today widget fixed and brought in line with the Day screen. A task without a category or weekday marker showed "null [null]" in front of its text (a JSON null read as the word); now only the text. The category is no longer a chip in front of the marker: as in the app it heads its block of rows, in its chip colour, under the section plate (which now wears its cadence colour and count, as the app's plates do); with category headers off in Settings it stays a chip. A row is clamped to two lines with an ellipsis. Both widgets now wear the app's colour scheme - the device's light or dark palette under colors.yml - instead of the launcher's: background, text, muted text, lines, accent, the weekday marker tone and the category colours.

## 0.116.0 - 2026-10-21

Android widgets redrawn. "Hypomnema today" is now read-only: its rows no longer tick a task, a tap anywhere on a row opens the app on the Day (the name does the same, + still opens it with the add field ready). The rows are separated by a hairline and read as the Day screen reads them: the category in bold in its chip colour, the weekday marker ([MON,SAT]) muted, then the text; the header says "Hypomnema: today". "Hypomnema lists" shows only your own lists - the engine's category and Birthdays lists are gone from it - in alphabetical order, each as a card with its name, open count and its open tasks numbered under the name; a card tap opens the app on that list, and the header says "Hypomnema: lists". With neither widget editing anything the tap queue is gone from both halves: the Kotlin side writes nothing, the core no longer watches a queue file. Widget data now carries each task's category, chip colour and weekday marker.

## 0.115.2 - 2026-10-20

Markdown editor (journal, notes): formatting warnings show as the wavy underline only; the warning triangles in the gutter beside every flagged line are gone. YAML config files keep their error markers.

## 0.115.1 - 2026-10-20

Android widgets fixed and the list widget reworked. Both widgets showed "Couldn't add widget" in place of every row: a row's layout held a view class RemoteViews refuses (the priority bar), and a done task's strikethrough went through a setter RemoteViews may not call; the bar is now an image view and the strikethrough a text span. The list widget, now "Hypomnema lists", no longer asks for a list when placed: it shows every list - colour, group / name and open count - as a scrolling list, and a tap opens the app on that list; its name opens the app. The configure screen is gone.

## 0.115.0 - 2026-10-20

A second Android home-screen widget, "Hypomnema today": the day's tasks as the Day screen lays them out - under its section plates in the configured order, Exact date, General, Daily and so on - with the same checklist rows as the list widget: a tap ticks a task off, the name opens the app on the Day, + opens it with the day's add field ready. No configuration: place it and it shows today. The list widget and its mechanics are unchanged; the widget data now carries the day alongside the lists.

## 0.114.0 - 2026-10-20

A home-screen widget for Android: one list per widget, picked when the widget is placed (and again from the launcher's reconfigure). It shows the list's colour, name and open count over a scrolling checklist of its tasks; a row tap ticks the task (and unticks it on a checklist, where ticked items stay at the bottom), the name opens the app on that list, + opens it with the add field ready. The widget draws from a file the core publishes after every change and queues its taps for the core, which applies them while the app runs and otherwise at the next launch; it never needs the app open to tick a task. Light and dark follow the system. New plugin `src-tauri/plugins/widget/` (plain RemoteViews, no new Android libraries), `widget.rs` in the core with its tests, and one command, `widget_launch_target`, for the phone shell to follow a widget tap.

## 0.113.2 - 2026-10-20

The phone's Day header sync button gets the desktop's sync icon: the old one's arrowheads sat away from the ends of its arcs, and the arcs ran against the direction the spinner turns. The time under it is always 24-hour ("12:40", "15:05"), whatever the device locale.

## 0.113.1 - 2026-10-20

The Windows build stopped on Tauri's version check: 0.110.13 had moved the Tauri JS packages forward without the Rust crates. The crates now match the JS packages' major.minor - tauri 2.12, dialog 2.8, notification 2.6, opener 2.7, process 2.4, updater 2.13 - with notification and updater held at 2.6 and 2.13 rather than the newer 2.7 and 2.14, so they don't get ahead of npm. This pulls in webview2-com-sys 0.39.1, which bundles WebView2 SDK 1.0.3800.47; the SDK's license and notice text are unchanged, and the notices are regenerated.

## 0.113.0 - 2026-10-20

A new vault no longer starts blank. Its database gets Home and Work lists with a few tasks and one task on today, and its config files start with real entries instead of commented samples: a daily, a weekly and a monthly recurring rule, a birthday, two weekly focus phrases, a workday and a weekend reminder and two schedule blocks. All of it is ordinary content to edit or delete; `scheduled.yml` keeps its commented sample, since a one-off event with a made-up date would only go stale. A vault already in use is untouched: a config file it lacks still gets the commented sample. Sync treats the starter files like the samples, so a fresh device joining a Drive vault takes the other device's rules without a conflicted copy. "Try it with an example" now adds the welcome note, the journal entry, a scheduled event and two pointer tasks on top of the starter content. The README is restructured: centred header with badges, a contents list, a config file table, and screenshot slots to fill.

## 0.112.0 - 2026-10-20

Phone polish. More > Upcoming: the Add form sits at the top of each list instead of under it, a row opens on a tap (the Edit button is gone; Delete stays beside the row) and a closed row's text stops at two lines, and the Recurring list is ordered by where each rule's next firing falls in the calendar year - January first whatever the month - with that date shown on the row (`RecurringRuleView.next_occurrence`, "YYYY-MM-DD HH:MM" local, null for a cron that does not parse). The Day header gets a sync button on the right of the day navigation, for a phone signed in to Google: it runs a pass on demand, spins while one runs (automatic passes included) and carries the last pass's time under the icon ("12:40" today, "14 Oct" earlier, "never"); a failed last pass tints it. The Lists index draws a bigger fold triangle on a group row and indents the group's member lists one step further, as the desktop's All lists index does.

## 0.111.0 - 2026-10-20

Settings > Vault on the phone gets "Save a copy to Downloads": the vault as one zip archive (notes, journal, configs, the task mirror and the `state/` snapshot the database is rebuilt from; `app.db`, `backups/` and `.trash/` stay out) written to `Download/Hypomnema/` through `MediaStore`, which needs no permission on Android 10+. A vault kept in the app's own folder is deleted together with the app, and the panel now says so next to the button. The `vault_export` command takes a target path on other platforms; no desktop control yet.

## 0.110.13 - 2026-10-19

Dependency updates Dependabot proposed, taken in one step: the CodeMirror packages (view 6.43.14, state 6.7.6, language 6.13.1, commands, search, lang-markdown, language-data, lezer highlight), the Tauri JavaScript side (api 2.12.3, CLI 2.12.2, the dialog, notification, opener, process and updater plugins), `@types/node` 26 and jsdom 30.1.2; third-party notices regenerated. `@vitejs/plugin-react` stays at 4: version 6 needs Vite 8. The workflows move to `actions/checkout` 7, `setup-node` 7, `upload-artifact` 7, `rust-cache` 2.9, `gitleaks-action` 3 (Node 24 runtime, same behavior) and `tauri-action` 1.0 (the inputs this workflow uses are unchanged; `latest.json` now carries GitHub asset URLs).

## 0.110.12 - 2026-10-19

The repository is `publius-github/hypomnema` now: the updater endpoint, the website, README, SECURITY.md, the issue template, the About links and the crate metadata point at the new name (GitHub redirects the old one). The GitHub Pages address becomes `https://publius-github.github.io/hypomnema/`.

## 0.110.11 - 2026-10-19

The "Sign in with Google" button (Settings > Sync, the phone's first-run screen and its Settings) follows Google's sign-in branding guidelines: the four-color "G", 40px, Google's light and dark schemes, hover and press as the guidelines specify (`components/GoogleSignInButton.tsx`). README and `THIRD_PARTY_LICENSES.txt` note that the "G" is Google's trademark, used under those guidelines rather than the GPL.

## 0.110.10 - 2026-10-19

The project website in `site/` deploys to GitHub Pages (`pages.yml`, on every push to `main` that touches it), and README's three privacy-policy links point at <https://publius-github.github.io/app-hypomnema/privacy.html> instead of the HTML source in the repository.

## 0.110.9 - 2026-10-19

The release workflow records a SLSA build provenance attestation for the Windows installer (`actions/attest-build-provenance`), so `gh attestation verify Hypomnema_<version>_x64-setup.exe --repo publius-github/app-hypomnema` proves a download came out of this repository's workflow on the tagged commit; README's Install and Code signing policy say how. The step is skipped while the repository is private.

## 0.110.8 - 2026-10-19

On Windows the Google refresh token now lives in Credential Manager (a generic credential named `com.hypomnema.app.Hypomnema`, kept local to the machine) instead of a plain `google.json` in the roaming profile folder. The first sync or sign-out after upgrading moves an existing token file into the credential store and deletes it; signing out deletes the credential. SECURITY.md and the privacy page say so, and that uninstalling leaves the credential in place unless you sign out first. `keyring-core` and `windows-native-keyring-store` join the dependencies (notices regenerated); the tests run the same path against keyring-core's in-memory store.

## 0.110.7 - 2026-10-19

The phone's Journal and Notes editors are covered end to end: typing is saved once it pauses, a day switch saves what is still waiting, and an entry or note whose save keeps failing is not left behind for the next one (the same contract the desktop editors already had under test). `build-android.sh` resolves the release runtime classpath through Gradle before every build and stops when `scripts/general/notices/android-libraries.txt` differs from it, so the Android part of the third-party notices can no longer drift.

## 0.110.6 - 2026-10-19

A task title keeps at least 3rem of its row when the hover buttons come in, so a narrow day column with a wide font no longer squeezes it to nothing (where a click could not reach it; CI's Linux font did). The e2e suite opens the task dialog from the keyboard where the mouse path is not what is under test, and the width check now also measures a hovered row. `cargo deny` ignores the three `zip` 4 advisories with the reason: the updater only extracts archives, and this app's updates are NSIS executables; the stale glib ignore is gone.

## 0.110.5 - 2026-10-18

Leftovers of the retired Dropbox sync are gone from the code: comments, test fixtures, the phone's old-passphrase text and the task-mirror hint no longer name it. The warning for a vault inside a Dropbox, OneDrive or Google Drive folder stays.

## 0.110.4 - 2026-10-18

Licensing settled for publication. Copyright Siarhei Zverau in About, the README, the website and the privacy policy; GPL-3.0-only with an additional permission under section 7 for linking with Google Play services (`LICENSE-EXCEPTION.md`), so the Android build can be shared under the GPL; the name and logo are kept for the official app (`TRADEMARKS.md`: a distributed fork takes its own). Security reports go through GitHub private vulnerability reporting, other contact to publius.it@gmail.com. Contributions are signed off under the Developer Certificate of Origin, and CI checks every pull-request commit for it. About shows a donation link once one is set (`DONATE_URL`), and `.github/FUNDING.yml` is ready for the Sponsor button.

## 0.110.3 - 2026-10-18

A task row's priority star, drop and delete hover buttons close the row, after the time and the Priority/Overdue/Rate badges, and close the row with delete last; in a card at least 17rem wide they hold their room while unseen, so no badge shifts on hover (a narrower card cannot spare it from the title).

## 0.110.2 - 2026-10-18

The sync time under the Sync button is always 24-hour HH:MM; the About window is twice as wide.

## 0.110.1 - 2026-10-18

Settings search bar fills the row and Show advanced settings closes it at the tab line's right end; a task row's drop and delete hover buttons stand left of the time and Priority/Overdue badges, so the badges no longer shift on hover.

## 0.110.0 - 2026-10-18

- Settings is as wide as Upcoming, so hints no longer wrap into narrow columns.
- New setting Tasks > Task cards > "General tasks get the overdue mark": off, a one-off task left unfinished moves to today without the Overdue badge (recurring instances keep it; a mark already given clears).
- Section plates (Daily, Weekly, Priority...), list and group names are no longer uppercased: plates read in their own capitalization, names exactly as typed; plate labels, the Priority and the Overdue badges are bold at the task text size.
- In a recurring task's day list marker such as [MON,SAT] the day it fired on is bold.
- + New list and + New group are the same height.
- The completion-rate hint in Settings spells out when the Rate chip shows and when it does not.
- A new default journal template: a short evening review (mood and energy, went well, could be better, learned, grateful for, tomorrow's one thing). A vault still on the old default gets the new one; an edited template stays.

## 0.109.8 - 2026-10-18

The local Windows build (`scripts/windows/build.ps1`) no longer reinstalls `node_modules` on every run: it runs `npm ci` only when the folder is missing, was installed for another OS (after the WSL-side Android build), or holds packages that differ from `package-lock.json` (`scripts/general/node-modules-current.mjs`; a version bump alone does not count).

## 0.109.7 - 2026-10-18

The development build is its own app: `npm run app:dev` runs "Hypomnema Dev" (identifier `com.hypomnema.app.dev`), with its own per-device folder, sign-in and device id, beside an installed Hypomnema and never on its vault; the dev server no longer crashes on Windows when Cargo rewrites its output. Windows' "Show animations" off stops the sync spinner and the drag and toggle transitions. File errors name the file everywhere (backups, settings, the snapshot, the task mirror, sync, Notes copies). Tauri CLI matches the Tauri crate (2.11.5), so the installer records its bundle type for the updater; the Android build passes `--apk` the way that CLI takes it. Node is pinned in `.nvmrc` (22.23.3, what CI runs) and `engines` (22.22.2+ or 24.15+); the docs name Rust 1.98.0. Tests: a reminder toast opens its task, a Notes save that keeps failing holds the editor, reduced motion and high-contrast themes.

## 0.109.6 - 2026-10-18

License notices are complete. The third-party notices now carry the license of Microsoft's WebView2 loader, which the Windows binary links statically; the full list of Android libraries in the APK (80, from the release build's dependency tree, Google Play services marked as proprietary); and the authors and source of every package that ships without a license file. About names where the source code lives. README and the website say which parts of a build are not open source and whose trademarks Google, Drive, Windows and WebView2 are.

## 0.109.5 - 2026-10-18

Documentation that says only what is true. The README gains a Status section (pre-1.0, Windows the shipped platform, Android buildable but unpublished, installer not code-signed, one maintainer, no roadmap promised), names the six Settings tabs that exist (settings profiles were removed in 0.102.0), and shows the whole vault layout - `state/`, `.hypomnemasyncignore`, the synced `colors.yml` and `shared.yml`. It no longer claims macOS development works (only Windows and Linux are checked), and the code signing policy says CI signs the update artifacts, not the installer. CONTRIBUTING warns that a development build shares the installed app's per-device folder - remembered vault, Google sign-in, device id - and so opens the real vault; SECURITY no longer points Android users to a release that does not exist. The website's download button points at the latest release, its Android line says the app is not published yet, it links the source code, and the privacy policy's date matches its last change. The PR checklist includes the e2e run. `prune-target.mjs` rejects an unknown argument instead of pruning, and `--help` prints the usage.

## 0.109.4 - 2026-10-18

Release pipeline fixes. The release workflow could not start at all: it called CI with fewer token permissions than one of CI's jobs asks for, which GitHub rejects before running anything; it now grants exactly those. A release now ships the version already in `VERSION` - `release.sh`/`release.ps1` no longer bump it a second time (which left every release without a changelog entry); they refuse a missing CHANGELOG entry, manifests out of step, a branch behind origin or an existing tag, and `--check`/`-Check` runs the checks alone. The release workflow checks the tag and the CHANGELOG entry first, in a minute instead of after half an hour of gates, and uses the entry as the release notes. CI fails when the generated TypeScript bindings or `THIRD_PARTY_LICENSES.txt` are stale, runs weekly as well, cancels superseded pull request runs and pins the gitleaks version. Dependabot proposes updates to `development`, a week after a version is published.

## 0.109.3 - 2026-10-18

Build fixes. The local Windows build script (`build.ps1`) now stops when `npm ci` or the Tauri build fails; it used to carry on and copy an older installer from an earlier build into `releases/windows/` under the new version's name. It now copies only the installer this run produced. The version bump and release scripts keep `package-lock.json`'s own version in step (it had stayed at 0.105.3). CI runs Cargo with `--locked`, so a `Cargo.toml` change without its lockfile fails the checks. An engine test no longer fails on machines east of UTC+9 or west of UTC-10. The build instructions match the scripts: which local builds sign updater artifacts, one list of Linux packages, and Android prerequisites (JDK 17, SDK 36, NDK, `python3`, now checked by the script) with a note that Google sign-in in a self-built APK needs its own OAuth client.

## 0.109.2 - 2026-10-17

Data safety pass. A task changed while a sync pass is running is no longer lost when the pass brings in the other device's changes. A database restore from the snapshot that failed or was cut short is tried again on the next start instead of leaving an empty task list that would then be written over the snapshot and synced to the other devices. A device running an older app version stops syncing with "update the app on this device" instead of dropping fields it does not know (a list's group, a checklist) on every device. A database that cannot be replaced during a rebuild is left as it was, and if a rebuild fails the next pass merges again instead of uploading the old state. The daily database snapshot is also taken at each day change, not only when the app starts, so a desktop living in the tray keeps getting them. A note deleted on the other device goes to `.trash/`. An unreadable `app.db` is moved aside and rebuilt from the snapshot. The snapshot is read in one transaction, and restoring a backup no longer overwrites `app.db` in place.

## 0.109.1 - 2026-10-17

Security pass before going public. The app window can no longer be navigated away from the app: a link the interface fails to catch opens in the browser instead of replacing the app with a web page. A backup id with a `:` is refused (on Windows `C:name` would have pointed outside the backups folder). The Android build opts out of Auto Backup, so the vault and the device id do not go to Google's cloud backup. The release workflow keeps secrets out of third-party build code: no checkout leaves a token behind, the frontend is built in its own step without secrets, and the signing step runs no npm script; it runs in a `release` environment. SECURITY.md and the privacy policy say plainly that the desktop's Google token is an unencrypted file (the privacy policy wrongly offered a passphrase the desktop has no screen for), and the README says when a release is signed.

## 0.109.0 - 2026-10-17

Keyboard and screen-reader pass. Dialogs take focus when they open, keep Tab inside and give focus back on close; deleting a task from its card puts focus on Undo. Errors, Undo and due reminders are announced, and dragging a card with the keyboard says the task's and the day's names instead of internal ids. Task titles in the day columns stay readable (the hover buttons no longer reserve their width), the left bar fits the default window and scrolls on the smallest one, and the week's phrase no longer covers the header controls. Every text size follows Base font size, which Ctrl+= / Ctrl+- / Ctrl+0 now step; About and the README list the keyboard shortcuts. A due reminder opens its task on click. Each page has a heading for screen readers.

## 0.108.1 - 2026-10-17

The motto reads "Your mind. Organized." in About and on the website.

## 0.108.0 - 2026-10-17

New app icon on every platform: a black dog-eared H on a paper-white tile; About and the website show the serif Hypomnema wordmark with the motto "Your mind, organized."

## 0.107.7 - 2026-10-17

The Android build compiles without warnings: the desktop-only Google sign-in (the loopback OAuth flow, PKCE, token refresh and the stored token file) and the scheduler's quit and focus hooks are now built for the desktop only, instead of being compiled into the phone build unused. ts-rs no longer warns about serde attributes it does not read.

## 0.107.6 - 2026-10-17

Fixes from the functional audit. A task with neither a day nor a list no longer drops out of every view: clearing the date of a task added under a day, picking "No list" for an undated one, or undoing a delete whose list is gone now puts it in the quick-capture list (Inbox by default). Emptying old Notes trash only touches the entries the app put there - a `.trash` folder shared with another app (Obsidian uses the same name) used to lose any of its files or folders whose names started with a digit, for good. Adding a rule, event, birthday or reminder from a form to a config file that cannot be read (bytes that are not UTF-8, a lock) is refused with the file's name instead of replacing the whole file with the one new item - after which the engine would also have cleared the lost rules' tasks. Editing or deleting a recurring rule, a focus phrase, a day reminder or a schedule block names the item the editor was opened on, and the core refuses the write when the file changed in the meantime (a sync pass, an edit in Notes) instead of changing another item. When a Notes or Journal save fails, opening another note, entry or day stays on the unsaved one until it saves, rather than letting the next keystroke elsewhere replace it. A refused quick add gives the typed text back. The README and the rule editor now say what the engine has always done: removing a recurring rule, or changing its schedule, description or an item, clears that rule's past completed tasks too, so History, streaks and rates start over (the delete dialog used to claim past instances stay).

## 0.107.5 - 2026-10-17

Fixes and tests from the test-strategy audit. Putting a folder that has already synced under `.hypomnemasyncignore` no longer stops sync with "most of what this device had synced is gone" - the mass-deletion guard counted the ignored files as missing from Drive, so with more than the guard's share of the vault ignored every pass was refused; it now counts only files still shared. A file ignored after it synced no longer sits in the Sync tab as a change waiting to go up forever. A sync pass reads the ignore patterns once and hands them down instead of keeping them process-wide. When rebuilding the database after a sync merge is refused, the half-made new database is removed before the old one is put back. New tests cover opening a vault (the mandatory backup before a schema upgrade, rebuilding a missing database from the state snapshot, a broken snapshot stopping the open), the rebuild's rollback, every command's argument names against the Rust side, the phone calendar dropping a late month, and - through a fake core that can now refuse a command - what the window shows when the core says no: the config error banner, a rolled-back status change, and the mass-deletion guard's "Upload this vault again".

## 0.107.4 - 2026-10-17

Fixes and cleanup from the code-quality audit. A sync pass no longer writes the other device's version over a local file it cannot read at that moment (locked by another app, a cloud placeholder offline): only a file that is really missing is downloaded outright, any other read error lists the file under failed and the next pass tries again - before, edits in such a file could be lost without a conflicted copy. Io errors on Notes and Journal files and on every atomic write name the file ("io error on …\notes\a.md: Access is denied"). A task-mirror watcher that fails to start, and a settings reload that fails, are now written to the log instead of vanishing. The phone calendar no longer shows the previous month's projections when paging quickly. The start of a day is computed one way everywhere in the engine, including time zones whose DST change skips midnight. Under the hood: the four Notes/Journal editors (desktop and phone) share one autosave hook instead of four copies; the longest functions (mirror import, sync pass, recurring generation) are split into named steps with no change in behaviour; leftover dead code and stale "not wired yet" notes in the sync modules are gone, and blanket `dead_code` allowances no longer hide new dead code.

## 0.107.3 - 2026-10-17

Sync and responsiveness fixes from the architecture audit. Google Drive and sign-in requests now time out (30 s to connect, 120 s for a reply, 15 min for a whole file) and a server's `Retry-After` is honoured for at most 60 s: a connection that died mid-pass (a laptop put to sleep, a Wi-Fi switch) used to hang the pass for good, and since a pass holds the engine lock, the day's recurring tasks, the Markdown mirror, the state snapshot and every later sync stopped until restart. The banner for a broken config file no longer disappears after quick capture or a sync pass while the file is still broken (`vault-updated` from an emitter that read no config now carries `null`). Backlinks, journal search and the journal list walk the files without holding the vault lock, so opening a note no longer holds up task edits. The pending-changes count (Sync tab, the after-edit sync trigger) honours the vault's `.hypomnemasyncignore` before the first pass of a session and after switching vaults; the pass and the push share one vault walk.

## 0.107.2 - 2026-10-17

Build housekeeping, no change to the app. The Cargo target dir no longer grows without bound: the Windows and Android build scripts first run `scripts/general/prune-target.mjs`, which removes build output untouched for 7 days (`PRUNE_DAYS`) whenever a newer build of the same unit exists - every version bump used to leave a full copy of the test binaries and incremental caches behind, 118 GB by now. The dev profile keeps line tables only (none for dependencies), so a test binary is about 10 MB instead of 370 MB, and the lib no longer builds an iOS-only `staticlib` (a 1 GB archive per debug compile)

## 0.107.1 - 2026-10-17

Frontend structure, no visible change (the visual baselines of Reminders, Dashboard, Days and the phone day are pixel-identical). The store is assembled from slices - vault and settings, the task snapshot, undo, navigation - with the theme code beside them; `useAppStore` and its API are unchanged. Shared pieces replace repeated code: `useEditingTask` (Dashboard, Days), `useDayAmbient`/`DayAmbientLines` (the desktop day column and the phone's day), `OptionalColorField` (list and group dialogs), and one `RowListEditor` behind the three Reminders tabs. The schedule form's time fields are labelled

## 0.107.0 - 2026-10-17

A friendlier first run. The welcome screen offers *Try it with an example* beside *Select vault folder*: it opens an empty folder as a vault with two lists and their tasks (one with a description and subtasks), a daily, a weekly and a monthly rule, a scheduled event, a birthday, a weekly focus, a day reminder, two linked notes and today's journal entry - an ordinary vault made through the same code as your own edits. Notes on the desktop show the vault's own notes from the start instead of asking for a folder first (the phone already did); *Use another folder* in the sidebar still points it elsewhere. Settings keeps fine-tuning off the page until *Show advanced settings* is ticked (cadence buckets, generation, calendar projections, the Markdown mirror; app.yml `settings_advanced`) - a group already changed, or one a search lands in, shows either way

## 0.106.0 - 2026-10-17

Accessibility. Task cards move with the keyboard: focus a card, Space picks it up, the arrow keys carry it to another day or list, Space or Enter drops it, Escape puts it back - and Enter opens it; the drag instructions are read out. Rows that open an editor on click (Upcoming, Recurring, Reminders) and subtask titles are reachable with Tab and open with Enter. Dialogs are announced as dialogs, icon buttons by what they do, the open section and tab are marked, the editors and every form field are named. Contrast meets WCAG AA on both themes: the light theme's danger, warn, info and muted text and the dark theme's accent and danger are a little deeper or brighter, filled buttons on the dark theme use a darker shade of the accent so their white text stays readable for any accent, category headers adapt like the other object colors, and section counts are no longer dimmed. Checked by eslint-plugin-jsx-a11y and by axe-core over every screen in the e2e suite, which also gains keyboard specs; the visual baselines compare at zero tolerance

## 0.105.3 - 2026-10-16

Tailwind CSS 3 -> 4, with no visible change: all 41 screens of `npm run e2e:visual` (every section and Settings tab in both themes, the task dialog, the vault picker, the phone tabs) are pixel-identical before and after. The JS config is gone - the palette lives in src/styles.css as `@theme inline` over runtime variables renamed to `--rgb-*` (RGB triplets) and `--hex-*` (done/waiting/dropped marks), `.input`/`.btn-*` are `@utility` classes, and a few base rules keep Tailwind 3's rem line heights, border and placeholder colors, button cursor and date-field height. PostCSS runs @tailwindcss/postcss; autoprefixer is no longer needed. `npm audit` is now clean across all dependencies, dev tooling included

## 0.105.2 - 2026-10-16

Dependencies and tests. React 18 -> 19, notify 6 -> 8, rusqlite 0.32 -> 0.40 (bundled SQLite), ureq 2 -> 3 (both HTTP transports ported: every status comes back as a reply, bodies are read without a size cap, rustls with the bundled webpki roots as before). End-to-end tests: Playwright drives the production bundle in Chromium against an in-memory fake of the core (e2e/app/backend.ts, through Tauri's mockIPC) - boot, every section, adding, completing, deleting and undoing a task, the task editor, search, settings search, notes, journal, the vault picker, the light theme - and `npm run e2e:visual` keeps per-machine pixel baselines of every screen, both themes and the phone tabs. Coverage reports: `npm run coverage` (v8) and cargo llvm-cov, both uploaded by CI, which also runs the e2e suite; e2e and the configs are type-checked (tsconfig.node.json) and linted

## 0.105.1 - 2026-10-16

Open-source audit fixes, no change to how the app works. Sync refuses remote paths that could leave the vault or that Windows would rewrite (`..`, `.`, empty segments, `\`, `:`, control characters, trailing dot or space, device names like CON or nul.md) - they stay on the device that has them, like an ignored file (sync_paths.rs, with tests). rustls 0.23.43 -> 0.23.46 (RUSTSEC-2026-0285/0346/0348/0349); serde_yaml (archived) replaced by its maintained continuation serde_norway, same API and output; dev tooling: vitest 2 -> 5 (critical tinypool advisory), vite 6.4.4, postcss 8.5.30, typescript-eslint 8.71.2. A long-run engine invariant test (no duplicate (rule, period), no-op reruns, kept statuses, superseded deletions stay gone); tests of the largest modules moved to <module>/tests.rs. CI: read-only token, actions pinned to commit SHAs, Rust pinned to 1.98.0, a Windows clippy/test job, an audit job (cargo-deny with src-tauri/deny.toml, npm audit of runtime dependencies, gitleaks); release.yml grants write only to the build job; Dependabot grouped and capped. Repo hygiene: .editorconfig, .gitattributes (LF), an opt-in .githooks/pre-commit, a .gitignore cut from the Visual Studio template to what the project produces, the full Contributor Covenant 2.1, README badges and an accurate note on when a deleted generated task comes back, SECURITY known limitations, dead links to retired planning docs removed from code comments; the installer targets list NSIS only

## 0.105.0 - 2026-10-16

Readiness for other users. A diagnostic log, hypomnema.log in the app's config folder: panics, failed commands, render crashes, unhandled rejections and background failures (state export, daily backup, automatic sync), rotated at log_max_kb (app.yml, 1 MiB). About gains Copy diagnostics (version, platform, the log's tail - copied for the user to read and paste, never sent), Show log file and Report a problem (the GitHub bug form, prefilled with the version; the form gains a Diagnostics field). A render crash shows a "Something went wrong" screen with Reload instead of a blank window. Before a schema upgrade the database is snapshotted to backups/db/pre-upgrade-*.db (listed in the restore list; if the copy fails the upgrade does not run). Poisoned-lock unwraps in the Drive provider use lock_or_recover. CI runs on development too, and release.yml runs the full CI before building an installer. README: Troubleshooting and uninstall notes; the privacy policy mentions the log

## 0.104.1 - 2026-10-16

The updater signing key's local file is ~/.tauri/hypomnema.key (was app-pkb.key) in build.sh, build.ps1 and the docs - rename the file to match

## 0.104.0 - 2026-10-16

The startup update check can be turned off: Settings > General > Updates (update_check, default on, desktop only; the privacy policy says so). README gains a code signing policy section (build only in CI, roles, privacy statement) for a SignPath Foundation application. build-android.sh copies APKs to an extra folder only when APK_COPY_DIR is set instead of a hardcoded personal path, and the per-machine notes leave CLAUDE.md

## 0.103.1 - 2026-10-16

Open-source readiness: the updater checks the renamed repository (publius-github/app-hypomnema) instead of relying on GitHub's redirect from app-pkb; the release workflow passes HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_SECRET (and an optional HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_ID variable) so CI-built installers can sign in to Google; the desktop OAuth client id can be overridden at build time for self-builds; release.ps1 syncs Cargo.lock for the right crate name; the window title and leftover app-pkb names are gone; README gains an Install section, plus CONTRIBUTING, a code of conduct, issue and PR templates and license metadata in the manifests

## 0.103.0 - 2026-10-16

Task rules sync between devices: retention, catch-up window, cron-by-day, done-list cleanup at rollover, priority overdue, the cadence bucket thresholds, the quick-capture list and the completion-rate inputs move from the per-device app.yml into .hypomnema/config/shared.yml, which syncs like colors.yml - the engine runs on every device, and different rules on two devices would clean up and generate differently. They keep their Settings controls. On first open a device whose app.yml holds non-default values for them writes those into shared.yml; one at the defaults waits for the file to sync in. shared.yml is editable in Notes > Config. Phone settings trimmed to match the desktop: text size is fixed at 16px, Appearance and Tasks & engine merge into one General panel (theme, done display, capture list, notifications, retention, catch-up, cron time), and the snooze length, the engine-run button and the sync timings and guard leave the phone's Settings (still in app.yml)

## 0.102.0 - 2026-10-16

Settings made short for publishing: from 86 controls on 9 tabs to 44 on 6 (General, Tasks, Recurring & calendar, Capture & alerts, Data, Sync). Fine-tuning keeps its defaults and moves to app.yml - column spacing and plates, opacities, chip size, done-hold and undo timings, snooze and toast lengths, sync interval/debounce/focus/quit/guard, mirror ids/agenda/today days, the streak strip - and app.yml is now editable in Notes > Config next to colors.yml; the bottom of Settings links both. Removed: the invisible gap band and its four knobs (breaks are plain space), the database snapshot switch (always on - sync depends on it), settings profiles. Merged: weekday + [EVERYDAY] markers into one switch, the rate chip and its alert-only switch into Off / Below threshold / Always, bold category headers into category headers, tray icon + close to tray into Keep running in the tray, list and list-task sorting into one; the four fold-by-default switches are gone - a fold clicked on a plate is now remembered across restarts. An app.yml from an older version is rewritten once without colors and retired fields

## 0.101.0 - 2026-10-16

The color scheme syncs: every color setting moves out of the per-device settings/app.yml into .hypomnema/config/colors.yml, which travels with the vault like the other user configs, so the phone shows the same colors as the desktop. A missing colors.yml means the default colors; colors left in an old app.yml are ignored. colors.yml is edited in Notes > Config (it opens on the colors in use) or written by a profile apply, and is backed up before every rewrite. The phone's Settings drop the cadence color pickers and the screen-edge inset fields (still settable in app.yml)

## 0.100.5 - 2026-10-16

Journal: the entry header gets the same day stepper as the Dashboard and Days headers - ‹ ›, the date picker and Back to today when away from it - and the sidebar drops its own Today button and date field, keeping only the list of entries

## 0.100.4 - 2026-10-16

One ‹ / › arrow button for stepping a view by a period - the Dashboard and Days day grid, the Journal day, the Calendar and History month and the Review week now share the same look (the last three used < > before); the Notes editor header drops its "Ctrl/Cmd+click a link to open it" hint

## 0.100.3 - 2026-10-16

The page area always keeps room for its scrollbar, so the header controls (Days, + Task) stand in the same spot on Dashboard, Days and Lists whether or not the page scrolls

## 0.100.2 - 2026-10-16

All-lists index never opens a group view any more: with flat groups a group's row scrolls (Lists page) or pages (dashboard) to its first member list instead; the group view is entered from the group chip on a list header or a group tile

## 0.100.1 - 2026-10-16

All-lists index: a jump on the Lists page lands the column a little below the top edge, so its highlight ring is no longer cut off; top-level lists start at the left edge, under the groups' ▸ markers, which are a size larger, and group members hang one step past the group's name

## 0.100.0 - 2026-10-16

Notes: Markdown headings stay bold and colored but no longer grow - every line of a note is the text size. Alt+Z toggles word wrap in the editor (for the session, across notes): off, a long Tab-aligned table keeps its rows on one line and scrolls sideways. Page headers: the view controls on Dashboard, Days and Lists share one component with one spacing - the same gap between controls and before + Task; the Lists page's column count is called Lists, as on the dashboard; the dashboard's Days count moves to the right end, where the Days page has it

## 0.99.0 - 2026-10-16

Colors leave Settings: every color control is gone from the Settings page - the Appearance palette (accent, background, panels, borders, text tones) and the contrast floor, cadence and status-mark colors, category chip coloring, closed-section plate colors, gap fill, day header, reminder, weekly focus, weekday marker, rate alert and list date chip colors; they are still read from app.yml and profiles, edited by hand. New defaults from the owner's profile: weekly cadence amber #d8ac5f, category chip blue #5194e6, dropped mark #b76262, weekday marker violet #bb9dc8, Not done, dropped folded by default, the exact-date stripe kept inside lists, and a lighter dark-theme secondary text (#bfbfbf). The framed section-panel layout is removed (section_cards, section_gap, category_gap_bands): the flat list view is the only one. Section plates (DAILY, WEEKLY, DONE...) are bold. Breaks: three stripes still open the closed blocks, but between Postponed / Done, waiting / Done / Dropped there are now two

## 0.98.0 - 2026-10-16

Colors adapt to the theme: every object color - cadence plates and stripes, category/list/date chips, status marks, section rails, list and group dots, the day header, reminder, weekly focus and weekday marker tones - keeps its hue but is moved in lightness (OKLCH) just far enough to read on the current theme: lighter on dark panels, darker on light ones, judged against the actual surface colors. The floor is a new Settings > Appearance option, Color contrast floor (Off / 3:1 / 4.5:1 WCAG AA - default / 7:1 AAA); marks stop at 3:1, and a color that already reads is left exactly as picked

## 0.97.0 - 2026-10-16

New default color palette, tuned for both themes: every object color is picked in OKLCH at the lightness that reads best on dark and light panels alike (about 3.7-4.1:1 on all four surfaces). Cadences: exact coral #df4645, daily teal #0a8c81, weekly blue #2f7dda, monthly violet #8b68db, yearly pink #cb5092, General neutral; closed plates and status marks: postponed amber #a97205, waiting cyan #0a88a5, done green #079042, dropped neutral gray #797d85; category chip steel #6b7f98 (alternate pair lime #5a8a05 / orange #c95e05), habit-rate alert orange #c95e05; the varied chip palette is twelve hues on the same rule. Main text, weekday marker and the list date chip follow the theme by default

## 0.96.7 - 2026-10-16

New defaults: editor line numbers on, dashboard split 75, UI and editor font size 16, and Postponed, waiting and dropped sections start unfolded (Done still folds); the color defaults set here were replaced in 0.97.0

## 0.96.6 - 2026-10-15

Settings regrouped so related settings sit together: Appearance keeps only the theme, one palette list (incl. main and secondary text) and fonts; Views is now Pages - Left bar, Dashboard (split, weekly focus color), Lists page, History (streak marks); Task cards splits into Card colors, Chips & categories (with the category block headers), Weekday markers (with their color) and Completion rate; Columns opens with the column layout (sections and separators, moved from Views) and a Postponed and done tasks group holding the done display, sort, hold-before-move, plate colors, fold defaults and closed-row opacity, and Day columns gain the day header and reminder colors; Data gets Journal & notes (editor line numbers, stamps, day tasks, template) and Done tasks cleanup (retention, clear done list tasks, delete-done, archived lists)

## 0.96.5 - 2026-10-15

Page layout is set on the pages, not in Settings: the Dashboard header gains a Lists column count and the Groups Folded/Flat switch beside its Days count, and Settings > Views drops Day columns on the Days page, Grid columns on the Lists page, the dashboard's list-column count and the grouped-lists switch (all already on their page headers); the Settings content width setting is gone - the page is exactly as wide as its tab strip on one line

## 0.96.4 - 2026-10-15

About tells the truth about the network: nothing goes to the developer, Google Drive sync goes through your own Drive, the desktop app checks GitHub for updates; it also carries the copyright line, the GPL no-warranty notice and the full third-party license texts (THIRD_PARTY_LICENSES.txt, generated by scripts/general/third-party-licenses.mjs and compiled in); the repo gains an English README, a static website with a privacy policy (site/), SECURITY.md and this changelog

## 0.96.3 - 2026-10-15

Desktop rail: Sync also runs a Google Drive pass after the engine when an account is signed in, and shows the last pass's day and time under the button (red, with the error in the tooltip, when it failed; scheduler passes update it too); the theme toggle leaves the rail - it stays in Settings > Appearance

## 0.96.2 - 2026-10-15

Phone Settings gets an About panel: the desktop dialog's text, logo and version (shared AboutContent), the version shown on its index row

## 0.96.1 - 2026-10-15

Phone polish: Day and Journal share one header (DayHeader: left action, the day's name over its date between drawn chevrons, the label as the date picker, Today only away from today), bigger drawn icons for search/menu/arrows; task-row PRIORITY/OVERDUE/Rate badges stack in a fixed column reserved on the right instead of wrapping under some titles; the Lists index shows groups open in place with their lists indented under a ▾/▸ fold (remembered per phone) and a ⋯ into the group screen; the hardware back button goes through Tauri's back-button listener, registered only while a step is left to undo, and steps back to Day on today before the press that closes the app

## 0.96.0 - 2026-10-15

Conflicts resolved in place, smarter reminders, a richer Journal: the conflict list's "Compare and resolve" shows a file against its conflicted copy line by line and keeps one (the other goes to .trash/), the Notes tree badges conflicted copies; reminders can fire N minutes ahead, toasts last a set time and leave when their task is checked off, and a fresh start folds already-passed reminders into one summary instead of a burst; the desktop Journal steps days with ‹ › and Alt+←/→, names the weekday, folds its index by year with month headings, shows "On this day" entries from earlier years and the day's tasks under the header; History's daily streaks carry a strip of their newest instances

## 0.95.1 - 2026-10-15

Notes edited on both devices merge again: the sync's line merge and the editors' save merge take a note's Created / Last edited header off and merge it on its own (earliest Created, latest Last edited) instead of reading two devices' different Last edited minutes as a same-line clash; saves and the sync's apply of a download share a file lock across read-merge-write; every editor (desktop and phone Journal/Notes) queues its saves one at a time, marks itself saved only when nothing was typed after the landing save (a stale "Saved" let the watcher reload over fresh typing), and keeps a failed save for the next flush with a "Not saved · Retry" indicator; conflict log times in local time; note saves poke the sync scheduler

## 0.95.0 - 2026-10-15

Editor saves merge instead of overwriting: journal_save/kb_write take the text the editor started from and three-way merge with what changed on disk under it (a sync pass bringing the other device's edit), same-line clashes keep the disk version as a "conflicted copy edited elsewhere" logged under "to review"; all four editors settle onto the merged text and reread on an external change when nothing is unsaved. Sync writes are atomic (write_atomic_bytes, fsync before rename), .trash/ and staging files never travel, .hypomnemasyncignore excludes paths of the user's choosing, CRLF/LF compared alike in line merges, merge stamps in milliseconds (migration 020) compared as instants with a device-id tie-break. Notes: a folder can no longer be pasted into itself, .hypomnema/ outside config/ cannot be deleted/moved from the tree, dotted folder renames keep the typed name, rename/move save the pending edit and follow the open note

## 0.94.0 - 2026-10-15

Sync without hand-merging: text files (md/txt/yml) edited on both devices merge line by line against a kept base (diffy three-way merge), only same-line edits leave a conflicted copy, now named phone/desktop and never overwriting an earlier one; conflict log names devices and puts open copies first as "to review" (shared ConflictList); the phone syncs a few seconds after an edit (scheduler's after-edit trigger on mobile, debounce default 15 s, set in phone Settings)

## 0.93.2 - 2026-10-14

Phone Day screen: header on a three-column grid with the date as a plain label over a hidden date picker and Today only away from today; task rows tighter, with PRIORITY/OVERDUE/rate badges small and on the title's own line

## 0.93.1 - 2026-10-14

Sync: a config file still holding its seeded sample gives way to the other device's version instead of becoming a conflicted copy

## 0.93.0 - 2026-10-14

Sync-safe row ids and background sync on Android: tasks/lists/groups get ids two devices cannot both mint (ids.rs - generated tasks derived from (rule_key, period_key) and stamped untouched, lists/groups from their name, the rest random), carry-over collapses (rule, period) twins keeping the acted-on copy, restore folds same-name lists/groups, an engine pass follows a merging sync; Android keeps a pass alive through a dataSync foreground service

## 0.92.0 - 2026-10-14

Remove Dropbox sync: sync_dropbox, sync_dropbox_oauth and dropbox_link gone (PKCE + OauthTransport kept in oauth.rs), dropbox_* commands and bindings, DropboxLink; sync_now is Google only and returns SyncSummary; the phone's passphrase lock reduced to removing a leftover one; DECISIONS/ARCHITECTURE/DOGFOOD on Google Drive

## 0.91.0 - 2026-10-14

Android Google sign-in: tauri-plugin-google-auth (Play services AuthorizationClient, Kotlin in a tracked plugin source set), token per pass with clear-on-401, google_pull_vault for first run, phone onboarding and Settings > Sync on Google, sync_now from the phone's triggers, Error::SignInExpired

## 0.90.0 - 2026-10-14

Desktop Google sign-in (PKCE loopback, tokens via secret_store) and Drive sync: sync_now, per-account sync space, scheduler (start, interval, after edits, on focus, on quit), Settings > Sync tab with conflict log and double-sync warning; build.ps1 picks up the client secret

## 0.89.0 - 2026-10-14

Google Drive sync provider (appDataFolder, headRevisionId markers, post-write revision check, duplicate-name handling); sync cycle merges duplicates and treats unlisted manifest paths as remote deletions

## 0.88.1 - 2026-10-13

Sync spaces (per remote/account manifest + merge base), mass-deletion guard (sync_mass_delete_guard_percent, RemoteWiped, Upload this vault again), provider-generic run_pass - groundwork for Google Drive sync

## 0.88.0 - 2026-10-13

Defaults follow the Mine2 profile; per-section fold defaults for Postponed / Done, waiting / Done / Dropped; bold category header option; a picked weekday-marker color is no longer faded by its opacity

## 0.87.1 - 2026-10-13

Not done, dropped tasks get their own closed section after Done (slate plate, dropped_plate_color) instead of sharing Done

## 0.87.0 - 2026-10-13

Quieter columns: sections as framed panels with a cadence rail, category named once per block, closed sections fold, closed rows fade, Rate only when alerting; dropped mark color (red); done display separate by default

## 0.86.0 - 2026-10-13

Defaults: section plate height 100%, category chips alternate teal #0d9488 / orange #ea580c

## 0.85.0 - 2026-10-13

Phone mirrors the desktop columns: shared day/list section layout (plates, gap stripes, Priority, closed sections), TaskRow follows TaskCard (chips, badges, status cycle, subtasks, Drop)

## 0.84.0 - 2026-10-13

Closed section plates get their own colors in Card colors (Postponed rose, Done waiting teal, Done green); per-section cadence-stripe toggles and the plate micro-group removed

## 0.83.0 - 2026-10-13

List view is the only view: rows everywhere incl. Dashboard, fixed stripe gaps; card view, per-gap px and list-view/fill toggles removed; stripe look defaults 60/50/15/100/20

## 0.82.1 - 2026-10-13

Gap stripes: empty space spread evenly, so row-to-band and band-to-band distances match

## 0.82.0 - 2026-10-13

List view gaps become fixed glow stripes: 1 per category, 2 per section, 3 before closed sections (list_gap_stripe)

## 0.81.0 - 2026-10-13

Gap fill: max thickness keeps tall gaps to a thin centered band, opacity setting

## 0.80.0 - 2026-10-13

List view gaps: a soft-edged color band replaces the hatch (gap_fill_* settings)

## 0.79.1 - 2026-10-13

Gap hatch goes single-direction diagonal; Markdown editor keeps only the VS Code palette

## 0.79.0 - 2026-10-13

Shared List view look: hatch color/spacing/inset, plate text scales with plate height; per-section cadence stripes; VS Code is the only theme palette

## 0.78.1 - 2026-10-12

List view: the column wears the card fill, rows go transparent again

## 0.78.0 - 2026-10-12

List view on the Lists page, cross-hatched block and section gaps, taller plates, rows keep the card fill

## 0.77.0 - 2026-10-12

Days List view moves to Settings, hatched category gaps, A-Z Postponed/Done, varied chips skip cadence hues

## 0.76.1 - 2026-10-12

Days List view frames each block: first row gets the top hairline too

## 0.76.0 - 2026-10-12

Days page List view: tasks as hairline-split rows instead of cards

## 0.75.0 - 2026-09-18

Fine-tuning hides behind a checkbox that ticks itself

## 0.74.1 - 2026-09-18

Profile scope folded by tab, no duplicate today-only switches

## 0.74.0 - 2026-09-18

Settings regrouped by what they configure, with a search box

## 0.73.15 - 2026-09-18

Lazy editor chunk, in-app dialogs on the phone, KB watcher ignores .hypomnema, dependabot

## 0.73.14 - 2026-09-18

Tests for the store's optimistic paths, the read-only projections and the reminders overview

## 0.73.13 - 2026-09-18

Desktop and phone share the Review data, search and task-draft logic through hooks

## 0.73.12 - 2026-09-18

Commands reject with {kind, message}; no rejection is swallowed without a trace

## 0.73.11 - 2026-09-18

Typed invoke: every IPC call is checked against a Commands map

## 0.73.10 - 2026-09-18

Review and Calendar refetch once per change, not twice

## 0.73.9 - 2026-09-18

lib.rs splits into command modules, state and watchers; mutexes recover from poisoning

## 0.73.8 - 2026-09-18

Mirror and state exports move off the command path onto a debounced worker

## 0.73.7 - 2026-09-18

Deep bug sweep: 38 fixes across engine, sync, mirror and both frontends

## 0.73.6 - 2026-09-18

Six bug fixes: schedule-block times, the review's extra day, dropped tasks on the phone

## 0.73.5 - 2026-09-18

The dashboard's day count moves from Settings to a Days dropdown in its own header

## 0.73.4 - 2026-09-16

Icon gets a pure-white bold meander and a bright rim so it holds up on a dark taskbar

## 0.73.3 - 2026-09-16

A second launch brings the running window back instead of starting another copy

## 0.73.2 - 2026-09-16

About shows the logo with its HYPOMNEMA / The Meander Habit label; root app-icon.png matches the new mark

## 0.73.1 - 2026-09-16

One app icon on desktop and Android: the meander H on a slate tile

## 0.73.0 - 2026-09-16

Recurring tasks wear a completion Rate chip that turns loud below a threshold

## 0.72.3 - 2026-09-16

Enter in the task dialog's title saves and closes it

## 0.72.2 - 2026-09-12

Done, waiting mark defaults to a muted blue

## 0.72.1 - 2026-09-12

Waiting section reads DONE, WAITING, and its mark takes a calm teal of its own

## 0.72.0 - 2026-09-12

Notes carry Created and Last edited lines, and tasks gain Waiting and Dropped statuses

## 0.71.1 - 2026-09-09

All-lists index lines its names up on one axis

## 0.71.0 - 2026-09-09

Groups switch moves into the Lists header, and the All-lists index keeps the groups under flat

## 0.70.0 - 2026-09-09

Groups fill from inside, flat list panels, hideable sections, and safe-area fixes

## 0.69.0 - 2026-09-09

Phone settings become a panel index, Dropbox linking and unlink from Settings, switch and blur-commit controls, SVG tab icons, inline note forms

## 0.68.4 - 2026-09-09

Day gets a persistent add-task row, Notes banner adopts the vault, done-display in phone settings, back-button re-arm fix

## 0.68.3 - 2026-09-09

Group view: highlight the clicked list, rail index inside the group, new lists join it, mouse back leaves it

## 0.68.2 - 2026-09-09

Groups open as a full panel view; the phone's back button steps back; auto lists off the phone index

## 0.68.0 - 2026-09-09

Checklist lists that keep their checked items, and list groups on the panel

## 0.66.0 - 2026-09-09

Bring the phone up to desktop parity: search, undo, day context, review, config editing

## 0.65.0 - 2026-09-09

Give the phone's tasks the signals the desktop's have

## 0.64.5 - 2026-09-09

Notes find the vault on their own; the welcome screen keeps its margins

## 0.64.4 - 2026-09-08

Ask Android for file access, and give the chooser the whole screen

## 0.64.3 - 2026-09-08

Browse to a folder instead of filling in a form

## 0.64.2 - 2026-09-08

Keep the phone layout out from under the system bars

## 0.64.1 - 2026-09-08

Say at the top of the roadmap where it actually stands

## 0.64.0 - 2026-09-08

The rest of the desktop, in a shape a phone can hold

## 0.63.0 - 2026-09-08

Encrypt the one secret worth encrypting, and sign real releases

## 0.62.1 - 2026-09-08

Say what the phone is holding while it has no signal

## 0.62.0 - 2026-09-08

Edit a task in full on the phone, and sync without asking

## 0.61.0 - 2026-09-08

Merge two devices' edits instead of reporting them

## 0.60.0 - 2026-09-08

A phone can keep its own vault, with no Dropbox

## 0.59.0 - 2026-09-08

Push local changes back to Dropbox

## 0.58.0 - 2026-09-08

Phone UI: day, lists, journal, notes, settings

## 0.57.1 - 2026-09-08

Retry transient network failures in the Dropbox transport

## 0.57.0 - 2026-09-08

The phone opens the pulled vault and runs the app against it

## 0.56.2 - 2026-09-08

Escape non-ASCII in the Dropbox-API-Arg header

## 0.56.1 - 2026-09-08

Keep the PKCE verifier across an app restart; app-folder marker

## 0.56.0 - 2026-09-08

Dropbox sync core and the Android vault-linking screen
