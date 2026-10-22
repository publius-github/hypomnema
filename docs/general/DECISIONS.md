# Decisions

What Hypomnema deliberately does not do, and why. An entry is removed once its reasoning no longer holds.

- **No accounts of our own; sync is the user's Google Drive, optional.**
  The vault is a plain folder and the app works with no network and no
  sign-in. Desktop and phone sync through one engine (`sync_cycle.rs`)
  against the hidden `appDataFolder` of the user's own Google Drive (scope
  `drive.appdata` - the app sees nothing else there): OAuth to the user's
  own Drive, no server of ours, and signing out leaves the vault where it
  is. **No end-to-end encryption:** Google can technically read the files
  in the app folder. The disposable-DB rebuild (`state_export.rs`), the
  mirror's three-way merge (`tasks_mirror.rs`) and the record merge
  (`sync_state.rs`) are what make that sync safe. Pointing an external
  tool (Syncthing, OneDrive) at the folder instead still works, but not
  together with Google sync - Settings > Sync warns about a vault inside
  such a folder.
- **No vault encryption.** Journal entries and notes are plain Markdown
  files on every target, and they stay that way: the desktop reads them
  directly and sync moves them as-is, so encrypting one device's copy
  would break that device, and encrypting what goes up would leave the
  desktop unable to read its own vault. Real end-to-end encryption is a
  whole-product decision (both clients, key distribution, losing the key
  means losing the vault), not a hardening step. At-rest protection is the
  OS's: disk encryption on the desktop, app-private storage under
  file-based encryption on Android. The one secret, the desktop's Google
  refresh token, sits in Windows Credential Manager (`google_link.rs`);
  the app-level passphrase lock (`secret_store.rs`) only covers the
  token file of other desktops and older builds, with no UI to turn it
  on; the phone stores no token (Play services holds the grant).
- **One vault at a time, one app instance.** `vault-path.txt` is a single
  pointer in the OS app-config dir; there's no multi-vault switcher or
  concept of multiple vaults open at once. Matches the single-user usage
  this app is built for.
- **No multi-user / collaboration.** One user with a desktop and a phone is
  the normal case, and `sync_cycle.rs` merges what both ends wrote (per
  record for the state snapshot, line-wise for text, a `(conflicted copy)`
  beside the file when the same lines changed) with every decision it had
  to make kept in a readable log. What stays out of scope is *other
  people*: no sharing, no permissions, no presence.
- **Browser e2e against a fake core, no driver-based suite.** Playwright
  runs the real production bundle in Chromium with the Rust core replaced
  by an in-memory fake (`e2e/app/backend.ts`, answering through Tauri's
  `mockIPC`): navigation, task flows, dialogs, plus local pixel baselines
  of every screen. The core's logic stays with the Rust tests. A
  `tauri-driver` suite against the built app was weighed and left out: it
  needs a native driver per platform, a built installer per run and a
  real vault, for little the fake-core suite and the Rust tests do not
  already cover; the platform surfaces (tray, global capture hotkey,
  autoupdate on Windows; the Android build) get a manual smoke pass
  before a release instead.
- **Separate phone screens, shared everything else.** `src/mobile/` is
  its own set of screens (one column, bottom tabs, sheets instead of
  dialogs) over the same store, `lib/` and hooks as the desktop; making
  one component serve both layouts would trade a little duplication for
  a lot of branching. Measured with jscpd (min 8 lines / 60 tokens) the
  whole frontend duplicates 1.2% of its lines, the phone and desktop
  pairs a few dozen lines between them; where a pair did repeat logic it
  moved into a shared hook or component (`useDayAmbient`/`DayAmbientLines`).
- **UI is English-only.** No i18n layer. Single user, no localization need
  today; would need to be designed in rather than bolted on if that changes.
- **No binary attachments in tasks/journal/notes.** Everything is Markdown
  text plus wiki-links; the vault holds no blob/attachment store. Keeps the
  vault plain-text-diffable and sync-safe without worrying about large
  binaries going through sync.
