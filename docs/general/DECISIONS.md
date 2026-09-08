# Decisions

Things this app deliberately does not do, and why - so a pause in development
doesn't lose the reasoning along with the context. Add an entry whenever a
feature request is turned down on purpose rather than just not gotten to yet;
one line of "why" is enough. Revisit an entry (and delete it) once the
reasoning no longer holds.

- **No cloud sync / accounts.** The vault is a plain folder; "sync" means
  pointing an external tool (Dropbox, Syncthing, OneDrive) at it. This is the
  core privacy/ownership pitch (see README), not a missing feature - the
  disposable-DB rebuild (`state_export.rs`) and the three-way merge on the
  task mirror (`tasks_mirror.rs`) exist specifically to make that kind of
  external sync safe rather than to work around not having built-in sync.
- **No rich mobile editing.** `tasks_mirror`'s `today.md` is meant to be
  *read* on a phone over a synced folder; the two-way mirror files are
  editable in a pinch but assume a real text editor (raw `^id` keys, no
  validation). A native/companion mobile app is out of scope - the desktop
  app is the only place task/journal/notes editing is a first-class
  experience.
- **No vault encryption or app-level lock.** Journal entries and notes are
  plain Markdown files; there is no PIN/passphrase gate in the app. This
  relies entirely on OS-level disk encryption (BitLocker etc.) for
  at-rest protection. Worth revisiting if the vault ever routinely lives in
  a synced folder outside the user's own machines.
- **One vault at a time, one app instance.** `vault-path.txt` is a single
  pointer in the OS app-config dir; there's no multi-vault switcher or
  concept of multiple vaults open at once. Matches the single-user,
  single-machine-at-a-time usage this app is built for.
- **No multi-user / collaboration.** No accounts, no sharing, no concurrent
  editing story beyond "don't have the vault open in two places at once."
  A personal planner has no second user to design for.
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
