# Changelog

Every version of Hypomnema, newest first. Versions before 1.0 are development builds; history before 0.56.0 lives in the git log.

## 0.103.0 - 2026-10-16

Task rules sync between devices: retention, catch-up window, cron-by-day, done-list cleanup at rollover, priority overdue, the cadence bucket thresholds, the quick-capture list and the completion-rate inputs move from the per-device app.yml into .hypomnema/config/shared.yml, which syncs like colors.yml - the engine runs on every device, and different rules on two devices would clean up and generate differently. They keep their Settings controls. On first open a device whose app.yml holds non-default values for them writes those into shared.yml; one at the defaults waits for the file to sync in. shared.yml is editable in Notes > Config. Phone settings trimmed to match the desktop: text size is fixed at 16px, Appearance and Tasks & engine merge into one General panel (theme, done display, capture list, notifications, retention, catch-up, cron time), and the snooze length, the engine-run button and the sync timings and guard leave the phone's Settings (still in app.yml)

## 0.102.0 - 2026-10-16

Settings made short for publishing: from 86 controls on 9 tabs to 44 on 6 (General, Tasks, Recurring & calendar, Capture & alerts, Data, Sync). Fine-tuning keeps its defaults and moves to app.yml - column spacing and plates, opacities, chip size, done-hold and undo timings, snooze and toast lengths, sync interval/debounce/focus/quit/guard, mirror ids/agenda/today days, the streak strip - and app.yml is now editable in Notes > Config next to colors.yml; the bottom of Settings links both. Removed: the invisible gap band and its four knobs (breaks are plain space), the database snapshot switch (always on - sync depends on it), settings profiles. Merged: weekday + [EVERYDAY] markers into one switch, the rate chip and its alert-only switch into Off / Below threshold / Always, bold category headers into category headers, tray icon + close to tray into Keep running in the tray, list and list-task sorting into one; the four fold-by-default switches are gone - a fold clicked on a plate is now remembered across restarts. An app.yml from an older version is rewritten once without colors and retired fields

## 0.101.0 - 2026-10-16

The color scheme syncs: every color setting moves out of the per-device settings/app.yml into .hypomnema/config/colors.yml, which travels with the vault like the other user configs, so the phone shows the same colors as the desktop. A missing colors.yml means the default colors; colors left in an old app.yml are ignored. colors.yml is edited in Notes > Config (it opens on the colors in use) or written by a profile apply, and is backed up before every rewrite. The phone's Settings drop the cadence color pickers and the screen-edge inset fields (still settable in app.yml)

## 0.100.5 - 2026-10-16

Journal: the entry header gets the same day stepper as the Dashboard and Days headers - ‹ ›, the date picker and Back to today when away from it - and the sidebar drops its own Today button and date field, keeping only the list of entries

## 0.100.4 - 2026-10-16

One ‹ / › arrow button for stepping a view by a period - the Dashboard and Days day grid, the Journal day, the Calendar and History month and the Review week now share the same look (the last three used < > before); the Notes editor header drops its "Ctrl/Cmd+click a link to open it" hint

## 0.100.3 - 2026-10-16

The page area always keeps room for its scrollbar, so the header controls (Days, + Task) stand in the same spot on Dashboard, Days and Lists whether or not the page scrolls

## 0.100.2 - 2026-10-16

All-lists index never opens a group view any more: with flat groups a group's row scrolls (Lists page) or pages (dashboard) to its first member list instead; the group view is entered from the group chip on a list header or a group tile

## 0.100.1 - 2026-10-16

All-lists index: a jump on the Lists page lands the column a little below the top edge, so its highlight ring is no longer cut off; top-level lists start at the left edge, under the groups' ▸ markers, which are a size larger, and group members hang one step past the group's name

## 0.100.0 - 2026-10-16

Notes: Markdown headings stay bold and colored but no longer grow - every line of a note is the text size. Alt+Z toggles word wrap in the editor (for the session, across notes): off, a long Tab-aligned table keeps its rows on one line and scrolls sideways. Page headers: the view controls on Dashboard, Days and Lists share one component with one spacing - the same gap between controls and before + Task; the Lists page's column count is called Lists, as on the dashboard; the dashboard's Days count moves to the right end, where the Days page has it

## 0.99.0 - 2026-10-16

