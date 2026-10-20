<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="Hypomnema">
</p>

<h1 align="center">Hypomnema</h1>

<p align="center">A weekly task planner, a daily journal and a Markdown knowledge base in one local-first window.</p>

<p align="center">
  <a href="https://github.com/publius-github/hypomnema/releases/latest"><img src="https://img.shields.io/github/v/release/publius-github/hypomnema" alt="latest release"></a>
  <a href="https://github.com/publius-github/hypomnema/actions/workflows/ci.yml"><img src="https://github.com/publius-github/hypomnema/actions/workflows/ci.yml/badge.svg?branch=main" alt="ci"></a>
  <a href="https://publius-github.github.io/hypomnema/privacy.html"><img src="https://img.shields.io/badge/privacy-policy-blue" alt="privacy policy"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue" alt="license: GPL-3.0"></a>
</p>

<!-- TODO(owner): docs/screenshots/dashboard.png - the Dashboard of the "Try it with an example" vault, light theme, no personal data. Then uncomment:
<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="The Dashboard: a week of days over the backlog lists">
  <br>
  <em>The Dashboard: a week of days on top, your backlog lists below.</em>
</p>
-->

Hypomnema keeps a week of tasks, a journal and your notes together, and keeps all of it in a folder you choose: plain Markdown and YAML files plus a local database. There is no account, no server and no telemetry. Repeating tasks come from rules you write in YAML (cron for the schedule, a list name in braces), and the engine that generates them never duplicates a task or overwrites an edit. Syncing between your devices is optional and goes through a hidden app folder in your own Google Drive.

*Hypomnema* (Greek ὑπόμνημα) was the notebook the ancient Greeks kept at hand: notes, reminders and reflections collected for one's own use. Windows 10/11 is the shipped platform.

