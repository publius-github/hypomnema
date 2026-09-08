# Hypomnema Mobile — Roadmap

Basis: `REQUIREMENTS.md` in this folder, cross-checked against
`docs/general/ARCHITECTURE.md` / `docs/general/DECISIONS.md` and
`src-tauri/src/{engine,tasks,tasks_mirror,state_export,vault}.rs` elsewhere
in this same repo.

## Decisions locked in for this roadmap

| Question (REQUIREMENTS.md §8) | Decision |
| --- | --- |
| Platform | **Android only** — iOS is not planned |
| Tech stack | **Tauri 2 + shared Rust core**, cross-compiled for `aarch64-linux-android` |
| Vault storage on the phone | **A local folder the app owns.** The app is local-first and works with no network and no account; Dropbox is one way to *sync* a vault, not the way to *have* one. Spike A's finding (no reachable Dropbox-synced folder on Android) was read too broadly at first and made the API backend a precondition for opening a vault at all - corrected 2026-09-08 |
| Dropbox integration | **Direct API only, and optional** — the dual-backend plan below was the working assumption until Spike A; Spike A failed (docs/android/SPIKES.md, 2026-09-08), so `DropboxApiSyncProvider` is the sole backend for v1, not a user-facing choice |
| Comment-preserving YAML edits | Not required for v1 (P1, phases in later) |
| Vault encryption at rest | **In scope for v1** (OS keystore-backed local cache encryption) |

### Dropbox integration: dual-backend, not either/or (superseded — see verdict below)

**Status: Spike A failed (2026-09-08, docs/android/SPIKES.md) — the section
below is kept for its reasoning but its conclusion no longer holds.** The
official Dropbox Android app doesn't expose a live-synced folder to other
apps' filesystem access at all, so there was never a `FilesystemSyncProvider`
to make the "dual" half of dual-backend real. `DropboxApiSyncProvider` is the
sole backend for v1 — jump to Phase 1/Phase 2 below for what that means
concretely.

Initial plan picked filesystem-only sync (§5-A) to avoid OAuth/API work.
That trade-off assumed the Dropbox API cost money or added scope beyond what
it's worth — checked, and it doesn't: `files/upload`/`download`/
`list_folder`, `App folder` scoping, and OAuth are all part of the free core
Dropbox API (works on a free Basic account), and a personal-use app never
comes close to the 500-linked-user cap that triggers production-approval
requirements. So the "more work, no payoff" framing was wrong on the payoff
side — decision revised to **support both backends**, switchable, rather
than picking one.

Concretely: a `SyncProvider` abstraction (Phase 1) with two implementations —
`FilesystemSyncProvider` (SAF folder access) and `DropboxApiSyncProvider`
(OAuth + `files/*`) — sitting behind the same interface the merge/conflict
logic in §3 consumes. The per-record `updated_at`/`updated_by` merge design
doesn't care which backend moved the bytes; what differs between backends is
narrower than it first looks:

- **Change detection / write safety:** API backend gets real optimistic
  concurrency via `rev` (`mode: update(rev)` rejects a stale write outright).
  Filesystem backend has no such guarantee — falls back to content hash/mtime
  comparison, and treats a Dropbox `(conflicted copy)` file as a hard error,
  mirroring desktop's existing `tasks_mirror.rs` convention.
- **Setup UX:** API backend needs an OAuth consent screen; filesystem backend
  needs a SAF folder picker. Both live in the vault-linking screen (Phase 2)
  behind one toggle.
- **At-rest scoping (§7 NFR):** API backend's `App folder` permission gives
  real OS/Dropbox-enforced app-folder scoping for free. Filesystem backend
  has no such enforcement — mitigation stays a documented setup step (user
  points the picker at a dedicated subfolder), not a guarantee. Revisited in
  Phase 4.

This does add real surface: two providers to build, test, and keep correct
under the same merge contract, instead of one. Worth it here because the
filesystem path's Android feasibility is still unproven (next section) —
having the API backend as a real, shipped alternative rather than a
theoretical fallback means a Phase 0 failure on the filesystem side doesn't
stall the project, just narrows which backend ships first.

### Consequence of the filesystem backend's Android weakness — resolved 2026-09-08

