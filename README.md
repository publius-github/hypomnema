<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="Hypomnema">
</p>

<h1 align="center">
  Hypomnema<br>
  <sup><sub>YOUR MIND. ORGANIZED.</sub></sup>
</h1>

<p align="center">A weekly task planner, a daily journal and a Markdown knowledge base in one local-first window.</p>

<p align="center">
  <a href="https://github.com/publius-github/hypomnema/releases/latest"><img src="https://img.shields.io/github/v/release/publius-github/hypomnema" alt="latest release"></a>
  <a href="https://github.com/publius-github/hypomnema/actions/workflows/ci.yml"><img src="https://github.com/publius-github/hypomnema/actions/workflows/ci.yml/badge.svg?branch=main" alt="ci"></a>
  <a href="https://publius-github.github.io/hypomnema/privacy.html"><img src="https://img.shields.io/badge/privacy-policy-blue" alt="privacy policy"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue" alt="license: GPL-3.0"></a>
</p>

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="The Dashboard: a week of days over the backlog lists">
  <br>
  <em>The Dashboard: a week of days on top, your backlog lists below.</em>
</p>

Hypomnema keeps a week of tasks, a journal and your notes together, and keeps all of it in a folder you choose: plain Markdown and YAML files plus a local database. There is no account, no server and no telemetry. Repeating tasks come from rules you write in YAML (cron for the schedule, a list name in braces), and the engine that generates them never duplicates a task or overwrites an edit. Syncing between your devices is optional and goes through a hidden app folder in your own Google Drive.

*Hypomnema* (Greek ὑπόμνημα) was the notebook the ancient Greeks kept at hand: notes, reminders and reflections collected for one's own use. Windows 10/11 is the shipped platform.

Hypomnema is free and has no ads, accounts or paid tiers. If it is useful to you, you can [support its development](https://ko-fi.com/hypomnema).

## Install

Download `Hypomnema_<version>_x64-setup.exe` from the [latest release](https://github.com/publius-github/hypomnema/releases/latest) and run it. It installs for the current user, without administrator rights; on a Windows 10 without WebView2 it downloads that first, so it needs a connection. The installer is not code-signed yet, so Windows SmartScreen may show "Windows protected your PC": choose *More info* > *Run anyway*. The app then updates itself; every update is verified against the project's signing key before it is installed.

To check that a download came out of this repository's release workflow, see [Code signing policy](#code-signing-policy).

On first start the app asks for a vault folder: pick an empty folder for a fresh start, or an existing folder of Markdown notes to work with them in place. A new vault starts with a few lists, tasks and rules of each kind, all meant to be edited or deleted. *Try it with an example* fills an empty folder with those plus a welcome note and a journal entry to look around in first.

Uninstalling (Windows *Apps & features*) removes the program; your vault folder is never touched. The uninstaller's optional "Delete the application data" box clears only the per-device files under `%APPDATA%\com.hypomnema.app` (the remembered vault path, the Google sign-in, the diagnostic log).

macOS and Linux are not released and not tested. The core is cross-platform Tauri, so `npm run app:dev` should run, but the tray, quick-capture window and installer flow are Windows-only for now.

## What it does

A vertical rail on the left holds the sections; their order is configurable and Settings always sits at the bottom. The rail also holds global search (Ctrl/Cmd+K), Sync (runs the task engine and, when a Google account is signed in, a Drive sync pass) and About. On Windows there is also a tray icon and a global shortcut for a quick-capture window.

**Dashboard** is a grid of days on top (column count configurable, paged scrolling) and your own backlog lists below. Drag and drop between days and lists, subtasks, colors, times, priority, Markdown in descriptions, statuses To Do / Done / Postponed / Waiting / Dropped. The header shows the week's focus phrase and day-type reminders. **Lists** and **Days** are focused variants of the same view.

<p align="center">
  <img src="docs/screenshots/days.png" width="49%" alt="Days: a week of day columns">
  <img src="docs/screenshots/lists.png" width="49%" alt="Lists: the backlog lists as columns">
  <br>
  <em>Days and Lists: the two halves of the Dashboard, each full size.</em>
</p>

**Upcoming** has three tabs: Scheduled (one-off dated events), Birthdays (with age when the year is known) and Recurring (cron rules). The forms write straight into the YAML files, keeping your comments. **Calendar** is a month grid with real tasks plus projections of future rule occurrences (the horizon is configurable per cadence). **Review** and **History** show how the week went, and a month-by-month archive with completion stats and streaks for daily rules.

<p align="center">
  <img src="docs/screenshots/recurring.png" alt="Upcoming: recurring rules">
  <br>
  <em>Upcoming: the rules behind the generated tasks, edited in place.</em>
</p>

**Journal** keeps one Markdown entry per date (`journal/<year>/<YYYY-MM-DD>.md`), created from a configurable template on first save, with "on this day" entries from earlier years.

**Notes** is the knowledge base: a tree of Markdown files (the vault root or a folder set in Settings), an editor with live highlighting, `[[wiki links]]` and backlinks, full-text search, a `.trash` folder (emptied after 30 days) and a `.hypomnemaignore` file to hide paths from the tree. The config files are edited here too, validated on save.

<p align="center">
  <img src="docs/screenshots/notes.png" alt="Notes: the Markdown editor with backlinks">
  <br>
  <em>Notes: Markdown files in place, wiki links and backlinks.</em>
</p>

**Settings** has six tabs (General, Tasks, Recurring & calendar, Capture & alerts, Data, Sync) with a search over every setting. They are stored in `.hypomnema/settings/app.yml` (per device), except the task rules every device must share, which go to the synced `.hypomnema/config/shared.yml`. The color scheme (`config/colors.yml`) and fine-tuning without a Settings control are edited in Notes > Config, validated on save.

## Documentation

- [Using Hypomnema](docs/general/USAGE.md) - keyboard shortcuts, sync, troubleshooting.
- [Vault, configuration and engine rules](docs/general/CONFIG.md) - the vault layout, every config file, how recurring tasks are generated.
- [Architecture](docs/general/ARCHITECTURE.md) and [Windows specifics](docs/windows/ARCHITECTURE.md) - the technical map.
- [Changelog](CHANGELOG.md), [Contributing](CONTRIBUTING.md) (setup, build, release), [Security](SECURITY.md).

## Status

Pre-1.0: development builds, released often (see the [changelog](CHANGELOG.md)). Windows 10/11 is the shipped platform. One maintainer; issues and pull requests are reviewed as time allows, with no roadmap or support commitment beyond [SECURITY.md](SECURITY.md).

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

## License

Copyright (C) 2026 Siarhei Zverau

Hypomnema is free software under the GNU General Public License, version 3 only, with an additional permission under section 7 for linking with Google Play services ([LICENSE-EXCEPTION.md](LICENSE-EXCEPTION.md)). See [LICENSE](LICENSE) for the full text and [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) for the libraries it is built on. The name and logo are not covered by the GPL, and a few third-party marks are used under their own terms: see [TRADEMARKS.md](TRADEMARKS.md).
