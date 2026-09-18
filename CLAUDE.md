# Hypomnema (repo: app-pkb)

Local-first personal productivity app for Windows: weekly task planner, journal, and Markdown knowledge base in one window. Tauri 2 (Rust core) + React + TypeScript frontend. All data lives in a user-chosen vault folder: user content at the top level (`journal/`, notes), and the app's working files under `.hypomnema/` - `app.db`, `settings/app.yml` (app settings), `config/` with per-feature user YAML files (`recurring.yml`, `scheduled.yml`, `birthdays.yml`, `weekly-focus.yml`, `day-reminders.yml`, `day-schedule.yml`, `templates/`), `tasks/` (bulk-editable Markdown mirror of manual tasks), and `backups/`. Path helpers live in `src-tauri/src/vault.rs`; never join layout paths by hand. The Rust core owns all business logic (task generation engine, dedup via `rule_runs`, overdue carry-over, YAML parsing, watchers); the React layer is presentation only. `docs/general/ARCHITECTURE.md` is the maintained map of the shared codebase (vault layout, UI sections, config schemas, engine invariants, module responsibilities); `docs/windows/ARCHITECTURE.md` covers desktop-only chrome and the Windows build/release flow; `docs/android/` covers the Android build. Read the relevant one before exploring the sources, and update whichever section describes what you're changing, in the same commit.

## Layout

- `src/` - React frontend (Zustand store, Tailwind tokens, CodeMirror editor).
- `src-tauri/src/` - Rust core: `engine.rs` (generation), `tasks.rs`, `db.rs` (migrations), `vault.rs`, `journal.rs`, `kb.rs`, `reminders.rs`; Tauri commands in `cmd_*.rs`, `AppState` in `state.rs`, vault open + watchers + export worker in `watchers.rs`, `lib.rs` is the builder only.
- `scripts/` is split by what a script targets: `scripts/general/` (platform-agnostic - `bump.sh`), `scripts/windows/` (`build.sh`/`build.ps1` - local installer build; `release.sh`/`release.ps1` - version bump + tag + push), `scripts/android/` (`build-android.sh`).

## Versioning

The `VERSION` file at the repo root is the single source of truth for the app version. Never edit it by hand and never edit versions in `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` directly - always go through a script that syncs all manifests:

- `scripts/general/bump.sh [major|minor|patch]` (default patch) bumps `VERSION` and syncs the manifests, nothing else. Use it while developing: bump with every user-visible feature batch (minor for features, patch for fixes/polish) and include the bump in the feature commit. The version is shown in the About dialog.
- `scripts/windows/release.sh [major|minor|patch]` does the same bump plus commit, tag `v<version>`, and push - it triggers the release pipeline, so use it only when actually cutting a release. The release workflow rejects tags that do not match `VERSION`.

## This machine: development and testing only

This machine is for development and testing (lint, typecheck, unit tests, `npm run tauri dev`). Do not cut releases from here - the shipped Windows installer is built in CI (`release.yml` on a `v*` tag builds NSIS on a Windows runner).

## Settings over hardcode

Any behavior that can reasonably be parameterized must be exposed through Settings, not hardcoded: add a field to `AppConfig` (`src-tauri/src/config.rs` - default, `sanitized()` clamp, `settings_pairs()`), let ts-rs regenerate the binding via `cargo test`, and add a control in the matching Settings tab (`src/sections/Settings.tsx`). This applies to counts, sizes, horizons, visibility toggles, and layout proportions alike. Hardcode only true constants (protocol values, schema names) or things with no sane alternative value.

## Checks before committing

- Frontend: `npm run lint && npm run typecheck && npm test && npm run build`.
- Rust (from `src-tauri/`): `cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test`.
- CI mirrors exactly these gates; clippy warnings are errors.
