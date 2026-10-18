# Security policy

## Supported versions

Only the latest released version receives security fixes. The desktop app updates itself. The Android app is not published; if you build it yourself, rebuild from the latest release tag.

## Reporting a vulnerability

Please report security problems privately to **&lt;CONTACT EMAIL&gt;** rather than in a public issue. Include the app version, the platform (Windows / Android), what an attacker could do, and the steps to reproduce.

You can expect an acknowledgement within a week. Once a fix is released, the report is credited in the changelog unless you prefer otherwise.

## Scope

Of particular interest:

- anything that exposes the Google OAuth tokens (desktop `google.json`, sealed or not) or lets another app use the app's Drive access;
- the sync engine writing outside the vault, or deleting or overwriting user data it should not touch;
- the auto-updater accepting a release not signed with the project's key;
- script execution through note, journal or task content (Markdown rendering, wiki links).

Out of scope: attacks that need full control of an already unlocked device or user account, and data the user chooses to put in a shared or synced folder outside the app's control.

## Known limitations

- The vault is a plain folder and the app follows the operating system's view of it: a symbolic link or junction the user places inside the vault is followed like any other folder, including one that points outside it. The app itself never creates links, and paths arriving through Google Drive sync are checked to stay inside the vault (`sync_paths.rs`).
- On Windows the Google refresh token is a plain file, `google.json` in `%APPDATA%\com.hypomnema.app\`: any program running under your Windows account can read it, and so can whatever copies that folder (a roaming profile, a profile backup). It grants access to the app's Drive folder only - but that folder holds a copy of your vault. Signing out revokes it at Google and deletes the file; you can also revoke it at <https://myaccount.google.com/permissions>.
- The Google desktop OAuth client secret is compiled into the installer, as Google's installed-app flow expects; it identifies the app, it does not protect anything. The Drive scope is limited to the app's own hidden folder (`drive.appdata`).
