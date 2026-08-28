# app-pkb Implementation Plan

Engineering plan for building app-pkb as described in README.md, extended with the decisions collected during requirements gathering. This document is the reference for the development phase: scope, architecture, data model, and milestone order live here. UI language is English-only; this document and all code, commits, and PRs are in English.

## 1. Confirmed decisions

| Topic | Decision |
| --- | --- |
| Tech stack | Tauri 2 (Rust core) + React + TypeScript frontend. Chosen for small footprint, native Windows notifications/tray, first-class GitHub Releases updater, and a real cross-platform path (Windows now, macOS/Linux later, mobile possible on Tauri 2). |
| Storage | Hybrid: SQLite for tasks, lists, app state, and settings mirror; Markdown files for Journal entries and the Knowledge Base. |
| Scope of phase 1 | The full functional list from README (all 20 requirements), delivered incrementally through the milestones in section 8. |
| Distribution | Built for personal use first; release pipeline targets GitHub Releases with the Tauri updater from the start (mature setup, no Store). |
| Markdown editing | Obsidian-style live preview (single pane, syntax rendered in place), built on CodeMirror 6. Same editor component reused in Journal, KB, and task descriptions. |
| Background behavior | No background service and no tray-resident process in phase 1. Reminders and cron generation run only while the app window is open; missed cron firings are caught up at startup. |
| Cron catch-up | On startup, generate one instance per missed period per rule since the last run. The lookback window (how far back to catch up) is a setting. |
| Data location | Single user-chosen vault folder selected on first run. It contains the SQLite DB, journal/, and config/. The KB folder can live inside the vault or be any other folder the user points to. |
| Week grid columns | Rolling window: today + N-1 following days. N is configurable in Settings (e.g. 5/7/10). |
| Automation config (requirements 11-14) | YAML files in the vault are the source of truth for recurring tasks, weekly focus phrases, day-type reminders, and day-schedule blocks. Settings UI can view and edit the same values; UI edits write back to the YAML files. |
| Config layout (req. 23) | One YAML file per task/rule type instead of a combined config: `recurring.yml`, `scheduled.yml`, `birthdays.yml`, `weekly-focus.yml`, `day-reminders.yml`, `day-schedule.yml`. Application parameters live in their own `app.yml`, separate from all task configs; the SQLite `settings` table becomes a read cache/mirror of `app.yml`. |
| Scheduled events (req. 21) | Dedicated Upcoming section (fifth tab, sub-tab "Scheduled"). One-off events with an exact future date wait in the Upcoming list, sorted by date; the engine materializes each event as a normal task on its day (same dedup ledger as recurring). After materialization the task is user-owned like any other. |
| Birthdays (req. 22) | Sub-tab "Birthdays" in the Upcoming section. Entries (name, MM-DD, optional birth year) generate one reminder task per year in an auto-created "Birthdays" list; age shown when the birth year is known. Added via UI form (writes back to `birthdays.yml`) or by editing the file. |
| Done one-off tasks | A completed one-off task stays visible on its day until the day ends; from the next day it no longer appears on the Dashboard. Records are kept in the DB forever by default, or pruned after N days if the user sets a retention value in Settings. |
| Engineering baseline | GitHub Actions CI from day one: lint + build + unit tests for the core logic (cron generation, dedup, overdue carry-over, YAML parsing) on every PR; release workflow on tag. E2E tests deferred. |

## 2. Architecture overview

Two layers with a strict boundary:

- **Rust core (Tauri backend)** owns all data and business logic: SQLite access, YAML config parsing and validation, the recurring-task engine, catch-up, overdue carry-over, dedup, archiving/pruning, filesystem access for Journal and KB, and the notification scheduler. Exposed to the frontend as Tauri commands plus events for push-style updates (e.g. "tasks regenerated").
- **React frontend** is a pure view layer: it renders state received from commands/events and sends user intents back. No business rules in TypeScript beyond presentation logic (grouping for display, drag-and-drop gestures).

Rationale: every rule the README cares about (no duplicates, preserve user edits on regeneration, overdue handling) must behave identically regardless of which screen triggered it, so it lives in one place, in Rust, where it is unit-testable without a UI.

Key crates/libraries (pin exact versions at project init):

- Rust: `tauri` 2.x, `rusqlite` (bundled SQLite), `serde` + `serde_yaml`, `croner` or `cron` for cron parsing, `notify` for watching config/KB folders, `chrono`.
- Frontend: React 18+, TypeScript, Vite, CodeMirror 6 (`@codemirror/lang-markdown` + live-preview decorations), `@dnd-kit` for drag-and-drop, Zustand (or equivalent light store), Tailwind CSS with a dark/light token layer.

