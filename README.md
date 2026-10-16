# Hypomnema

A local-first personal productivity app: a weekly task planner, a daily journal and a Markdown knowledge base in one window. Windows first, with an Android companion. Everything lives in a folder you choose, as plain files and a local database - no account, no server, no telemetry. Sync between your devices is optional and goes through your own Google Drive.

*Hypomnema* (Greek ὑπόμνημα) was the notebook the ancient Greeks kept at hand: notes, reminders and reflections collected for one's own use.

- [Install](#install) · [What it does](#sections) · [Your data](#data-the-vault) · [Configuration](#yaml-configuration) · [Troubleshooting](#troubleshooting) · [Building](#building-and-releasing) · [Contributing](CONTRIBUTING.md) · [Code signing policy](#code-signing-policy) · [Privacy](site/privacy.html) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [License](#license)

Technical map of the shared core (modules, config schemas, engine invariants): `docs/general/ARCHITECTURE.md`. Windows specifics (tray, quick-capture window, build and release): `docs/windows/ARCHITECTURE.md`. Android build: `docs/android/ARCHITECTURE.md`.

<!-- TODO(owner): add a screenshot, e.g. docs/screenshot.png, and uncomment:
![Hypomnema - the dashboard](docs/screenshot.png)
-->

## Install

- **Windows 10/11** - download `Hypomnema_<version>_x64-setup.exe` from the [latest release](https://github.com/publius-github/app-hypomnema/releases/latest) and run it. The installer is not code-signed yet, so Windows SmartScreen may show "Windows protected your PC": choose *More info* > *Run anyway*. The app then updates itself; every update is verified against the project's signing key before it is installed.
- **Android** - no published build yet; see [`docs/android/ARCHITECTURE.md`](docs/android/ARCHITECTURE.md) to build the APK yourself.
- **macOS / Linux** - not released and not tested. The core is cross-platform Tauri, so `npm run tauri dev` should run, but the tray, quick-capture window and installer flow are Windows-only for now.

On first start the app asks for a vault folder - pick an empty folder for a fresh start, or an existing folder of Markdown notes to work with them in place.

Uninstalling (Windows *Apps & features*) removes the program; your vault folder is never touched. The uninstaller's optional "Delete the application data" box clears only the per-device files under `%APPDATA%\com.hypomnema.app` (the remembered vault path, the Google sign-in, the diagnostic log).

## Sections

A vertical rail on the left; the section order is configurable and Settings always sits at the bottom. The rail also holds global search (Ctrl/Cmd+K), Sync (runs the task engine and, when a Google account is signed in, a Drive sync pass) and About.

- **Dashboard** - a grid of days on top (column count configurable, paged scrolling) and your own backlog lists below. Drag and drop between days and lists, subtasks, colors, times, priority, Markdown in descriptions, statuses To Do / Done / Postponed / Waiting / Dropped. The header shows the week's focus phrase and day-type reminders. **Lists** and **Days** are focused variants of the same view.
- **Upcoming** - three tabs: Scheduled (one-off dated events), Birthdays (with age when the year is known) and Recurring (cron rules). The forms write straight into the YAML files, keeping your comments.
- **Calendar** - a month grid with real tasks plus projections of future rule occurrences (the horizon is configurable per cadence).
- **Review** and **History** - how the week went, and a month-by-month archive with completion stats and streaks for daily rules.
- **Journal** - one Markdown entry per date (`journal/<year>/<YYYY-MM-DD>.md`), created from a configurable template on first save, with "on this day" entries from earlier years.
- **Notes** - a knowledge base: a tree of Markdown files (the vault root or a folder set in Settings), an editor with live highlighting, `[[wiki links]]` and backlinks, full-text search, a `.trash` folder (emptied after 30 days) and a `.hypomnemaignore` file to hide paths from the tree. The config files are edited here too, validated on save.
- **Settings** - profiles, appearance, pages, task cards, columns, recurring & calendar, capture & alerts, data and sync, with a search over every setting; everything is stored in `.hypomnema/settings/app.yml`.

On Windows there is also a tray icon and a global shortcut for a quick-capture window.

## Data: the vault

The app keeps its working files in a hidden `.hypomnema` folder inside the vault (like `.git` in a repository); your own content sits at the top level:

```
<vault>/
  journal/                # journal entries
  <notes>                 # knowledge base (unless another folder is set)
  .hypomnemaignore        # hides paths from the notes tree
  .trash/                 # deleted notes
  .hypomnema/
    app.db                # SQLite: tasks, lists, state
    settings/app.yml      # app settings
    config/               # your YAML config files (see below)
    tasks/                # Markdown mirror of manual tasks (editable both ways)
    backups/              # daily database snapshot + copies of configs before overwrite
```

The `tasks/` mirror (enabled in Settings) holds one file per list plus `scheduled.md`: edit tasks in bulk in any text editor and the changes are imported back.

### Sync

Signing in with Google syncs the vault between your devices through a hidden app-data folder in your own Drive (scope `drive.appdata` - the app cannot see any other file there). Notes and other text files edited on two devices are merged line by line; a real clash leaves a `(conflicted copy ...)` file next to the original, which Settings lets you compare and resolve. See the [privacy policy](site/privacy.html) for exactly what goes where.

## YAML configuration

One file per rule type in `.hypomnema/config/`; subfolders work as "packs" - any `*.yml` in them is merged into recurring/scheduled/birthdays by its top-level key. Edits are picked up live by a file watcher; a broken file never touches your data - the last valid state stays in effect and a banner shows the error with its file and line.

```yaml
# recurring.yml - repeating tasks
tasks:
  - schedule: "0 0 1 * *"        # cron
    description: "Monthly"
    items:
      - "{05 Finance} pay bills for apartment"   # {List} task text

# scheduled.yml - one-off dated events
events:
  - date: 2026-09-14
    title: "{02 Personal} dentist appointment"
    time: "10:30"                # optional

# birthdays.yml - birthdays
birthdays:
  - name: "John Smith"
    date: "03-14"                # MM-DD
    year: 1985                   # optional, to show the age
```

Plus `weekly-focus.yml` (the week's focus phrase, rotated by ISO week), `day-reminders.yml` (reminders by day type: workday / weekend / weekday), `day-schedule.yml` (blocks of the daily schedule) and `templates/journal.md` (the journal template, supports `{{date}}`).

## Troubleshooting

- **Something failed or looks wrong** - About > *Copy diagnostics* puts the app version, the platform and the end of the diagnostic log on the clipboard; read it, remove anything private, and paste it into a [bug report](https://github.com/publius-github/app-hypomnema/issues/new?template=bug_report.yml) (About > *Report a problem* opens the form). The app never sends the log anywhere by itself.
- **Where the log is** - `%APPDATA%\com.hypomnema.app\hypomnema.log` on Windows (About > *Show log file*); it rotates to `hypomnema.log.1` at `log_max_kb` (app.yml, 1 MiB by default).
- **Tasks or lists went missing** - Settings > Data > Backups restores a daily database snapshot; the database being replaced is copied aside first, so a restore can itself be undone. Before an app update changes the database format, a `before upgrade` snapshot is taken as well.
- **A config edit broke something** - the same list restores the copies of config files the app took before rewriting them.
- **A `(conflicted copy ...)` file appeared** - two devices changed the same lines before syncing; Settings > Sync shows both versions side by side and keeps the one you pick.
- **The window went blank or shows "Something went wrong"** - press Reload; your data lives in the app core and the vault, not in the window.

## Engine rules

- Generation runs at startup, on Sync, when the day changes and when configs change. Duplicates are impossible: the `rule_runs` ledger remembers every generated (rule, period) pair, so restarts and config edits never repeat a task.
- Your edits and statuses are never overwritten: regeneration only creates what is missing, and a deleted instance does not come back.
- Overdue open tasks move to today marked overdue (at most one open copy per rule); daily tasks never count as overdue.
- Missed occurrences within the catch-up window collapse into one (a week away gives one task, not seven).
- Removing a rule removes its future and today's open instances; completed ones stay in history. Completed tasks are cleaned up by the retention setting.

## Building and releasing

Development works on Windows, macOS or Linux; the release installer (NSIS `.exe`) is built by GitHub Actions on a Windows runner.

Requirements: Node.js 22+, Rust stable (rustup). On Windows also VS Build Tools (Desktop C++), WebView2 and Git Bash; on Linux `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`.

```bash
npm ci && npm run tauri dev             # dev mode with hot reload
./scripts/windows/build.sh              # local installer build (build.ps1 for PowerShell)
./scripts/android/build-android.sh      # Android build, see docs/android/
```

Artifacts land in `src-tauri/target/release/bundle/`.

Google sign-in on the desktop needs an OAuth client secret compiled in from the `HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_SECRET` environment variable (see `docs/windows/ARCHITECTURE.md`); a build without it simply has no Google sync. If you build your own copy, register your own "Desktop app" OAuth client in Google Cloud (scope `drive.appdata`) and set `HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_ID` alongside the secret at build time; no source edit is needed.

### Version and release

The `VERSION` file at the root is the single source of truth for the version; never edit it or the manifests' versions by hand:

```bash
./scripts/general/bump.sh [major|minor|patch]      # bump + sync manifests, no commit
./scripts/windows/release.sh [major|minor|patch]   # bump + commit + tag v<version> + push (release.ps1 for PowerShell)
```

The `release.yml` workflow, on a `v*` tag, checks the tag against `VERSION`, builds the Windows installer with `tauri-action` and attaches it to a draft GitHub Release. CI (`ci.yml`) runs lint/typecheck/test/build for the frontend and fmt/clippy/test for the Rust core on pull requests and pushes to `main` and `development`; `release.yml` runs the same gates on the tagged commit before it builds anything.

### Third-party licenses

`THIRD_PARTY_LICENSES.txt` collects the license texts of every bundled Rust crate and npm package; the app compiles it in and shows it under About. Regenerate it after changing dependencies:

```bash
node scripts/general/third-party-licenses.mjs
```

### Auto-updates

At startup the desktop app checks `releases/latest/download/latest.json` of the release repository and offers to update. The manifest is signed: GitHub Secrets need `TAURI_SIGNING_PRIVATE_KEY` (the contents of `~/.tauri/hypomnema.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the public key is in `src-tauri/tauri.conf.json`. Without the secrets the release workflow fails at signing. A local `scripts/windows/build.sh` signs the updater artifacts only when the key is at `~/.tauri/hypomnema.key`. Updates reach users only once the draft release is published - `latest.json` is served from published releases only.

## Code signing policy

<!-- TODO(owner): once SignPath Foundation approves the project, uncomment:
Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).
-->

Windows installers are built only by the `release.yml` GitHub Actions workflow from a tagged commit of this repository; nothing built on a personal machine is published. Every release is approved by hand before it is signed and published.

Team roles:

- Committers and reviewers: [@publius-github](https://github.com/publius-github)
- Approvers: [@publius-github](https://github.com/publius-github)

Privacy: this program does not transfer any information to other networked systems unless the user asks it to - Google Drive sync runs only after the user signs in. The one exception is the update check at startup, which downloads a version file from GitHub, sends no personal data or app content, and can be turned off in Settings > General > Updates. Details in the [privacy policy](site/privacy.html).

## Website

`site/` is the static project website (home page and privacy policy) - plain HTML and CSS, host it anywhere. Google's OAuth verification needs both pages on a domain you own.

## License

Copyright (C) 2026 &lt;COPYRIGHT HOLDER&gt;

Hypomnema is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License, version 3, as published by the Free Software Foundation. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text, and [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) for the licenses of the libraries it is built on.
