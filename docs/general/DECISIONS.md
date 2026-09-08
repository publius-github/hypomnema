# Decisions

Things this app deliberately does not do, and why - so a pause in development
doesn't lose the reasoning along with the context. Add an entry whenever a
feature request is turned down on purpose rather than just not gotten to yet;
one line of "why" is enough. Revisit an entry (and delete it) once the
reasoning no longer holds.

- **No accounts, and no sync the desktop depends on.** The vault is a plain
  folder; on the desktop "sync" still means pointing an external tool
  (Dropbox, Syncthing, OneDrive) at it, and that is the core
  privacy/ownership pitch (see README). *Narrowed 2026-09-08:* the Android
  build does talk to the Dropbox API directly, because Android gives no
  other app a live-synced folder to point at (`docs/android/SPIKES.md`,
  Spike A). It is still not an account system - OAuth to the user's own
  Dropbox, scoped to one app folder, optional, and a phone works with no
  network and no link at all. The disposable-DB rebuild
  (`state_export.rs`), the mirror's three-way merge (`tasks_mirror.rs`)
  and the record merge (`sync_state.rs`) exist to make external sync safe,
  not to substitute for a service.
- ~~**No rich mobile editing.**~~ *Reversed 2026-09-08 - the Android build
  is that companion app* (`docs/android/`). Tasks, lists, journal, notes
  and the rule YAMLs are all editable on the phone, through the same Rust
  core and the same commands the desktop uses. `tasks_mirror`'s `today.md`
  remains what it was - a read-only day sheet for a phone reaching a vault
  over a plain synced folder, which is still the arrangement for anything
  that is not the Android app.
- **No vault encryption.** Journal entries and notes are plain Markdown
  files on every target, and they stay that way: the desktop reads them
  directly and Dropbox moves them as-is, so encrypting one device's copy
  would break that device, and encrypting what goes up would leave the
  desktop unable to read its own vault. Real end-to-end encryption is a
  whole-product decision (both clients, key distribution, losing the key
  means losing the vault), not a hardening step. At-rest protection is the
  OS's: disk encryption on the desktop, app-private storage under
  file-based encryption on Android. *Narrowed 2026-09-08:* there **is** now
  an app-level lock, but only over the Dropbox refresh token
  (`secret_store.rs`) - a standing grant to the whole app folder is worth
  covering against a lost phone even when the notes beside it are not.
- **One vault at a time, one app instance.** `vault-path.txt` is a single
  pointer in the OS app-config dir; there's no multi-vault switcher or
  concept of multiple vaults open at once. Matches the single-user,
  single-machine-at-a-time usage this app is built for.
- **No multi-user / collaboration.** No accounts, no sharing, no second
  person to design for. *Narrowed 2026-09-08:* "don't have the vault open
  in two places at once" no longer holds and is no longer the answer - one
  user with a desktop and a phone is the normal case now, and
  `sync_cycle.rs` merges what both ends wrote (per record for the state
  snapshot, a `(conflicted copy)` beside the file for prose) with every
  decision it had to make kept in a readable log. What stays out of scope
  is *other people*: no sharing, no permissions, no presence.
- **No automated UI/e2e tests.** `tauri-driver` has no macOS support and
  the shipped build is Windows-only
  (NSIS via CI on a `v*` tag). Covered instead by Rust unit tests on the
  engine/business logic and Vitest component smoke tests with a mocked
  Tauri IPC; Windows-specific surfaces (tray, global capture hotkey,
  autoupdate) get a manual smoke pass before `scripts/windows/release.sh`, not automation.
- **UI is English-only.** No i18n layer. Single user, no localization need
  today; would need to be designed in rather than bolted on if that changes.
- **No binary attachments in tasks/journal/notes.** Everything is Markdown
  text plus wiki-links; the vault holds no blob/attachment store. Keeps the
  vault plain-text-diffable and sync-safe without worrying about large
  binaries in a Dropbox-synced folder.
