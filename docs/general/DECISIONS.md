# Decisions

Things this app deliberately does not do, and why - so a pause in development
doesn't lose the reasoning along with the context. Add an entry whenever a
feature request is turned down on purpose rather than just not gotten to yet;
one line of "why" is enough. Revisit an entry (and delete it) once the
reasoning no longer holds.

- **No accounts of our own; sync is the user's Google Drive, optional.**
  The vault is a plain folder and the app works with no network and no
  sign-in. *Changed 2026-10-14:* both the desktop and the phone now sync
  through one engine (`sync_cycle.rs`) against the hidden `appDataFolder`
  of the user's own Google Drive (scope `drive.appdata` - the app sees
  nothing else there), replacing the phone-only Dropbox API link and the
  desktop's "point Dropbox at the folder" arrangement, which could not
  merge and lost phone edits while the desktop was running. Still not an
  account system: OAuth to the user's own Drive, no server of ours, and
  signing out leaves the vault where it is. **No end-to-end encryption
  yet:** Google can technically read the files in the app folder; sealing
  them with a passphrase both devices know is the optional last phase of
  the plan. The disposable-DB rebuild (`state_export.rs`), the mirror's
  three-way merge (`tasks_mirror.rs`) and the record merge
  (`sync_state.rs`) are what make that sync safe. Pointing an external
  tool (Syncthing, OneDrive) at the folder instead still works, but not
  together with Google sync - Settings > Sync warns about a vault inside
  such a folder.
- ~~**No rich mobile editing.**~~ *Reversed 2026-09-08 - the Android build
  is that companion app* (`docs/android/`). Tasks, lists, journal, notes
  and the rule YAMLs are all editable on the phone, through the same Rust
  core and the same commands the desktop uses. `tasks_mirror`'s `today.md`
  remains what it was - a read-only day sheet for a phone reaching a vault
  over a plain synced folder, which is still the arrangement for anything
  that is not the Android app.
- **No vault encryption.** Journal entries and notes are plain Markdown
  files on every target, and they stay that way: the desktop reads them
  directly and sync moves them as-is, so encrypting one device's copy
  would break that device, and encrypting what goes up would leave the
  desktop unable to read its own vault. Real end-to-end encryption is a
  whole-product decision (both clients, key distribution, losing the key
  means losing the vault), not a hardening step. At-rest protection is the
  OS's: disk encryption on the desktop, app-private storage under
  file-based encryption on Android. *Narrowed 2026-09-08:* there **is** an
  app-level lock (`secret_store.rs`), but only over a stored refresh token.
  *2026-10-14:* the phone no longer stores one (Play services holds the
  Google grant), so the phone UI only offers to remove a passphrase left
  from the Dropbox days; the mechanism still covers the desktop's Google
  token, with no UI to turn it on there yet.
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
  binaries going through sync.
