# Name and logo

The GPL covers Hypomnema's code. It does not cover the name **Hypomnema** or its logo (the dog-eared H tile in `src-tauri/icons/`, `app-icon.png` and `src/components/AppLogo.tsx`): both identify the official app published from this repository by its maintainer, Siarhei Zverau.

## What you may do without asking

- Say that your work is based on, works with or is a fork of Hypomnema, in plain text.
- Use the name and logo to talk about the official app - in articles, reviews, tutorials, packaging of the unmodified official release.
- Build the app from unmodified source for yourself.

## What needs a different name and logo

A modified version you distribute - a fork, a repackaged build in any app store, a build with changes of your own - must use its own name and its own icon, and must not suggest that it is the official app or endorsed by its maintainer. Keep the copyright notices and the license as the GPL requires; replace the name and icon in the visible places (the window and app title, the store listing, the installer, the launcher icon, About).

In practice: change `productName` and `identifier` in `src-tauri/tauri.conf.json` (and the Android application id the build derives from it), the icons in `src-tauri/icons/`, and the wordmark in `src/components/AppLogo.tsx`.

## Questions

For anything not covered here, write to publius.it@gmail.com.
