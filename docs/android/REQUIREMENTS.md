# Hypomnema Mobile — Requirements (draft)

Distilled from this repo's `docs/general/ARCHITECTURE.md`,
`docs/general/DECISIONS.md`, and
`src-tauri/src/{engine,tasks_mirror,state_export,config,config_files,vault}.rs`
(the Android target lives in this same repo, per ROADMAP.md's decision to
build it as a second target of the same Tauri project rather than a
separate one). This is a requirements draft to plan from, not an
implementation plan.

## 1. Vision

A mobile app (Android/iOS) that opens the *same* vault as the desktop app,
shared via Dropbox, and is a first-class read/write client — not a read-only
mirror of it:

- Runs its own copy of the generation engine, so recurring/scheduled/birthday
  tasks materialize on the phone from the same YAML config files the desktop
  reads, independent of whether the desktop is running.
- Supports manual task and list creation/editing, same data model as desktop.
- Reads and edits Notes (KB) and Journal.
- Resolves conflicts that arise from both ends writing to the shared vault,
  rather than requiring "never have it open in two places at once."

This explicitly reverses two things `DECISIONS.md` used to state as
deliberate: *"No rich mobile editing... a native/companion mobile app is out
of scope"* and *"No multi-user/collaboration... no concurrent editing story
beyond 'don't have the vault open in two places at once.'"* **Done
2026-09-08:** both entries were narrowed there, along with two more the
Android work outgrew - the no-cloud-sync entry (the phone talks to the
Dropbox API directly, since Android exposes no synced folder to point at)
and the no-app-lock half of the encryption entry.

## 2. Why this isn't "just point a second app at the same SQLite file"

`app.db` is SQLite in WAL mode, written under a single-process assumption.
Two independent app instances on two devices writing to the same file through
a consumer file-sync tool (Dropbox) is unsafe: Dropbox syncs at the file
level with no shared-lock awareness, the `-wal`/`-shm` side-files must stay
consistent with the main file, and a sync mid-write risks corruption or one
device's commit silently clobbering the other's.

The desktop app already treats `app.db` as a **disposable local cache** for
this exact reason (`state_export.rs`): every meaningful mutation snapshots
authoritative state as JSONL text (`tasks.jsonl`, `lists.jsonl`,
`rule_runs.jsonl`, `rule_seen.jsonl`, `weekly_focus.jsonl`) under
`.hypomnema/state/`, and `Vault::open` rebuilds `app.db` from that snapshot
whenever the file is missing.

**Mobile requirement: never sync `app.db`/`-wal`/`-shm` itself.** The synced
source of truth is the JSONL state, the config YAMLs, and the
Markdown mirror/notes/journal — exactly what the desktop already exports for
this purpose. Each device (desktop and phone alike) keeps `app.db` as a
private, rebuildable cache and only ever mutates shared state through the
same export path. `app.db*` should be excluded from the sync scope entirely
(selective sync / a shared ignore rule), since the JSONL snapshot is already
sufficient to rebuild it.

## 3. Conflict resolution

Desktop already has one working precedent worth generalizing: the task
mirror's per-field three-way merge (`tasks_mirror.rs::import_file`). It keeps
a `mirror-base/` snapshot of what it last exported; on reimport, a field from
the edited file applies only if it differs from that base (a human changed
it) — an untouched line never overrides an app-side edit, and absence deletes
only a task the base actually knew about. Two files independently carrying
the same marker (e.g. a Dropbox `(conflicted copy)`) are rejected with an
error rather than silently double-applied.

That pattern assumes a single app catching up with edits made *to its own
exported files* by a human in a text editor. With a second independent app
instance as the other writer, "base" can no longer just mean "what I last
exported" — it needs to mean "the last state both sides agree on." Concretely
this needs, for every synced record (task, list, rule_runs entry, config
entry, note, journal entry):

- A per-record `updated_at` (UTC) and `updated_by` (device id) stamp.
- A merge step run on read/sync: for each record, if only one side changed
  since the last common sync point, take that side; if both changed the same
  field, resolve by newest `updated_at` and log the discarded value to a
  visible conflicts list (never just drop it) — mirroring desktop's existing
  `(conflicted copy)` convention rather than inventing a new one.
- The `rule_runs` dedup ledger merges as a plain set union of `(rule_key,
  period_key)` pairs — it's inherently conflict-free, and both sides
  regenerating the same period independently must collapse to one row.

Most real edits here are additive (check off a task, add a config rule, add
a note) rather than field-for-field collisions, so the design should
optimize for *never silently losing data* over building a full CRDT from day
one. A simple last-writer-wins-per-field-with-audit-trail, applied uniformly
across tasks/lists/config/notes/journal, is enough for v1.

**Engine determinism requirement:** both devices must derive identical
`rule_key`/`period_key` values from the same rule (desktop uses stable
FNV-1a 64 hashing plus its own cron/catch-up/cadence semantics — see
`ARCHITECTURE.md` §Engine). If mobile reimplements the engine independently
in another language, any divergence in cron evaluation, catch-up windowing,
or the hash produces duplicate or missing tasks between the two engines'
independent runs. This is the single biggest argument for reusing the actual
Rust engine rather than reimplementing it (see §4).

## 4. Technology recommendation