**This section is now history, not a live decision** — kept for the
reasoning trail. Spike A confirmed the risk below for real: DropboxApiSyncProvider
is the sole backend for v1, item 1's "if it fails" branch is what happened,
and item 2 is moot since there's only one backend's guarantees to explain now.

REQUIREMENTS.md §5 flags the filesystem approach as *"genuinely weak on
Android: the official Dropbox app doesn't expose a live-synced arbitrary
folder to other apps' file I/O the way desktop OSes do."* This risk now
scopes to **one of the two providers**, not the whole project, but it still
needs resolving early because it decides which backend is the Phase 2 launch
default:

1. Phase 0 runs a go/no-go spike on filesystem access (below) before UI work.
   If it fails or proves flaky, the API backend becomes the sole/default
   provider for launch and the filesystem provider either phases in later or
   gets dropped — no project-level blocker either way, since the API backend
   doesn't depend on this spike.
2. The two backends' conflict-*detection* strength genuinely differs (`rev`
   vs. hash/mtime), even though conflict *resolution* (the §3 merge logic)
   is shared — worth surfacing in the Settings UI (Phase 2) so a user who
   picks the filesystem backend understands it's the weaker-guarantee option.

---

## Phase 0 — Feasibility spikes

Goal: resolve the filesystem backend's biggest unknown, and prove the
toolchain, before real building starts. The API backend has no comparable
feasibility risk (it's a documented, supported OAuth+REST flow) so it
doesn't need a spike — it gets built for real in Phase 1.

- **Spike A (go/no-go for the filesystem provider only):** get a synced
  Dropbox folder's files readable *and writable* from a normal Android app,
  persisted across app restarts and device reboots. Try, in order: Storage
  Access Framework persistent URI permission over a folder the Dropbox app
  manages; if that's insufficient, a third-party sync client with SAF
  exposure (e.g. FolderSync/Autosync against Dropbox) as the sync layer
  instead of the official Dropbox app. Document exactly what does and
  doesn't work, including background-sync behavior when the app isn't
  foregrounded.
  - **Exit criteria:** a checked-in throwaway app that writes a file into the
    synced folder from Android and confirms (manually, via desktop) it
    lands in Dropbox, and vice versa.
  - **If this fails:** drop or defer `FilesystemSyncProvider`; ship with
    `DropboxApiSyncProvider` as the only backend for v1 and revisit the
    filesystem provider later (e.g. if a cleaner Android mechanism appears).
    Nothing else in the roadmap needs to change — Phase 1 builds the API
    backend regardless of this outcome.
- **Spike B:** cross-compile the existing desktop Rust core
  (`engine.rs` at minimum) for `aarch64-linux-android` inside a Tauri 2
  mobile shell, and get it calling into a trivial Android UI. Confirms the
  toolchain (NDK, Tauri mobile CLI, signing) works before any real feature
  code depends on it.
  - **Exit criteria:** a "hello world" Tauri Android build running on a
    device/emulator that calls one real function from `engine.rs` and shows
    its output.

**Deliverable:** written verdict on both spikes, committed to this repo,
before Phase 1 begins.

## Phase 1 — Shared core plumbing (no UI yet)

Goal: the data layer conflict-resolution design from REQUIREMENTS.md §3
actually exists in code, on both ends.

- [x] Define the `SyncProvider` abstraction (roughly: list changed files
  since a cursor/checkpoint, read a file + its change-marker, write a file
  guarded by its last-known change-marker, surface a "write rejected,
  remote changed" signal) — `src-tauri/src/sync_provider.rs`, trait +
  types only, unit-tested against an in-memory mock (no real backend
  wired up yet).
  - [x] Implement `DropboxApiSyncProvider`'s API client half — `files/upload`
    with `mode: update(rev)`/`add`, `files/download`, `files/list_folder`/
    `continue` — `src-tauri/src/sync_dropbox.rs`, request/response shaping
    and error mapping (409 → `Error::SyncConflict`) unit-tested against a
    mock `DropboxTransport`, real transport (`HttpDropboxTransport`) via
    `ureq` (rustls-backed, no native OpenSSL - cross-compiles cleanly for
    `aarch64-linux-android`). Takes an already-issued bearer token; **not**
    wired to any Tauri command yet.
  - [x] OAuth2 PKCE — Rust half: `src-tauri/src/sync_dropbox_oauth.rs`.
    Verifier/S256-challenge generation (checked against RFC 7636's test
    vector), authorize-URL shaping with `token_access_type=offline`, code→
    token exchange and refresh-token exchange, all unit-tested against a
    mock transport. App key registered: `v775pphfltppmmv` (App folder
    access, resolved 2026-09-08 — the vault this links to must live under
    `Apps/Hypomnema/` in Dropbox, see the open item below). No client
    secret anywhere: the app key is a public identifier under PKCE.
  - [x] OAuth2 PKCE — Android half: `dropbox_auth_url` opens the consent
    page in a real browser via `tauri-plugin-opener` (the existing
    `open_external` can't: its non-Windows/macOS branch shells out to
    `xdg-open`, which doesn't exist on Android). **First cut deliberately
    skips redirect plumbing**: with no `redirect_uri`, Dropbox displays the
    code for the user to paste into the app, so there's no intent-filter to
    maintain in the regenerated `gen/android` project and no Custom Tabs
    dependency. A real redirect can replace it later -
    `authorize_url`/`exchange_code` already take it as an argument.
    **Not yet verified on device.**
  - [x] Token storage: `src-tauri/src/dropbox_link.rs` - refresh token kept
    across restarts in the app's private config dir (never the vault, never
    a synced folder), access token refreshed 5 min before expiry rather
    than on a 401 so a sync pass never unwinds mid-flight. Unit-tested with
    injected time. Plain JSON for now; keystore-backed encryption is
    Phase 4.
  - [x] Link screen + smoke test: `src/components/DropboxLink.tsx`, shown
    by `VaultPicker` when `platform_is_mobile` — authorize, paste the code
    Dropbox displays, then "List app folder" runs `sync_dropbox::census`
    over the same paging code the provider uses, so a green result means
    OAuth, token storage, the HTTP client and the App-folder scope all work
    end to end. **Confirmed on a real device 2026-09-08**: browser consent
    → pasted code → token → listing of a real vault's files. The census
    reports folder and tombstone counts next to the file list on purpose:
    during setup, "no files" and "no files because the vault went to a
    different folder" look identical without them, and that distinction is
    what actually diagnosed the first failed attempt.
  - **Setup gotcha, learned the hard way:** the app folder is the one
    *Dropbox* creates at authorization, named after the registered app -
    not a folder of that name made by hand, and its parent is localized
    (`Приложения/` on a Russian account, `Apps/` on English). A vault put
    in a same-named folder the user created is invisible to the token, and
    presents as an empty listing with a pile of tombstones from the vault's
    brief stay in the real one. Never state the app-folder path from the
    app's *name* - it comes from what was typed into the Dropbox console.
  - [x] Marker file (`dropbox_write_marker`): the app drops a named file
    into its own app folder on request, so "which folder is this actually?"
    is answerable from the desktop by searching for that file instead of by
    inference. Doubled as the first exercise of the write path.
  - [x] ~~Implement `FilesystemSyncProvider`~~ — **dropped for v1.** Spike A
    (docs/android/SPIKES.md, 2026-09-08) failed: the official Dropbox
    Android app doesn't expose a live-synced folder to other apps' SAF
    access at all. Revisit only if a cleaner Android mechanism appears later.
- [x] Implement the merge step: last-writer-wins per field, newest
  `updated_at` wins on a same-field collision, discarded value logged to a
  conflicts list (never silently dropped) — `src-tauri/src/sync_merge.rs`,
  generic over a JSON field map, unit-tested (collision resolution, clean
  merges, field removal, deletion-vs-edit).
- [x] **Wired to real records** — `src-tauri/src/sync_state.rs` runs that
  merge over the JSONL snapshot row by row, and `sync_cycle.rs` runs a
  full pass (incoming, merge, outgoing, deletions both ways) behind the
  `dropbox_sync` command. Each snapshot file gets the merge its content
  deserves rather than one blanket rule: `tasks`/`lists` by their stamps,
  `rule_runs` as a set union, `rule_seen` keeping the *earliest*
  first-seen (a later one would re-run a rule's whole history as fresh
  overdue tasks), `weekly_focus` keeping this device's pin and logging the
  other since nothing stamps it.
  - Prose — notes, journal entries, config YAML — is **not** merged line
    by line. Two people's paragraphs merged mechanically produce a version
    neither wrote, so the other device's copy takes the path and this
    device's is kept beside it as `<name> (conflicted copy <device>
    <date>)<ext>`: the convention `tasks_mirror.rs` already treats as a
    hard signal, and the one Dropbox users recognize. Both copies sync.
  - A pass that changed the snapshot drops app.db and reopens the vault,
    so the merged JSONL rebuilds the cache through `state_export.rs`'s
    existing restore path — no second way to write rows into SQLite.
- [x] Deletions propagate both ways (`sync_cycle.rs`). The objection that
  blocked this — "a file missing locally is indistinguishable from one
  this device never pulled" — is answered by the pull manifest: an entry
  in it means the file *did* arrive here, so its absence now is a
  deletion, while a file that was never pulled has no entry and is simply
  downloaded. Every remote delete is guarded by the revision this device
  last saw, so an edit on the other end refuses the delete rather than
  losing it; symmetrically, a file deleted remotely but edited here
  survives and goes back up. Both cases land in the conflict log.
- [x] Conflict log: `sync_conflicts.rs` persists what each pass had to
  choose between under `.hypomnema/sync/conflicts.json` (device-local —
  it records what *this* device decided), capped at the 300 newest
  entries, read and cleared through
  `sync_conflicts_list`/`sync_conflicts_clear`.
- [x] Implement `rule_runs` merge as plain set union of `(rule_key,
  period_key)` — `sync_merge::merge_rule_runs`, unit-tested.
- [x] Per-record `updated_at` (UTC) and `updated_by` (device id) on
  `tasks` and `lists`, in the database (db.rs migration 016) and in
  `tasks.jsonl`/`lists.jsonl`. Additive and optional in both directions: a
  snapshot from an older build restores without them, and an older build
  ignores them, so two devices on different versions share one vault.
  Stamps come from SQLite triggers rather than the ~70 call sites that
  write these tables - a missed site would not fail a build, it would
  silently hand a merge to the wrong side. `device.rs` holds the id,
  outside the vault so a synced copy cannot carry another machine's
  identity.
  - **Not stamped, deliberately:** `rule_runs`/`rule_seen` merge as a set
    union and a min-date, which are conflict-free and need no stamp;
    `weekly_focus` is a genuine last-writer-wins value and should get one
    when the merge actually consumes it, rather than a dead column now.
- [x] `app.db`/`-wal`/`-shm` never travel: `src-tauri/src/sync_paths.rs`
  decides what belongs to the shared vault, as a **whitelist**. A new file
  kind added elsewhere in the app defaults to device-local and is merely
  absent on the other device, rather than defaulting to shared and
  arriving where it can do damage. Decisions it encodes, beyond the
  database: user content and `.hypomnema/{state,config}` travel; the
  mirror's merge base does not (it records what *this* device exported);
  `settings/` does not (window layout on a phone is not a desktop's);
  `backups/` does not (a per-device safety net); the task mirror does not
  (derived from the database - syncing it would give one row two writers
  racing to describe it).
- [~] Vault bootstrap. Done: `src-tauri/src/sync_bootstrap.rs` finds the
  vault inside the app folder and pulls its shared files into this
  device's private storage (`dropbox_pull_vault`). The vault root is
  *detected*, not configured - Dropbox's own `desktop.ini` and this app's
  marker live at the app-folder root, so keeping the vault in a subfolder
  there is the natural layout, and both that and a root-level vault work
  with no setup step. Two vaults side by side are refused rather than
  guessed between. The pull is resumable: each file's revision is recorded
  as it lands, so an interrupted run (Android freezes a backgrounded app,
  and a screen lock during a several-hundred-file pull is not an edge
  case) resumes instead of starting over. Opening the pulled copy runs the
  migrations and rebuilds `app.db` from the JSONL through the same
  disposable-cache path the desktop uses, after which every existing
  command and the engine work against it unchanged.
- [ ] **Cross-engine parity test** (§7 NFR, don't defer this): a test
  harness that feeds the same rule set into the desktop engine and the
  mobile-built engine binary from the same starting state and asserts
  identical task sets and identical `rule_key`/`period_key` values. This
  should exist before Phase 2 UI work, since it's the cheapest point to
  catch a divergence. (Moot as a *cross-binary* test until there's a second
  binary to run against — right now "mobile-built engine" is the same
  `engine.rs` cross-compiled, not a separate implementation, so the real
  risk this guards against hasn't materialized yet.)

**Deliverable:** a headless build that can open a real (test) vault folder,
rebuild its cache, run the engine, and merge a manufactured two-sided edit
correctly — verified by the parity test, no UI required yet.

## Phase 2 — MVP UI (Android)

Goal: the "Suggested MVP slice" from REQUIREMENTS.md §9, on real UI.

- Vault linking screen: Dropbox API is the only backend (Spike A failed, no
  toggle needed) — OAuth (PKCE) consent flow, app-folder or full-Dropbox
  access depending on the choice made before Phase 1's `DropboxApiSyncProvider`
  work; first-run detection, persisted token.
- [x] Day view + lists — `src/mobile/`, a bottom-tab shell with a
  one-day-at-a-time view and one list at a time. Not a responsive squeeze
  of the desktop grid: that grid is built for a wide window and a mouse,
  and narrowed to a phone it is a worse version of both. Tabs sit at the
  bottom because that is where a thumb reaches.
- [~] Manual task CRUD: create, complete, postpone, move to tomorrow,
  star, delete. The whole row toggles done, since that is what a task row
  is for most of the time; the rarer actions open inline rather than in a
  modal, which on a phone would cover the list the action refers to.
  Still to do: editing a task's text, subtasks, list CRUD.
- [x] Journal: read + write, template-seeded, one day at a time. A plain
  textarea rather than the desktop's CodeMirror - the system keyboard and
  its autocorrect are the editor on a phone, and a code editor fights
  both. Debounced saves are flushed on day change and unmount, because
  backgrounding the app is the normal way to leave it here.
- [x] Notes: browse and read, one folder at a time with a path trail. An
  indented tree spends most of a narrow screen on whitespace.
- [~] Settings: Dropbox link status, pull-with-progress, run the engine,
  system notifications. The desktop's appearance, layout and profile tabs
  are deliberately absent - they describe a window. Still to do: the
  conflict log, which needs the merge wired to real records first.
- [x] In-app quick-add: an add field on the day view and on each list.
- [~] Engine scheduling: runs on foreground/resume and at midnight while
  open. A phone sleeps most of the day, so "on launch" alone would leave a
  day's recurring tasks unmade. Background runs via WorkManager are still
  to do.

**Deliverable:** installable Android build a real user (you) can run
against your actual vault day-to-day for task/journal/notes reading and
task/journal editing, side by side with the desktop app, without corrupting
shared state.

### Push (landed 2026-09-08)

`src-tauri/src/sync_push.rs` sends this device's changes back. The pull's
manifest records each file's revision *and* a hash of what arrived, so a
file whose hash still matches was not touched here and costs no request;
one that differs goes up guarded by the revision it was based on. Dropbox
rejects the write if the remote moved since - the optimistic concurrency
that decided the API backend over a filesystem one - and a rejection is
reported, never overwritten: the other device's edit is not this device's
to discard.

Deletions are deliberately *not* propagated yet. A file missing locally is
indistinguishable from one this device never pulled (a failed fetch, an
interrupted pull), and guessing wrong deletes a note everywhere. That
needs the tombstone half of the merge design first.

## Phase 3 — Sync robustness & conflict UX

Goal: move from "works when I test it" to "safe under real concurrent use."

- [x] Conflict log UI: the Settings tab lists what each pass decided —
  file, field, kept value and dropped value with the device behind each —
  from `sync_conflicts_list`, clearable. Not a debug dump: a row names the
  task or list it was in, since "title" alone is every task in the vault.
- [x] API backend: `rev`-guarded writes are the conflict signal, and a
  pass merges *before* writing rather than after being rejected — the
  incoming half of `sync_cycle.rs` runs the §3 merge over anything both
  ends moved, so the upload that follows is already the merged result. A
  write still rejected after that (the server moved between the listing
  and the upload) is reported and reconciled by the next pass.
- ~~Filesystem backend: `(conflicted copy)` collisions~~ — moot, Spike A.
- Background sync scheduling hardened against OS battery/Doze restrictions;
  explicit manual "sync now" as a user-triggered escape hatch.
- Offline queuing: edits made with no connectivity apply locally immediately
  and reconcile once the sync target is reachable again.
- Dogfood period: run desktop + mobile against the same real vault
  concurrently for a stretch (your own daily use is the test plan here),
  ideally exercising both backends if both shipped, and track every
  conflict-log entry as a bug or an expected result.

**Deliverable:** confidence, backed by a dogfood log, that concurrent
desktop+mobile editing doesn't lose data on either backend — the core
promise of REQUIREMENTS.md §1.

## Phase 4 — Security hardening (at-rest)

- Local cache (`app.db`, cached JSONL) encrypted via Android Keystore
  (e.g. SQLCipher with a keystore-backed key, or `EncryptedFile`/
  `EncryptedSharedPreferences` for anything outside the DB).
- API backend: use the `App folder` permission type — Dropbox enforces the
  scoping itself, nothing extra to build here.
- Filesystem backend (if shipped): no such enforcement is available, so
  mitigation stays a documented setup step (vault lives in its own dedicated
  Dropbox subfolder) plus the vault-linking screen nudging toward that layout
  rather than pointing at a Dropbox root. Worth surfacing in the UI as a real
  difference between the two backends, not just a README note.

**Deliverable:** a phone-loss or Dropbox-account-compromise scenario doesn't
hand over a readable vault.

## Phase 5 — Parity expansion (P1/P2 desktop features)

Work through the rest of REQUIREMENTS.md §6 roughly in priority order:

- Reminders: read-only summary → CRUD.
- Notes: editing, wiki-links, search, backlinks, trash.
- Calendar: browse only.
- History/Review: view-only.
- Task color/priority, drag-to-reorder.
- Comment-preserving YAML splice for Scheduled/Birthdays/Recurring edits
  from mobile (upgrades the P0 CRUD from Phase 2 to match desktop's
  comment-preserving behavior).
- Share-sheet capture (P3), as a second on-ramp alongside Phase 2's
  in-app quick-add.
- Settings: appearance, layout, profiles.

This phase is naturally sliceable — ship increments rather than batching
all of §6 into one release.

**No iOS phase.** Android is the only target — REQUIREMENTS.md and this
roadmap both discuss Tauri 2's iOS support as a capability of the chosen
stack, not a commitment; nothing here is planned or sequenced for iOS. If
that changes later, most of Phase 0's Spike B (Rust core cross-compilation)
and Phase 1's `SyncProvider`/merge logic carries over largely unchanged —
only the filesystem backend's iOS feasibility (Files app + Dropbox
extension, REQUIREMENTS.md §5-A) would need its own spike from scratch.

---

## Resolved before kickoff

- **Desktop-side changes:** approved to modify the shared JSONL schema
  directly as part of Phase 1, not gated behind a separate coordination
  cycle.
- **Default sync backend:** ~~Filesystem folder is the default~~ — Spike A
  failed (2026-09-08), so this resolved as planned: Filesystem is dropped
  from the picker entirely and Dropbox API is the sole option, no toggle.

## Open items this roadmap does NOT resolve

- ~~Dual-backend doubles part of the ongoing test matrix~~ — moot: Spike A
  failed, so there's only ever one backend to build/test/maintain for v1.
- ~~Access-type choice for the Dropbox app registration~~ — **resolved
  2026-09-08: App folder.** Consequence: the vault the Android app links to
  must live under `Apps/Hypomnema/` in Dropbox — either move/re-point the
  existing desktop vault there, or run a second vault under that path for
  mobile testing. Worth deciding before Phase 2's vault-linking screen
  ships, since it changes the setup instructions shown there.

## Suggested sequencing note

No calendar estimate is attached above since pace depends on hours/week
available — happy to convert this into dated milestones if you want to share
a rough time budget (e.g., solo/part-time vs. dedicated full-time stretch).