Colors leave Settings: every color control is gone from the Settings page - the Appearance palette (accent, background, panels, borders, text tones) and the contrast floor, cadence and status-mark colors, category chip coloring, closed-section plate colors, gap fill, day header, reminder, weekly focus, weekday marker, rate alert and list date chip colors; they are still read from app.yml and profiles, edited by hand. New defaults from the owner's profile: weekly cadence amber #d8ac5f, category chip blue #5194e6, dropped mark #b76262, weekday marker violet #bb9dc8, Not done, dropped folded by default, the exact-date stripe kept inside lists, and a lighter dark-theme secondary text (#bfbfbf). The framed section-panel layout is removed (section_cards, section_gap, category_gap_bands): the flat list view is the only one. Section plates (DAILY, WEEKLY, DONE...) are bold. Breaks: three stripes still open the closed blocks, but between Postponed / Done, waiting / Done / Dropped there are now two

## 0.98.0 - 2026-10-16

Colors adapt to the theme: every object color - cadence plates and stripes, category/list/date chips, status marks, section rails, list and group dots, the day header, reminder, weekly focus and weekday marker tones - keeps its hue but is moved in lightness (OKLCH) just far enough to read on the current theme: lighter on dark panels, darker on light ones, judged against the actual surface colors. The floor is a new Settings > Appearance option, Color contrast floor (Off / 3:1 / 4.5:1 WCAG AA - default / 7:1 AAA); marks stop at 3:1, and a color that already reads is left exactly as picked

## 0.97.0 - 2026-10-16

New default color palette, tuned for both themes: every object color is picked in OKLCH at the lightness that reads best on dark and light panels alike (about 3.7-4.1:1 on all four surfaces). Cadences: exact coral #df4645, daily teal #0a8c81, weekly blue #2f7dda, monthly violet #8b68db, yearly pink #cb5092, General neutral; closed plates and status marks: postponed amber #a97205, waiting cyan #0a88a5, done green #079042, dropped neutral gray #797d85; category chip steel #6b7f98 (alternate pair lime #5a8a05 / orange #c95e05), habit-rate alert orange #c95e05; the varied chip palette is twelve hues on the same rule. Main text, weekday marker and the list date chip follow the theme by default

## 0.96.7 - 2026-10-16

New defaults: editor line numbers on, dashboard split 75, UI and editor font size 16, and Postponed, waiting and dropped sections start unfolded (Done still folds); the color defaults set here were replaced in 0.97.0

## 0.96.6 - 2026-10-15

Settings regrouped so related settings sit together: Appearance keeps only the theme, one palette list (incl. main and secondary text) and fonts; Views is now Pages - Left bar, Dashboard (split, weekly focus color), Lists page, History (streak marks); Task cards splits into Card colors, Chips & categories (with the category block headers), Weekday markers (with their color) and Completion rate; Columns opens with the column layout (sections and separators, moved from Views) and a Postponed and done tasks group holding the done display, sort, hold-before-move, plate colors, fold defaults and closed-row opacity, and Day columns gain the day header and reminder colors; Data gets Journal & notes (editor line numbers, stamps, day tasks, template) and Done tasks cleanup (retention, clear done list tasks, delete-done, archived lists)

## 0.96.5 - 2026-10-15

Page layout is set on the pages, not in Settings: the Dashboard header gains a Lists column count and the Groups Folded/Flat switch beside its Days count, and Settings > Views drops Day columns on the Days page, Grid columns on the Lists page, the dashboard's list-column count and the grouped-lists switch (all already on their page headers); the Settings content width setting is gone - the page is exactly as wide as its tab strip on one line

## 0.96.4 - 2026-10-15

About tells the truth about the network: nothing goes to the developer, Google Drive sync goes through your own Drive, the desktop app checks GitHub for updates; it also carries the copyright line, the GPL no-warranty notice and the full third-party license texts (THIRD_PARTY_LICENSES.txt, generated by scripts/general/third-party-licenses.mjs and compiled in); the repo gains an English README, a static website with a privacy policy (site/), SECURITY.md and this changelog

## 0.96.3 - 2026-10-15

Desktop rail: Sync also runs a Google Drive pass after the engine when an account is signed in, and shows the last pass's day and time under the button (red, with the error in the tooltip, when it failed; scheduler passes update it too); the theme toggle leaves the rail - it stays in Settings > Appearance

## 0.96.2 - 2026-10-15

Phone Settings gets an About panel: the desktop dialog's text, logo and version (shared AboutContent), the version shown on its index row

## 0.96.1 - 2026-10-15