Tauri 2 supports Android and iOS as build targets from the same Rust core
plus a web frontend. Given the determinism requirement above, the
highest-leverage architecture is: reuse
`src-tauri/src/{engine,tasks,config,config_files,vault,journal,kb,
tasks_mirror,state_export,db,reminders,views}.rs` as-is (or with minimal
target-gating) compiled for `aarch64-linux-android`/iOS, and build only what's
genuinely different — the desktop-only chrome (tray, global capture hotkey,
window management, GitHub-releases auto-updater) and a phone-shaped UI (not
a port of the wide multi-column dashboard grid).

Recommend against a ground-up reimplementation (Flutter/React
Native/native Kotlin+Swift) unless there's a concrete reason to (e.g. no
Rust/Tauri familiarity on whoever builds this) — a second engine
implementation is a second place for cadence/dedup bugs to diverge, and
that's the most likely source of subtle cross-device sync bugs.

## 5. Getting a Dropbox-synced vault onto a phone

Two approaches:

- **A. Filesystem-only**, matching desktop's zero-integration model: rely on
  a Dropbox (or other) client already keeping a folder synced on-device. This
  is genuinely weak on Android (the official Dropbox app doesn't expose a
  live-synced arbitrary folder to other apps' file I/O the way desktop OSes
  do) and only partially better on iOS (Files app + Dropbox extension).
- **B. Direct Dropbox API integration** (`files/upload` with
  `mode: update(rev)`, `files/download`, `files/list_folder/continue` for
  delta sync): more work (OAuth, app registration, app-folder scope,
  background-sync scheduling under each OS's battery limits, offline
  queuing), but gives two things §5-A cannot: an authoritative per-file `rev`
  for optimistic-concurrency writes (a clean, native conflict signal instead
  of diffing content after the fact), and no dependence on a Dropbox client
  being installed or its sync actually being live on-device.

**Recommended: B**, given conflict resolution is a hard requirement here, not
an afterthought — `rev` is close to free "last common ancestor" tracking for
§3. This needs your confirmation before committing, since it also means every
install needs a Dropbox developer app + OAuth consent flow.

## 6. Functional scope (parity mapping from desktop)

| Desktop section | Mobile requirement | Priority |
| --- | --- | --- |
| Dashboard | Day view + lists, merged into a single/tab phone layout; no multi-column paged grid | P0 |
| Upcoming (Scheduled/Birthdays/Recurring → YAML) | Same CRUD; comment-preserving YAML splice is nice-to-have, not required for v1 (see open question) | P0 CRUD / P1 comment-preserving |
| Manual task/list CRUD | Create, edit, complete/postpone/delete, subtasks | P0 |
| Task color/priority, drag-to-reorder | | P1 / P2 |
| Reminders (weekly focus / day reminders / day schedule) | Read-only summary first, CRUD later | P1 read / P2 CRUD |
| Calendar | Browse only, no drag-reschedule | P2 |
| History / Review | View-only | P2/P3 |
| Journal | Read + write, template-seeded | P0 |
| Notes (KB) | Browse tree + read | P0 |
| Notes editing, wiki-links, search, backlinks, trash | | P1 / P2 |
| Settings | Vault/Dropbox linking, sync status + conflict log, engine on/off | P0 |
| Settings: appearance, layout, profiles | | P2/P3 |
| Capture window / tray / global hotkey / auto-update | Not applicable (desktop-only concepts) — in-app quick-add covers the mobile equivalent | P1 quick-add, P3 share-sheet |

## 7. Non-functional requirements

- **Offline-first**: every read/write works with no network; sync is
  opportunistic (foreground trigger + background sync where the OS permits).
- **No silent data loss on conflict** — prefer surfacing both sides over a
  silent overwrite when fields materially differ (title/description/status).
- **At-rest exposure**: desktop currently has no vault encryption at all
  (`DECISIONS.md`), relying on OS disk encryption on a single machine. Once
  the vault also lives on a phone via Dropbox, that exposure grows (phone
  theft, Dropbox account compromise) beyond what "your own machine's disk
  encryption" covers — worth deciding now rather than retrofitting later.
  Minimum bar for mobile: Dropbox scoped to its own app-folder, local cache
  encrypted via the OS keystore.
- **Cross-engine parity is testable**: the same rule set fed to both engines
  from the same starting state must produce the same task set and the same
  `rule_key`/`period_key` values — this should be an explicit test, not an
  assumption.

## 8. Open questions

1. Platform priority — Android first, iOS first, or both at once?
2. Tauri-mobile shared Rust core (§4, recommended) vs. a from-scratch stack —
   confirm, or name a constraint that rules it out.
3. Dropbox integration — direct API (§5-B, recommended) vs. relying on an
   OS-level synced folder (§5-A, simpler, weaker conflict signals especially
   on Android).
4. Comment-preserving YAML edits from mobile — required for v1, or is it
   acceptable that editing `recurring.yml`/etc. from the phone may lose
   hand-written comments initially?
5. Vault encryption at rest — in scope for v1, or deferred with the risk
   accepted for now?

## 9. Suggested MVP slice

Vault linking (Dropbox auth + app-folder), engine running locally against
synced config YAMLs + JSONL state, manual task/list CRUD, Journal read/write,
Notes read (edit if time allows), and a visible sync-status/conflict log
screen. Everything else in §6 phases in afterward.