## 3. Vault layout

Selected on first run (e.g. `D:\pkb`). Everything the app owns lives here, so backup/git-sync of one folder captures the whole state.

```
<vault>/
  app.db                 # SQLite: tasks, lists, instances, app state, settings mirror
  config/
    app.yml              # application parameters (theme, grid columns, retention, catch-up window, KB path)
    recurring.yml        # recurring task rules (cron)
    scheduled.yml        # one-off events with exact dates
    birthdays.yml        # birthday entries
    weekly-focus.yml     # weekly focus phrases and rotation
    day-reminders.yml    # day-type reminders
    day-schedule.yml     # day-schedule blocks
  journal/
    templates/
      daily.md           # user-editable journal template
    2026/
      2026-08-28.md      # one file per day, YYYY-MM-DD.md
```

- KB folder path is stored in settings; it may point inside the vault (e.g. `<vault>/kb/`) or anywhere else. The app never restructures the KB folder; it only reads the tree and edits files the user opens.
- The vault path itself is the only thing stored outside the vault (in the OS app-config dir), so the app can find it on startup.
- `app.db` uses WAL mode; schema versioning via numbered migrations executed at startup.

## 4. Data model (SQLite)

Core tables (final DDL at implementation time):

- `lists` - custom lists/projects: id, name, sort order, color, archived flag. Lists referenced from YAML items (`{05 Finance}`) are auto-created if missing (requirement 3).
- `tasks` - one row per task instance: id, title, description_md, list_id (nullable), scheduled_date (nullable for list-only tasks), time (nullable), status (`todo` / `done` / `postponed`), color, sort_order, parent_task_id (subtasks, requirement from Key features), created_at, completed_at, overdue_flag, origin (`manual` / `recurring` / `scheduled` / `birthday`), rule_key + period_key (for generated instances), archived_at.
- `rule_runs` - dedup ledger shared by all generators: rule_key, period_key, generated_at. Uniqueness constraint here is the duplicate guard (requirement 10): an instance for (rule, period) is generated at most once, ever, regardless of restarts or config reloads. Key derivation per source: recurring = hash(schedule + item text) + cron period; scheduled event = hash(date + title) + the date itself (period is the single occurrence); birthday = hash(name + MM-DD) + calendar year.
- `settings` - key/value read cache of `config/app.yml` (grid columns, done-task display mode, retention days, catch-up window, theme, KB path, journal template path). `app.yml` is the source of truth; the table is refreshed on startup and on watcher reload, and UI edits write through to the file.
- `weekly_focus_state` - rotation pointer for global weekly reminders (requirement 12): which phrase index is active for which ISO week.

Rules encoded in core logic, not in UI:

- **Overdue carry-over (req. 7, 8):** on startup and on day rollover while running, every non-done task with scheduled_date < today moves to today and gets overdue_flag = true. The flag survives further moves until the task is done.
- **Preserving user edits (req. 19):** regeneration and config reloads never touch existing task rows; the engine only inserts missing instances per `rule_runs`. Status changes, edits, and manual deletes of generated instances are permanent (a deleted instance is not regenerated for the same period - the `rule_runs` row remains).
- **Done one-off hiding (req. 9, 15):** Dashboard queries exclude one-off tasks completed before today; recurring instances follow the same rule. Retention pruning (if N days configured) is a startup job that deletes archived rows older than N.
- **Grouping and sorting (req. 16, 17):** within a day column, tasks group by list/category and sort by (time, list, sort_order); manual drag within a group updates sort_order.

## 5. YAML configuration

`config/recurring.yml` - as specified in README:

```yaml
tasks:
  - schedule: "0 0 1 * *"
    description: "Monthly"
    items:
      - "{05 Finance} pay bills for apartment"
```

`config/scheduled.yml` - one-off events with exact dates (req. 21):

```yaml
events:
  - date: 2026-09-14
    title: "{02 Personal} dentist appointment"
    time: "10:30"          # optional
```

`config/birthdays.yml` - birthday entries (req. 22):

```yaml
birthdays:
  - name: "John Smith"
    date: "03-14"          # MM-DD
    year: 1985             # optional; when present the task title includes the age
```

`config/weekly-focus.yml`, `config/day-reminders.yml`, `config/day-schedule.yml` - requirements 11-14, one file per feature:

```yaml
# weekly-focus.yml
rotation: cycle            # advance one phrase per ISO week
phrases:
  - "Ship one thing every day"
  - "Slow is smooth, smooth is fast"
```

```yaml
# day-reminders.yml
reminders:
  - day_type: workday      # workday | weekend | mon..sun
    text: "Plan the first hour before opening mail"
```

```yaml
# day-schedule.yml
blocks:
  - from: "09:00"
    to: "12:30"
    label: "Deep work"
  - from: "12:30"
    to: "13:30"
    label: "Lunch / walk"
```

`config/app.yml` - application parameters (req. 23), separate from all task configs: theme, grid column count, done-task display mode, retention days, catch-up window, KB path, journal template path. Same watcher/reload and UI write-back behavior as the task configs.

Processing rules:

- Files are parsed with strict schema validation; any error surfaces in the UI as a non-blocking banner with file, line number, and reason (README requirement). A broken file never wipes existing tasks - the last valid state stays active.
- A filesystem watcher reloads configs on change while the app runs; reload applies new rules without touching user data (req. 18, 19).
- `{List Name} task text` item syntax: the braced prefix maps to a list (auto-created), the remainder is the task title. Items without a prefix land in a default Inbox list.
- Settings UI (section 7) renders these files as forms and writes edits back to YAML, preserving comments where feasible (document if not feasible; source of truth remains the file).

Recurring engine algorithm (startup + midnight rollover + config change):

1. Load rules; compute rule_key = hash(schedule + description + item text).
2. For each rule, enumerate cron firings from max(last handled firing, now - catch-up window) to now.
3. For each firing, derive period_key (the firing timestamp truncated to the schedule granularity) and insert the task instance only if (rule_key, period_key) is absent from `rule_runs`.
4. Run overdue carry-over after generation so caught-up past instances land on today with the overdue mark (README rule).

Scheduled events and birthdays run through the same engine pass with simpler enumeration:

- **Scheduled event:** materialized as a task on its date once the date is within the rolling grid window (or already past, at which point carry-over applies). Until then it exists only as a YAML entry shown in the Upcoming list. Dedup via `rule_runs` as in section 4; deleting the materialized task does not resurrect it.
- **Birthday:** one instance per entry per calendar year, created when the day enters the grid window; lands in the auto-created "Birthdays" list. Title is `Birthday: <name>` plus `(turns N)` when the birth year is known.
- Editing or removing a YAML entry before materialization simply changes what will be generated; after materialization the existing task row is never touched (req. 19).

## 6. UI structure

Left vertical tab bar with five sections (README IA), dark and light theme via a token layer, all labels in English.

**Dashboard (Tasks).** Top zone: rolling week grid, today + N-1 days, one column per day; the weekly focus phrase of the current ISO week is displayed in the grid header (req. 11). Bottom zone: horizontally arranged custom lists. Both zones share one drag-and-drop context so tasks move between any day and any list. Task card: checkbox cycling To Do / Done / Postponed, color stripe, time badge, overdue badge, subtask expander, markdown-rendered description on open. Done tasks render per display setting: inline with active tasks or collapsed into a separate block per column (req. 15). Day columns show the applicable day-type reminder (req. 13) and, for today, the current/next day-schedule block (req. 14).

**Upcoming (Dates).** Fifth tab with two sub-tabs. "Scheduled": future one-off events from `scheduled.yml`, sorted by date, with a quick-add form (date, title with optional `{List}` prefix, optional time) that writes back to the YAML; already-materialized events drop out of this list. "Birthdays": all entries from `birthdays.yml` sorted by next occurrence, showing days-until and age when the birth year is known, with an add/edit form writing back to the YAML.

**Journal.** "Today" opens the template-instantiated entry for the current date (created on first open from `journal/templates/daily.md`), edited in the live-preview editor, autosaved to `journal/YYYY/YYYY-MM-DD.md`. A date list/calendar gives access to past entries. Template is editable in-app.

**Knowledge Base.** Folder picker (persisted), file tree of `.md` files, live-preview editor with autosave, basic file operations (create, rename, delete) and filename search. External edits are picked up by the watcher.

**Settings.** Vault info and form-based editors for all config files with inline validation errors: `app.yml` (KB path, grid column count, done-task display mode, retention days, catch-up window, theme, journal template shortcut) plus `recurring.yml`, `weekly-focus.yml`, `day-reminders.yml`, `day-schedule.yml`. `scheduled.yml` and `birthdays.yml` are edited primarily in the Upcoming section.

## 7. Testing and CI

