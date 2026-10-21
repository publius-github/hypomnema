# Using Hypomnema

Reference for everyday use. The overview and install steps are in the [README](../../README.md).

## Keyboard

Everything works without a mouse; About lists these shortcuts too.

| Keys | Action |
|---|---|
| Ctrl+Alt+Space (set in Settings) | Quick capture from anywhere in Windows |
| Ctrl+K | Search tasks, notes and the journal |
| Ctrl+1 … 9 | Open a section, in the left bar's order |
| Ctrl+= / Ctrl+− | Larger / smaller text (Base font size) |
| Ctrl+0 | Default text size |
| Esc | Close a dialog |
| Enter | On a task card: open the task |
| Space, arrows, Space | On a task card: pick it up, carry it to a day or list, drop it (Esc puts it back) |
| Alt+← / Alt+→ | Journal: previous / next day |
| Ctrl+F | Editor: find and replace |
| Alt+Z | Editor: word wrap |
| Ctrl+click | Editor: follow a `[[link]]` or a web address |
| Esc, then Tab | Editor: leave it with Tab (Tab indents otherwise; Ctrl+M switches this for good) |

## Sync

Signing in with Google syncs the vault between your devices through a hidden app-data folder in your own Drive (scope `drive.appdata`: the app cannot see any other file there). Notes and other text files edited on two devices are merged line by line; a real clash leaves a `(conflicted copy ...)` file next to the original, which Settings lets you compare and resolve. Paths listed in `.hypomnemasyncignore` stay on this device. A note or journal entry deleted on the other device lands in this vault's `.trash/` folder (kept 30 days) rather than vanishing. Keep every device on the same version: a device whose app is older than the one that last synced stops syncing with "update the app on this device" instead of merging data it cannot fully read. See the [privacy policy](https://publius-github.github.io/hypomnema/privacy.html) for exactly what goes where.

## Troubleshooting

- **Something failed or looks wrong.** About > *Copy diagnostics* puts the app version, the platform and the end of the diagnostic log on the clipboard; read it, remove anything private, and paste it into a [bug report](https://github.com/publius-github/hypomnema/issues/new?template=bug_report.yml) (About > *Report a problem* opens the form). The app never sends the log anywhere by itself.
- **Where the log is.** `%APPDATA%\com.hypomnema.app\hypomnema.log` on Windows (About > *Show log file*); it rotates to `hypomnema.log.1` at `log_max_kb` (app.yml, 1 MiB by default).
- **A task with no day and no list** goes to the quick-capture list (Inbox by default) rather than out of sight, for example when you clear the date of a task added under a day.
- **Tasks or lists went missing.** Settings > Data > Backups restores a daily database snapshot; the database being replaced is copied aside first, so a restore can itself be undone. Before an app update changes the database format, a `before upgrade` snapshot is taken as well.
- **The vault will not open because of the database.** `.hypomnema/app.db` is a cache of `.hypomnema/state/`: a database the app cannot read is moved aside as `app.db.unreadable-<time>` and rebuilt from that snapshot on its own. To force a rebuild, close the app and delete `app.db` (with its `-wal`/`-shm` files).
- **A config edit broke something.** The same list restores the copies of config files the app took before rewriting them.
- **A `(conflicted copy ...)` file appeared.** Two devices changed the same lines before syncing; Settings > Sync shows both versions side by side and keeps the one you pick.
- **The window went blank or shows "Something went wrong".** Press Reload; your data lives in the app core and the vault, not in the window.
