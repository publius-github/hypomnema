# app-pkb

Local-first personal productivity app for Windows: weekly task planner, journal, and Markdown knowledge base in one window. Tauri 2 (Rust core) + React + TypeScript frontend. All data lives in a user-chosen vault folder: SQLite DB (`app.db`), `journal/`, and `config/` with per-feature YAML files (`recurring.yml`, `scheduled.yml`, `birthdays.yml`, `weekly-focus.yml`, `day-reminders.yml`, `day-schedule.yml`, `app.yml`). The Rust core owns all business logic (task generation engine, dedup via `rule_runs`, overdue carry-over, YAML parsing, watchers); the React layer is presentation only. See `IMPLEMENTATION_PLAN.md` for the full architecture, data model, and milestone history.

## Layout

- `src/` - React frontend (Zustand store, Tailwind tokens, CodeMirror editor).
- `src-tauri/src/` - Rust core: `engine.rs` (generation), `tasks.rs`, `db.rs` (migrations), `vault.rs`, `journal.rs`, `kb.rs`, `reminders.rs`.
- `scripts/build.sh` - local installer build; `scripts/release.sh` - version bump + tag + push.

## Versioning

The `VERSION` file at the repo root is the single source of truth for the release number. Never edit it by hand and never edit versions in `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` directly - `scripts/release.sh [major|minor|patch]` (default patch) bumps `VERSION` and syncs all manifests, commits, tags `v<version>`, and pushes. The release workflow rejects tags that do not match `VERSION`. When work warrants a release, bump via the script, not manually.

## This machine: development and testing only

This machine is for development and testing (lint, typecheck, unit tests, `npm run tauri dev`). Do not cut releases from here - the shipped Windows installer is built in CI (`release.yml` on a `v*` tag builds NSIS on a Windows runner).

## Checks before committing

- Frontend: `npm run lint && npm run typecheck && npm test && npm run build`.
- Rust (from `src-tauri/`): `cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test`.
- CI mirrors exactly these gates; clippy warnings are errors.