- **Unit tests (Rust)** are the quality core, covering: cron enumeration and catch-up windows, dedup via `rule_runs` (including restart and config-edit scenarios), overdue carry-over across day boundaries, `{List} text` parsing, YAML validation errors with line numbers, done-task visibility rules, retention pruning, and migration idempotency.
- **Frontend:** typecheck + ESLint + a small set of component tests for the task card state machine and drag-and-drop reducers.
- **CI (GitHub Actions), pinned action versions:**
  - `ci.yml` on PR and push to main: lint (rustfmt + clippy, eslint + tsc) -> build -> test. Fails fast in stage order.
  - `release.yml` on version tag: Windows build via `tauri-action`, artifacts (NSIS installer + updater manifest) attached to a GitHub Release. Updater signing keys stored in GitHub Secrets from the first release.
- Trunk-based flow: feature branches -> PR -> main; releases cut by tag.

## 8. Milestones

Each milestone ends in a working, committed state. Order is chosen so the riskiest logic (recurring engine) gets real usage early.

**M0 - Skeleton and toolchain.** Tauri 2 + React + TS project scaffold, CI pipeline green (lint/build/test), window with the five-tab shell, dark/light theme toggle, vault folder selection on first run, `app.yml` created with defaults and mirrored into SQLite, migration runner. Exit: installer builds locally, empty app runs.

**M1 - Task core and Dashboard.** Tasks/lists schema, CRUD via Tauri commands, rolling week grid + custom lists, drag-and-drop between days and lists, status checkboxes, colors, time, subtasks, markdown descriptions, done-task display modes, grouping and sorting within a day. Exit: the app is usable as a manual weekly planner (README reqs 1-4, 6, 15-17).

**M2 - Generation engine.** `recurring.yml`, `scheduled.yml`, and `birthdays.yml` parsing with line-accurate errors, cron generation, scheduled-event and birthday materialization, `rule_runs` dedup across all three sources, startup catch-up with configurable window, config watcher and safe reload, overdue carry-over with the overdue mark, done one-off hiding, retention pruning. Full unit-test coverage of this module. Exit: reqs 5, 7-10, 18-22 (engine side).

**M3 - Journal.** Template file, today-entry creation, CodeMirror live-preview editor, autosave, entry browser, template editing. Exit: README MVP item 3.

**M4 - Knowledge Base.** Folder connection, file tree, editor reuse, file operations, external-change watcher, filename search. Exit: README MVP item 4.

**M5 - Upcoming, reminders, and schedule layer.** Upcoming section UI (Scheduled and Birthdays sub-tabs with quick-add forms writing back to YAML), `weekly-focus.yml` / `day-reminders.yml` / `day-schedule.yml` parsing, weekly focus display with cycle rotation, day-type reminders, day-schedule block with current/next focus, in-app notifications for task times while the app is open. Exit: reqs 11-14, 21-22 (UI side).

**M6 - Settings UI and config round-trip.** All settings forms backed by `app.yml`, YAML view/edit forms with validation for the remaining config files, display preferences wired end to end. Exit: README MVP item 6 plus the "config in file, editable via UI" decision and req. 23.

**M7 - Release hardening.** Tauri updater wired to GitHub Releases, signed update manifest, `release.yml` proven with a tagged v0.1.0, app icon, error reporting to a local log file, README updated with build/run instructions. Exit: installable release with a working update path.

## 9. Deferred (explicitly out of phase 1)

- Tray-resident mode, autostart, and reminders while the window is closed.
- macOS/Linux builds (architecture keeps them cheap: no Windows-only APIs outside the notification/installer layer).
- E2E test suite.
- KB features beyond editing: backlinks, full-text search, graph.
- Any cloud sync (vault folder + user's own git/sync tooling covers it).

## 10. Risks and mitigations

- **Live-preview editor effort.** Obsidian-grade live preview on CodeMirror 6 is the largest pure-frontend risk. Mitigation: build it once as a shared component in M3 with a bounded feature set (headings, bold/italic, lists, checkboxes, code, links); ship split-view as a fallback flag if the in-place rendering drags.
- **Cron semantics vs. day-granularity tasks.** Cron fires at instants, tasks live on days. The period_key derivation (section 5) must be nailed down in M2 with tests before any UI depends on it.
- **YAML round-trip from UI.** Comment-preserving YAML editing is hard; if the chosen library cannot preserve comments, the Settings editor states that saving reformats the file. Decide in M6, not later.
- **Windows time changes (DST, manual clock moves).** Catch-up and rollover logic must use local dates derived at evaluation time, never cached "today"; covered by unit tests with injected clocks.