<!-- TODO(owner): once a donation page exists, set DONATE_URL in src/lib/legal.ts and .github/FUNDING.yml, and uncomment:
Hypomnema is free and has no ads, accounts or paid tiers. If it is useful to you, you can [support its development](https://example.com/donate).
-->

## Contents

- [Install](#install)
- [Status](#status)
- [What it does](#what-it-does)
- [Keyboard](#keyboard)
- [Your data: the vault](#your-data-the-vault)
- [Sync](#sync)
- [Configuration](#configuration)
- [Engine rules](#engine-rules)
- [Troubleshooting](#troubleshooting)
- [Build from source](#build-from-source)
- [Version and release](#version-and-release)
- [Code signing policy](#code-signing-policy)
- [Privacy](#privacy)
- [Website](#website)
- [Contributing](#contributing)
- [License](#license)

Technical map of the shared core (modules, config schemas, engine invariants): [`docs/general/ARCHITECTURE.md`](docs/general/ARCHITECTURE.md). Windows specifics (tray, quick-capture window, build and release): [`docs/windows/ARCHITECTURE.md`](docs/windows/ARCHITECTURE.md). Every version is in the [changelog](CHANGELOG.md); vulnerabilities go through [SECURITY.md](SECURITY.md).

## Install

Download `Hypomnema_<version>_x64-setup.exe` from the [latest release](https://github.com/publius-github/hypomnema/releases/latest) and run it. It installs for the current user, without administrator rights; on a Windows 10 without WebView2 it downloads that first, so it needs a connection. The installer is not code-signed yet, so Windows SmartScreen may show "Windows protected your PC": choose *More info* > *Run anyway*. The app then updates itself; every update is verified against the project's signing key before it is installed.

To check that a download really came out of this repository's release workflow, use the [GitHub CLI](https://cli.github.com):

```bash
gh attestation verify Hypomnema_<version>_x64-setup.exe --repo publius-github/hypomnema
```

On first start the app asks for a vault folder: pick an empty folder for a fresh start, or an existing folder of Markdown notes to work with them in place. A new vault starts with a few lists, tasks and rules of each kind, all meant to be edited or deleted. *Try it with an example* fills an empty folder with those plus a welcome note and a journal entry to look around in first.

<!-- TODO(owner): docs/screenshots/first-start.png - the vault chooser on first start. Then uncomment:
<p align="center">
  <img src="docs/screenshots/first-start.png" width="600" alt="First start: choosing a vault folder">
  <br>
  <em>First start: an empty folder, an existing folder of notes, or the example vault.</em>
</p>
-->

Uninstalling (Windows *Apps & features*) removes the program; your vault folder is never touched. The uninstaller's optional "Delete the application data" box clears only the per-device files under `%APPDATA%\com.hypomnema.app` (the remembered vault path, the Google sign-in, the diagnostic log).

macOS and Linux are not released and not tested. The core is cross-platform Tauri, so `npm run app:dev` should run, but the tray, quick-capture window and installer flow are Windows-only for now.

## Status

- Pre-1.0: versions below 1.0 are development builds, released often; see the [changelog](CHANGELOG.md). Before an update changes the database format the app snapshots it, and a device whose app is older than the one that last synced stops syncing instead of merging data it cannot read.
- Windows 10/11 is the shipped platform; macOS and Linux are not released.
- The Windows installer is not code-signed yet (see [Code signing policy](#code-signing-policy)).
- One maintainer; issues and pull requests are reviewed as time allows ([CONTRIBUTING.md](CONTRIBUTING.md)). There is no roadmap or support commitment beyond [SECURITY.md](SECURITY.md).

## What it does

A vertical rail on the left holds the sections; their order is configurable and Settings always sits at the bottom. The rail also holds global search (Ctrl/Cmd+K), Sync (runs the task engine and, when a Google account is signed in, a Drive sync pass) and About. On Windows there is also a tray icon and a global shortcut for a quick-capture window.

**Dashboard** is a grid of days on top (column count configurable, paged scrolling) and your own backlog lists below. Drag and drop between days and lists, subtasks, colors, times, priority, Markdown in descriptions, statuses To Do / Done / Postponed / Waiting / Dropped. The header shows the week's focus phrase and day-type reminders. **Lists** and **Days** are focused variants of the same view.

**Upcoming** has three tabs: Scheduled (one-off dated events), Birthdays (with age when the year is known) and Recurring (cron rules). The forms write straight into the YAML files, keeping your comments. **Calendar** is a month grid with real tasks plus projections of future rule occurrences (the horizon is configurable per cadence). **Review** and **History** show how the week went, and a month-by-month archive with completion stats and streaks for daily rules.

<!-- TODO(owner): docs/screenshots/upcoming.png - Upcoming > Recurring with a few rules. Then uncomment:
<p align="center">
  <img src="docs/screenshots/upcoming.png" alt="Upcoming: recurring rules">
  <br>
  <em>Upcoming: the rules behind the generated tasks, edited in place.</em>
</p>
-->

**Journal** keeps one Markdown entry per date (`journal/<year>/<YYYY-MM-DD>.md`), created from a configurable template on first save, with "on this day" entries from earlier years.

**Notes** is the knowledge base: a tree of Markdown files (the vault root or a folder set in Settings), an editor with live highlighting, `[[wiki links]]` and backlinks, full-text search, a `.trash` folder (emptied after 30 days) and a `.hypomnemaignore` file to hide paths from the tree. The config files are edited here too, validated on save.

<!-- TODO(owner): docs/screenshots/notes.png - Notes with a note open, backlinks visible. Then uncomment:
<p align="center">
  <img src="docs/screenshots/notes.png" alt="Notes: the Markdown editor with backlinks">
  <br>
  <em>Notes: Markdown files in place, wiki links and backlinks.</em>
</p>
-->

**Settings** has six tabs (General, Tasks, Recurring & calendar, Capture & alerts, Data, Sync) with a search over every setting. They are stored in `.hypomnema/settings/app.yml` (per device), except the task rules every device must share, which go to the synced `.hypomnema/config/shared.yml`. The color scheme (`config/colors.yml`) and fine-tuning without a Settings control are edited in Notes > Config, validated on save.

<!-- TODO(owner): docs/screenshots/dark.png - the Dashboard in the dark theme. Then uncomment:
<p align="center">
  <img src="docs/screenshots/dark.png" alt="The Dashboard in the dark theme">
  <br>
  <em>The same Dashboard in the dark theme.</em>
</p>
-->

## Keyboard

Everything works without a mouse; About lists these shortcuts too.

| Keys | Action |
|---|---|
| Ctrl+Alt+Space (set in Settings) | Quick capture from anywhere in Windows |
| Ctrl+K | Search tasks, notes and the journal |
| Ctrl+1 … 9 | Open a section, in the left bar's order |
| Ctrl+= / Ctrl+− | Larger / smaller text (Base font size) |
| Ctrl+0 | Default text size |
| Esc | Close a dialog |
| Enter | On a task card: open the task |
| Space, arrows, Space | On a task card: pick it up, carry it to a day or list, drop it (Esc puts it back) |
| Alt+← / Alt+→ | Journal: previous / next day |
| Ctrl+F | Editor: find and replace |
| Alt+Z | Editor: word wrap |
| Ctrl+click | Editor: follow a `[[link]]` or a web address |
| Esc, then Tab | Editor: leave it with Tab (Tab indents otherwise; Ctrl+M switches this for good) |

## Your data: the vault

The app keeps its working files in a hidden `.hypomnema` folder inside the vault (like `.git` in a repository); your own content sits at the top level:

```
<vault>/
  journal/                # journal entries
  <notes>                 # knowledge base (unless another folder is set)
  .hypomnemaignore        # hides paths from the notes tree
  .hypomnemasyncignore    # paths sync leaves on this device (same syntax)
  .trash/                 # deleted notes, and files deleted on another device
  .hypomnema/
    app.db                # SQLite: tasks, lists, state (a cache, rebuilt from state/)
    state/                # text snapshot of the database, the copy that syncs
    settings/app.yml      # this device's app settings
    config/               # your YAML config files (see below), synced
    tasks/                # Markdown mirror of manual tasks (editable both ways)
    backups/              # daily database snapshot + copies of configs before overwrite
```

The `tasks/` mirror (enabled in Settings) holds one file per list plus `scheduled.md`: edit tasks in bulk in any text editor and the changes are imported back.

## Sync

Signing in with Google syncs the vault between your devices through a hidden app-data folder in your own Drive (scope `drive.appdata`: the app cannot see any other file there). Notes and other text files edited on two devices are merged line by line; a real clash leaves a `(conflicted copy ...)` file next to the original, which Settings lets you compare and resolve. Paths listed in `.hypomnemasyncignore` stay on this device. A note or journal entry deleted on the other device lands in this vault's `.trash/` folder (kept 30 days) rather than vanishing. Keep every device on the same version: a device whose app is older than the one that last synced stops syncing with "update the app on this device" instead of merging data it cannot fully read. See the [privacy policy](https://publius-github.github.io/hypomnema/privacy.html) for exactly what goes where.

## Configuration

One file per rule type in `.hypomnema/config/`; subfolders work as "packs": any `*.yml` in them is merged into recurring/scheduled/birthdays by its top-level key. Edits are picked up live by a file watcher; a broken file never touches your data, the last valid state stays in effect and a banner shows the error with its file and line.

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

| File | What it holds | Synced |
|---|---|---|
| `recurring.yml` | Repeating tasks: a cron schedule, a description, the task items | yes |
| `scheduled.yml` | One-off dated events, with an optional time | yes |
| `birthdays.yml` | Birthdays as MM-DD, with an optional year for the age | yes |
| `weekly-focus.yml` | The week's focus phrase, rotated by ISO week | yes |
| `day-reminders.yml` | Reminders by day type: workday, weekend, weekday | yes |
| `day-schedule.yml` | Blocks of the daily schedule | yes |
| `templates/journal.md` | The journal template, supports `{{date}}` | yes |
| `colors.yml` | The color scheme, edited in Notes > Config; absent means the defaults | yes |
| `shared.yml` | Retention, catch-up and the other task rules, written by their Settings controls | yes |
| `../settings/app.yml` | This device's app settings and fine-tuning without a Settings control | no |

## Engine rules

- Generation runs at startup, on Sync, when the day changes and when configs change. Duplicates are impossible: the `rule_runs` ledger remembers every generated (rule, period) pair, so restarts and config edits never repeat a task.
- Your edits and statuses are never overwritten: regeneration only creates what is missing. Deleting an instance a later firing has already replaced removes it for good; deleting the rule's current one (today's, or the latest still-due weekly or monthly firing) brings it back on the next run. To stop a rule, edit or remove it in its file.
- Overdue open tasks move to today marked overdue (at most one open copy per rule); daily tasks never count as overdue.
- Missed occurrences within the catch-up window collapse into one (a week away gives one task, not seven).
- Removing a rule removes all of its tasks, completed ones from past days included, so History, streaks and completion rates start over for it; only a task already done today stays. A rule is identified by its schedule, description and item text, so changing any of them counts as removing the old rule and adding a new one (the rule editor says so); the alert threshold can change freely. Completed tasks are otherwise cleaned up by the retention setting.

## Troubleshooting

- **Something failed or looks wrong.** About > *Copy diagnostics* puts the app version, the platform and the end of the diagnostic log on the clipboard; read it, remove anything private, and paste it into a [bug report](https://github.com/publius-github/hypomnema/issues/new?template=bug_report.yml) (About > *Report a problem* opens the form). The app never sends the log anywhere by itself.
- **Where the log is.** `%APPDATA%\com.hypomnema.app\hypomnema.log` on Windows (About > *Show log file*); it rotates to `hypomnema.log.1` at `log_max_kb` (app.yml, 1 MiB by default).
- **A task with no day and no list** goes to the quick-capture list (Inbox by default) rather than out of sight, for example when you clear the date of a task added under a day.
- **Tasks or lists went missing.** Settings > Data > Backups restores a daily database snapshot; the database being replaced is copied aside first, so a restore can itself be undone. Before an app update changes the database format, a `before upgrade` snapshot is taken as well.
- **The vault will not open because of the database.** `.hypomnema/app.db` is a cache of `.hypomnema/state/`: a database the app cannot read is moved aside as `app.db.unreadable-<time>` and rebuilt from that snapshot on its own. To force a rebuild, close the app and delete `app.db` (with its `-wal`/`-shm` files).
- **A config edit broke something.** The same list restores the copies of config files the app took before rewriting them.
- **A `(conflicted copy ...)` file appeared.** Two devices changed the same lines before syncing; Settings > Sync shows both versions side by side and keeps the one you pick.
- **The window went blank or shows "Something went wrong".** Press Reload; your data lives in the app core and the vault, not in the window.

## Build from source

Development is checked on Windows and Linux (CI builds and tests the Rust core on both; macOS is untested); the release installer (NSIS `.exe`) is built by GitHub Actions on a Windows runner.

Requirements: Node.js 22.22.2+ or 24.15+ (`engines` in `package.json`; CI runs the version in `.nvmrc`), Rust 1.98.0 via rustup (the version CI pins; a newer stable may bring clippy lints CI does not have yet). On Windows also VS Build Tools (Desktop C++), WebView2 and Git Bash; on Linux (Debian/Ubuntu names) `build-essential`, `pkg-config`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, the set CI installs.

```bash
npm ci && npm run app:dev               # dev mode with hot reload, a separate "Hypomnema Dev" app (CONTRIBUTING.md)
./scripts/windows/build.sh              # local installer build (build.ps1 for PowerShell)
```

Artifacts land in `src-tauri/target/release/bundle/`.

Google sign-in on the desktop needs an OAuth client secret compiled in from the `HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_SECRET` environment variable (see `docs/windows/ARCHITECTURE.md`); a build without it simply has no Google sync. If you build your own copy, register your own "Desktop app" OAuth client in Google Cloud (scope `drive.appdata`) and set `HYPOMNEMA_GOOGLE_DESKTOP_CLIENT_ID` alongside the secret at build time; no source edit is needed.

Cargo never deletes old build output, so `src-tauri/target` grows with every version bump. The build scripts prune output untouched for 7 days before each build (`PRUNE_DAYS` changes the limit); to prune by hand:

```bash
node scripts/general/prune-target.mjs [--days N] [--dry-run]
```

`THIRD_PARTY_LICENSES.txt` collects the license texts of every bundled Rust crate and npm package, plus the prebuilt binaries and libraries listed by hand in `scripts/general/notices/`; the app compiles it in and shows it under About. Regenerate it after changing dependencies:

```bash
node scripts/general/third-party-licenses.mjs
```

## Version and release

The `VERSION` file at the root is the single source of truth for the version; never edit it or the manifests' versions by hand:

```bash
./scripts/general/bump.sh [major|minor|patch]   # bump + sync manifests, no commit
./scripts/windows/release.sh [--check]          # tag v<VERSION> + push; --check only checks (release.ps1 [-Check] for PowerShell)
```

A release ships the version already in `VERSION`: bump with `bump.sh`, add its `## <version> - <date>` entry to `CHANGELOG.md`, commit, then run `release.sh`. It refuses a dirty tree, manifests out of step with `VERSION`, a missing CHANGELOG entry, a branch behind `origin` and an existing tag.

The `release.yml` workflow, on a `v*` tag, first checks the tag against `VERSION` and takes the CHANGELOG entry as the release notes, then builds the Windows installer with `tauri-action` and attaches it to a draft GitHub Release. CI (`ci.yml`) runs lint/typecheck/test/build for the frontend, fmt/clippy/test for the Rust core on Linux and clippy/test again on Windows (the shipped platform), plus an audit job: `cargo-deny` (advisories and licenses, policy in `src-tauri/deny.toml`), `npm audit` of the runtime dependencies and a `gitleaks` secret scan, on pull requests, pushes to `main` and `development` and once a week; it also fails when the committed TypeScript bindings or `THIRD_PARTY_LICENSES.txt` are stale. `release.yml` runs the same gates on the tagged commit before it builds anything. Third-party actions and the Rust toolchain are pinned to exact commits and versions; Dependabot proposes the updates (to `development`, a week after a version is published).

At startup the desktop app checks `releases/latest/download/latest.json` of the release repository and offers to update. The manifest is signed: GitHub Secrets need `TAURI_SIGNING_PRIVATE_KEY` (the contents of `~/.tauri/hypomnema.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the public key is in `src-tauri/tauri.conf.json`. Without the secrets the release workflow fails at signing. A local build (`scripts/windows/build.ps1` or `build.sh`) signs the updater artifacts only when `TAURI_SIGNING_PRIVATE_KEY` is set, or when the key is at `~/.tauri/hypomnema.key` *and* `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is set; otherwise it builds the installer without updater artifacts. Updates reach users only once the draft release is published: `latest.json` is served from published releases only.

## Code signing policy

<!-- TODO(owner): once SignPath Foundation approves the project, uncomment:
Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).
-->

Windows installers are built only by the `release.yml` GitHub Actions workflow from a tagged commit of this repository; nothing built on a personal machine is published. CI builds it, signs the update artifacts with the project's updater key (the installer itself is not code-signed yet), records a [build provenance attestation](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations) for the installer and attaches the files to a draft release; a draft reaches users only once it is reviewed and published by hand. `gh attestation verify <installer> --repo publius-github/hypomnema` checks a download against that attestation.

Team roles:

- Committers and reviewers: [@publius-github](https://github.com/publius-github)
- Approvers: [@publius-github](https://github.com/publius-github)

## Privacy

This program does not transfer any information to other networked systems unless the user asks it to: Google Drive sync runs only after the user signs in. The one exception is the update check at startup, which downloads a version file from GitHub, sends no personal data or app content, and can be turned off in Settings > General > Updates. Details in the [privacy policy](https://publius-github.github.io/hypomnema/privacy.html).

## Website

`site/` is the static project website (home page and privacy policy), plain HTML and CSS. `pages.yml` publishes it to GitHub Pages at <https://publius-github.github.io/hypomnema/> on every push to `main` that touches it (Settings > Pages > Source must be set to GitHub Actions once). It can be hosted anywhere else as well; Google's OAuth verification needs both pages on a domain you own.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, the checks every change must pass and how changes are reviewed.

## License

Copyright (C) 2026 Siarhei Zverau

Hypomnema is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License, version 3 only, as published by the Free Software Foundation, with an additional permission under section 7 for linking with Google Play services ([LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md)). It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text, and [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) for the licenses of the libraries it is built on.

Not everything in a build is open source. The Windows binary links Microsoft's WebView2 loader (BSD-3-Clause). The "Sign in with Google" button carries Google's "G" logo, a trademark of Google LLC used under its [sign-in branding guidelines](https://developers.google.com/identity/branding-guidelines), not under the GPL. `THIRD_PARTY_LICENSES.txt` lists both.

The name Hypomnema and its logo are not covered by the GPL: a modified version you distribute needs its own name and icon ([TRADEMARKS.md](TRADEMARKS.md)).

Google and Google Drive are trademarks of Google LLC; Windows and WebView2 are trademarks of Microsoft Corporation. Hypomnema is not affiliated with or endorsed by either.