Phone polish: Day and Journal share one header (DayHeader: left action, the day's name over its date between drawn chevrons, the label as the date picker, Today only away from today), bigger drawn icons for search/menu/arrows; task-row PRIORITY/OVERDUE/Rate badges stack in a fixed column reserved on the right instead of wrapping under some titles; the Lists index shows groups open in place with their lists indented under a ▾/▸ fold (remembered per phone) and a ⋯ into the group screen; the hardware back button goes through Tauri's back-button listener, registered only while a step is left to undo, and steps back to Day on today before the press that closes the app

## 0.96.0 - 2026-10-15

Conflicts resolved in place, smarter reminders, a richer Journal: the conflict list's "Compare and resolve" shows a file against its conflicted copy line by line and keeps one (the other goes to .trash/), the Notes tree badges conflicted copies; reminders can fire N minutes ahead, toasts last a set time and leave when their task is checked off, and a fresh start folds already-passed reminders into one summary instead of a burst; the desktop Journal steps days with ‹ › and Alt+←/→, names the weekday, folds its index by year with month headings, shows "On this day" entries from earlier years and the day's tasks under the header; History's daily streaks carry a strip of their newest instances

## 0.95.1 - 2026-10-15

Notes edited on both devices merge again: the sync's line merge and the editors' save merge take a note's Created / Last edited header off and merge it on its own (earliest Created, latest Last edited) instead of reading two devices' different Last edited minutes as a same-line clash; saves and the sync's apply of a download share a file lock across read-merge-write; every editor (desktop and phone Journal/Notes) queues its saves one at a time, marks itself saved only when nothing was typed after the landing save (a stale "Saved" let the watcher reload over fresh typing), and keeps a failed save for the next flush with a "Not saved · Retry" indicator; conflict log times in local time; note saves poke the sync scheduler

## 0.95.0 - 2026-10-15

Editor saves merge instead of overwriting: journal_save/kb_write take the text the editor started from and three-way merge with what changed on disk under it (a sync pass bringing the other device's edit), same-line clashes keep the disk version as a "conflicted copy edited elsewhere" logged under "to review"; all four editors settle onto the merged text and reread on an external change when nothing is unsaved. Sync writes are atomic (write_atomic_bytes, fsync before rename), .trash/ and staging files never travel, .hypomnemasyncignore excludes paths of the user's choosing, CRLF/LF compared alike in line merges, merge stamps in milliseconds (migration 020) compared as instants with a device-id tie-break. Notes: a folder can no longer be pasted into itself, .hypomnema/ outside config/ cannot be deleted/moved from the tree, dotted folder renames keep the typed name, rename/move save the pending edit and follow the open note

## 0.94.0 - 2026-10-15

Sync without hand-merging: text files (md/txt/yml) edited on both devices merge line by line against a kept base (diffy three-way merge), only same-line edits leave a conflicted copy, now named phone/desktop and never overwriting an earlier one; conflict log names devices and puts open copies first as "to review" (shared ConflictList); the phone syncs a few seconds after an edit (scheduler's after-edit trigger on mobile, debounce default 15 s, set in phone Settings)

## 0.93.2 - 2026-10-14

Phone Day screen: header on a three-column grid with the date as a plain label over a hidden date picker and Today only away from today; task rows tighter, with PRIORITY/OVERDUE/rate badges small and on the title's own line

## 0.93.1 - 2026-10-14

Sync: a config file still holding its seeded sample gives way to the other device's version instead of becoming a conflicted copy

## 0.93.0 - 2026-10-14

Sync-safe row ids and background sync on Android: tasks/lists/groups get ids two devices cannot both mint (ids.rs - generated tasks derived from (rule_key, period_key) and stamped untouched, lists/groups from their name, the rest random), carry-over collapses (rule, period) twins keeping the acted-on copy, restore folds same-name lists/groups, an engine pass follows a merging sync; Android keeps a pass alive through a dataSync foreground service

## 0.92.0 - 2026-10-14

Remove Dropbox sync: sync_dropbox, sync_dropbox_oauth and dropbox_link gone (PKCE + OauthTransport kept in oauth.rs), dropbox_* commands and bindings, DropboxLink; sync_now is Google only and returns SyncSummary; the phone's passphrase lock reduced to removing a leftover one; DECISIONS/ARCHITECTURE/DOGFOOD on Google Drive

## 0.91.0 - 2026-10-14

Android Google sign-in: tauri-plugin-google-auth (Play services AuthorizationClient, Kotlin in a tracked plugin source set), token per pass with clear-on-401, google_pull_vault for first run, phone onboarding and Settings > Sync on Google, sync_now from the phone's triggers, Error::SignInExpired

## 0.90.0 - 2026-10-14

Desktop Google sign-in (PKCE loopback, tokens via secret_store) and Drive sync: sync_now, per-account sync space, scheduler (start, interval, after edits, on focus, on quit), Settings > Sync tab with conflict log and double-sync warning; build.ps1 picks up the client secret

## 0.89.0 - 2026-10-14

Google Drive sync provider (appDataFolder, headRevisionId markers, post-write revision check, duplicate-name handling); sync cycle merges duplicates and treats unlisted manifest paths as remote deletions

## 0.88.1 - 2026-10-13

Sync spaces (per remote/account manifest + merge base), mass-deletion guard (sync_mass_delete_guard_percent, RemoteWiped, Upload this vault again), provider-generic run_pass - groundwork for Google Drive sync

## 0.88.0 - 2026-10-13

Defaults follow the Mine2 profile; per-section fold defaults for Postponed / Done, waiting / Done / Dropped; bold category header option; a picked weekday-marker color is no longer faded by its opacity

## 0.87.1 - 2026-10-13

Not done, dropped tasks get their own closed section after Done (slate plate, dropped_plate_color) instead of sharing Done

## 0.87.0 - 2026-10-13

Quieter columns: sections as framed panels with a cadence rail, category named once per block, closed sections fold, closed rows fade, Rate only when alerting; dropped mark color (red); done display separate by default

## 0.86.0 - 2026-10-13

Defaults: section plate height 100%, category chips alternate teal #0d9488 / orange #ea580c

## 0.85.0 - 2026-10-13

Phone mirrors the desktop columns: shared day/list section layout (plates, gap stripes, Priority, closed sections), TaskRow follows TaskCard (chips, badges, status cycle, subtasks, Drop)

## 0.84.0 - 2026-10-13

Closed section plates get their own colors in Card colors (Postponed rose, Done waiting teal, Done green); per-section cadence-stripe toggles and the plate micro-group removed

## 0.83.0 - 2026-10-13

List view is the only view: rows everywhere incl. Dashboard, fixed stripe gaps; card view, per-gap px and list-view/fill toggles removed; stripe look defaults 60/50/15/100/20

## 0.82.1 - 2026-10-13

Gap stripes: empty space spread evenly, so row-to-band and band-to-band distances match

## 0.82.0 - 2026-10-13

List view gaps become fixed glow stripes: 1 per category, 2 per section, 3 before closed sections (list_gap_stripe)

## 0.81.0 - 2026-10-13

Gap fill: max thickness keeps tall gaps to a thin centered band, opacity setting

## 0.80.0 - 2026-10-13

List view gaps: a soft-edged color band replaces the hatch (gap_fill_* settings)

## 0.79.1 - 2026-10-13

Gap hatch goes single-direction diagonal; Markdown editor keeps only the VS Code palette

## 0.79.0 - 2026-10-13

Shared List view look: hatch color/spacing/inset, plate text scales with plate height; per-section cadence stripes; VS Code is the only theme palette

## 0.78.1 - 2026-10-12

List view: the column wears the card fill, rows go transparent again

## 0.78.0 - 2026-10-12

List view on the Lists page, cross-hatched block and section gaps, taller plates, rows keep the card fill

## 0.77.0 - 2026-10-12

Days List view moves to Settings, hatched category gaps, A-Z Postponed/Done, varied chips skip cadence hues

## 0.76.1 - 2026-10-12

Days List view frames each block: first row gets the top hairline too

## 0.76.0 - 2026-10-12

Days page List view: tasks as hairline-split rows instead of cards

## 0.75.0 - 2026-09-18

Fine-tuning hides behind a checkbox that ticks itself

## 0.74.1 - 2026-09-18

Profile scope folded by tab, no duplicate today-only switches

## 0.74.0 - 2026-09-18

Settings regrouped by what they configure, with a search box

## 0.73.15 - 2026-09-18

Lazy editor chunk, in-app dialogs on the phone, KB watcher ignores .hypomnema, dependabot

## 0.73.14 - 2026-09-18

Tests for the store's optimistic paths, the read-only projections and the reminders overview

## 0.73.13 - 2026-09-18

Desktop and phone share the Review data, search and task-draft logic through hooks

## 0.73.12 - 2026-09-18

Commands reject with {kind, message}; no rejection is swallowed without a trace

## 0.73.11 - 2026-09-18

Typed invoke: every IPC call is checked against a Commands map

## 0.73.10 - 2026-09-18

Review and Calendar refetch once per change, not twice

## 0.73.9 - 2026-09-18

lib.rs splits into command modules, state and watchers; mutexes recover from poisoning

## 0.73.8 - 2026-09-18

Mirror and state exports move off the command path onto a debounced worker

## 0.73.7 - 2026-09-18

Deep bug sweep: 38 fixes across engine, sync, mirror and both frontends

## 0.73.6 - 2026-09-18

Six bug fixes: schedule-block times, the review's extra day, dropped tasks on the phone

## 0.73.5 - 2026-09-18

The dashboard's day count moves from Settings to a Days dropdown in its own header

## 0.73.4 - 2026-09-16

Icon gets a pure-white bold meander and a bright rim so it holds up on a dark taskbar

## 0.73.3 - 2026-09-16

A second launch brings the running window back instead of starting another copy

## 0.73.2 - 2026-09-16

About shows the logo with its HYPOMNEMA / The Meander Habit label; root app-icon.png matches the new mark

## 0.73.1 - 2026-09-16

One app icon on desktop and Android: the meander H on a slate tile

## 0.73.0 - 2026-09-16

Recurring tasks wear a completion Rate chip that turns loud below a threshold

## 0.72.3 - 2026-09-16

Enter in the task dialog's title saves and closes it

## 0.72.2 - 2026-09-12

Done, waiting mark defaults to a muted blue

## 0.72.1 - 2026-09-12

Waiting section reads DONE, WAITING, and its mark takes a calm teal of its own

## 0.72.0 - 2026-09-12

Notes carry Created and Last edited lines, and tasks gain Waiting and Dropped statuses

## 0.71.1 - 2026-09-09

All-lists index lines its names up on one axis

## 0.71.0 - 2026-09-09

Groups switch moves into the Lists header, and the All-lists index keeps the groups under flat

## 0.70.0 - 2026-09-09

Groups fill from inside, flat list panels, hideable sections, and safe-area fixes

## 0.69.0 - 2026-09-09

Phone settings become a panel index, Dropbox linking and unlink from Settings, switch and blur-commit controls, SVG tab icons, inline note forms

## 0.68.4 - 2026-09-09

Day gets a persistent add-task row, Notes banner adopts the vault, done-display in phone settings, back-button re-arm fix

## 0.68.3 - 2026-09-09

Group view: highlight the clicked list, rail index inside the group, new lists join it, mouse back leaves it

## 0.68.2 - 2026-09-09

Groups open as a full panel view; the phone's back button steps back; auto lists off the phone index

## 0.68.0 - 2026-09-09

Checklist lists that keep their checked items, and list groups on the panel

## 0.66.0 - 2026-09-09

Bring the phone up to desktop parity: search, undo, day context, review, config editing

## 0.65.0 - 2026-09-09

Give the phone's tasks the signals the desktop's have

## 0.64.5 - 2026-09-09

Notes find the vault on their own; the welcome screen keeps its margins

## 0.64.4 - 2026-09-08

Ask Android for file access, and give the chooser the whole screen

## 0.64.3 - 2026-09-08

Browse to a folder instead of filling in a form

## 0.64.2 - 2026-09-08

Keep the phone layout out from under the system bars

## 0.64.1 - 2026-09-08

Say at the top of the roadmap where it actually stands

## 0.64.0 - 2026-09-08

The rest of the desktop, in a shape a phone can hold

## 0.63.0 - 2026-09-08

Encrypt the one secret worth encrypting, and sign real releases

## 0.62.1 - 2026-09-08

Say what the phone is holding while it has no signal

## 0.62.0 - 2026-09-08

Edit a task in full on the phone, and sync without asking

## 0.61.0 - 2026-09-08

Merge two devices' edits instead of reporting them

## 0.60.0 - 2026-09-08

A phone can keep its own vault, with no Dropbox

## 0.59.0 - 2026-09-08

Push local changes back to Dropbox

## 0.58.0 - 2026-09-08

Phone UI: day, lists, journal, notes, settings

## 0.57.1 - 2026-09-08

Retry transient network failures in the Dropbox transport

## 0.57.0 - 2026-09-08

The phone opens the pulled vault and runs the app against it

## 0.56.2 - 2026-09-08

Escape non-ASCII in the Dropbox-API-Arg header

## 0.56.1 - 2026-09-08

Keep the PKCE verifier across an app restart; app-folder marker

## 0.56.0 - 2026-09-08

Dropbox sync core and the Android vault-linking screen
