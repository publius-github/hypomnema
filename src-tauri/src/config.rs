use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[ts(export, export_to = "../../src/bindings/")]
#[serde(default)]
pub struct AppConfig {
    #[ts(type = "\"dark\" | \"light\"")]
    pub theme: String,
    /// Individual chrome color overrides, hex; empty = the stylesheet's
    /// VS Code Dark+/Light+ palette.
    pub accent_color: String,
    pub surface_color: String,
    pub surface_alt_color: String,
    pub line_color: String,
    pub grid_columns: u32,
    #[ts(type = "\"inline\" | \"separate\"")]
    pub done_display: String,
    pub retention_days: u32,
    pub catchup_days: u32,
    /// Catch up recurring crons by calendar day: a firing counts as
    /// missed based on its date only, as if it fired at 23:59.
    pub cron_ignore_time: bool,
    pub kb_path: String,
    /// Order of the sections in the left tab bar.
    pub section_order: Vec<String>,
    /// Sections hidden from the left tab bar: someone who uses half the
    /// app should not carry the other half's icons. Settings can never
    /// be hidden - it is the way back.
    pub section_hidden: Vec<String>,
    /// Dashboard shows a single Today column instead of the week grid.
    pub dashboard_today_only: bool,
    /// How many list columns are visible at once in the dashboard list
    /// zone; the rest are paged with the arrows.
    pub list_columns: u32,
    /// Show line numbers in the Notes editor (config files always do).
    pub kb_line_numbers: bool,
    /// Markdown notes saved from the Notes editor carry a `Created:` and
    /// a `Last edited:` line at the top, kept up to date by the app.
    pub notes_timestamps: bool,
    /// The Journal shows the tasks of the entry's day (done and open)
    /// in a strip under its header.
    pub journal_day_tasks: bool,
    /// How many of a daily rule's newest instances the History's streak
    /// strip shows as done / not-done marks; 0 hides the strip.
    pub streak_strip_days: u32,
    /// Hide daily-cadence tasks on future day columns - they repeat
    /// every day anyway and only clutter the look-ahead.
    pub daily_tasks_today_only: bool,
    /// Percent of the dashboard height taken by the day grid (the rest
    /// is the list zone); adjusted by dragging the divider.
    pub dashboard_split: u32,
    /// How far ahead the Calendar projects not-yet-materialized firings,
    /// per rule cadence, plus scheduled dates and birthdays.
    pub calendar_daily_days: u32,
    pub calendar_weekly_weeks: u32,
    pub calendar_monthly_months: u32,
    pub calendar_yearly_years: u32,
    pub calendar_dates_years: u32,
    /// UI font family (empty = system default stack).
    pub ui_font: String,
    /// Editor font family for Journal/Notes/config files.
    pub editor_font: String,
    /// Editor font size (Journal/Notes/config files) on the same scale
    /// as ui_font_size: equal values render the editor text at the same
    /// visible size as the app's main text (which is 87.5% of the base).
    pub editor_font_size: u32,
    /// Seconds a task just marked done/postponed stays in place before
    /// moving to its section, leaving room to fix a misclick (0 = move
    /// immediately). Only matters with done_display = separate.
    pub done_hold_seconds: u32,
    /// Seconds the Undo toast stays after deleting a task or archiving
    /// a list (0 = no toast, deletes apply without an undo offer).
    pub undo_toast_seconds: u32,
    /// Center the day headers on the dashboard grid.
    pub day_header_centered: bool,
    /// Color task cards by their rule cadence (the same color stripe a
    /// task gets from a manual color; a manual color wins).
    pub cadence_colors: bool,
    /// Stripe colors per cadence, hex.
    pub cadence_color_daily: String,
    pub cadence_color_weekly: String,
    pub cadence_color_monthly: String,
    pub cadence_color_yearly: String,
    /// Exact-date tasks (scheduled events and birthdays).
    pub cadence_color_exact: String,
    /// Category/list label chips on day cards.
    pub category_color: String,
    /// Text size of the chips that sit next to a task title (category,
    /// list, date) as a percent of that title: 100 = exactly the size
    /// of the text beside them. Applies on the cards and in the
    /// Calendar day list alike.
    pub chip_font_scale: u32,
    /// How a category chip is colored. "single" paints every category
    /// in `category_color`; "varied" gives each its own hue (a list
    /// keeps the color it already wears, any other name takes a palette
    /// hue from its own text); "alternate" walks the two colors below,
    /// category block by category block, straight through a column's
    /// cadence sections so the stripes never restart mid-column.
    #[ts(type = "\"single\" | \"varied\" | \"alternate\"")]
    pub category_color_mode: String,
    /// The two colors "alternate" mode walks between.
    pub category_color_a: String,
    pub category_color_b: String,
    /// Checked (done) checkboxes on task cards and subtasks.
    pub done_color: String,
    /// Done-but-waiting status marks: a muted blue, quieter than the
    /// info tone, so it reads as "done, not over yet".
    pub waiting_color: String,
    /// "Not done, dropped" status marks.
    pub dropped_color: String,
    /// Order of the cadence sections inside a day column.
    pub cadence_group_order: Vec<String>,
    /// Done subtasks sink to the bottom of their subtask list.
    pub subtasks_done_last: bool,
    /// How many backup copies to keep, both daily app.db snapshots and
    /// per-file config copies made before programmatic rewrites, under
    /// <vault>/backups/. 0 disables backups entirely.
    pub backup_keep: u32,
    /// OS notifications for timed tasks coming due (in-app toasts always
    /// show); useful when the window is minimized or behind others.
    pub notify_system: bool,
    /// Snooze length of the due-task toast's Snooze button, minutes:
    /// the reminder comes back after this long.
    pub notify_snooze_minutes: u32,
    /// How many minutes ahead of a timed task its reminder fires; 0 =
    /// at the task's time.
    pub notify_lead_minutes: u32,
    /// How long a due-task toast stays on screen before it hides itself,
    /// seconds.
    pub notify_toast_seconds: u32,
    /// Keep a full text snapshot of the database under
    /// <vault>/.hypomnema/state/ (tasks, lists, engine ledgers), so a
    /// vault synced without its .db rebuilds the database on open.
    pub state_snapshot: bool,
    /// Run sync passes on their own, without the user pressing Sync now
    /// (on the phone from the shell's triggers; on the desktop through
    /// `sync_scheduler.rs`), while signed in to Google. Off leaves sync entirely manual.
    pub sync_auto: bool,
    /// Minutes between automatic passes while the app is open. A phone
    /// on mobile data pays for every pass, and a vault that changes a few
    /// times an hour does not need one a minute.
    pub sync_interval_minutes: u32,
    /// Also sync when the app goes to the background (phone) or quits
    /// (desktop). On a phone this is the pass that matters most: Android
    /// freezes a backgrounded app, so without it the last thing done
    /// before locking the screen sits on the device until the app is
    /// opened again.
    pub sync_on_leave: bool,
    /// Seconds after the last local edit before a pass sends it, so a
    /// burst of edits goes up once - short, because the longer an edit
    /// waits here the likelier the other device edits the same thing.
    pub sync_debounce_seconds: u32,
    /// Desktop: sync when the main window comes to the front (at most
    /// once a minute), to bring down what the other device did meanwhile.
    pub sync_on_focus: bool,
    /// Stop a pass in which more than this share (percent) of the files
    /// this device had synced is gone from the remote at once, instead of
    /// deleting them here too: a wiped remote or a different account
    /// looks exactly like that (sync_cycle.rs). 100 turns the guard off.
    pub sync_mass_delete_guard_percent: u32,
    /// Minimum gap, in pixels, between the top of the phone layout and
    /// the top of the screen - a floor under `env(safe-area-inset-top)`.
    /// Android draws the app under the status bar (API 35+), and the
    /// WebView does not always report an inset for it; when it doesn't,
    /// this is the only thing keeping the header out from under the
    /// clock. Zero means "trust the reported inset".
    pub mobile_safe_area_top: u32,
    /// The same floor at the bottom, under the gesture bar or the three
    /// navigation buttons.
    pub mobile_safe_area_bottom: u32,
    /// Two-way Markdown mirror of the manual tasks under <vault>/tasks/
    /// (one file per list + scheduled.md) for bulk editing in any editor.
    pub tasks_mirror: bool,
    /// Mirror generated tasks (recurring, scheduled events, birthdays)
    /// into <vault>/tasks/agenda.md too: statuses sync back, added lines
    /// become manual tasks, deleted lines change nothing. The file-sync
    /// surface for a phone.
    pub tasks_mirror_agenda: bool,
    /// Write the trailing `^id` sync key on every mirrored line. Off
    /// keeps the files clean to read, at the price of identity: a line
    /// is then matched back to its task by title, so renaming a task in
    /// the file replaces it instead of editing it.
    pub tasks_mirror_ids: bool,
    /// Also write <vault>/tasks/today.md: a read-only, phone-readable
    /// day sheet (focus, reminders, schedule, overdue and today's tasks).
    /// Regenerated on every change; edits to it are never imported.
    pub tasks_mirror_today: bool,
    /// How many days today.md covers (1 = today only; each extra day
    /// adds its own section).
    pub tasks_mirror_today_days: u32,
    /// Show a [SAT#1]-style marker before recurring tasks whose cron
    /// pins concrete weekdays.
    pub cron_weekday_labels: bool,
    /// With cron_weekday_labels on, rules free on both day fields wear
    /// an [EVERYDAY] marker instead of going unlabeled.
    pub cron_everyday_label: bool,
    /// Recurring task cards wear a `Rate: 82%` chip: the share of the
    /// rule item's settled instances that were done.
    pub habit_rate_chip: bool,
    /// Show the rate chip only once it falls below its threshold.
    pub habit_rate_alert_only: bool,
    /// Default alert threshold, percent: below it the rate chip turns
    /// loud. A rule's own `threshold:` in recurring.yml wins over it.
    pub habit_rate_threshold: u32,
    /// How many of the newest settled instances the rate counts
    /// (0 = every one still in the database).
    pub habit_rate_window: u32,
    /// Settled instances needed before a rate is shown at all, so one
    /// early miss does not read as 0%.
    pub habit_rate_min_instances: u32,
    /// Color of the rate chip once it falls below its threshold.
    pub habit_rate_alert_color: String,
    /// Order the dashboard list columns alphabetically (favorites still
    /// come first); off = manual creation order.
    pub lists_sort_alpha: bool,
    /// Grid columns on the dedicated Lists page.
    pub lists_page_columns: u32,
    /// Lists page: stretch every list column to its grid row's height so
    /// the rows line up; off = each column takes its natural height.
    pub lists_page_align_rows: bool,
    /// Section plate height in the day and list columns, % of the
    /// plate's normal height (100..=400); the plate text scales with it.
    pub list_view_plate_scale: u32,
    /// Separator stripes between list rows: the band's color, hex
    /// (empty = the border color), and how soft its edges are - the
    /// share of each half of the band that fades out to nothing, %
    /// (0 = hard edges, 100 = solid only along its middle line).
    pub gap_fill_color: String,
    pub gap_fill_fade: u32,
    /// Empty space the band leaves above and below itself, % of the
    /// gap's height (0..=45), so it does not touch the rows' hairlines.
    pub gap_fill_inset: u32,
    /// Thickest the band gets, px (1..=64): a tall gap keeps a thin
    /// line-like band centered in it instead of a wide smudge.
    pub gap_fill_max_thickness: u32,
    /// Opacity of the band, % (0..=100).
    pub gap_fill_opacity: u32,
    /// Breaks between list rows come in fixed stripes: one stripe is
    /// this % of a single-line row's height (25..=150). A category break
    /// is one stripe, a section break two, the Postponed / Done,
    /// waiting / Done breaks three.
    pub list_gap_stripe: u32,
    /// Each column section is a framed panel with one continuous rail
    /// in its plate color down the left edge; the breaks between
    /// sections become plain space (`section_gap`) instead of stripes.
    pub section_cards: bool,
    /// Space between two section panels, px (0..=64).
    pub section_gap: u32,
    /// Category breaks inside a section draw the gap band; off = the
    /// break is empty space of the same height.
    pub category_gap_bands: bool,
    /// Hairlines between the rows of a column.
    pub row_hairlines: bool,
    /// A category block names its category once, as a small header over
    /// its rows, instead of a chip on every row.
    pub category_headers: bool,
    /// The category block header is bold, so it reads apart from the
    /// task titles under it.
    pub category_header_bold: bool,
    /// Section plates show how many tasks the section holds (done/total
    /// when closed tasks stay inline).
    pub section_plate_count: bool,
    /// Section plates stick to the top of the column while its rows
    /// scroll under them.
    pub section_plate_sticky: bool,
    /// Which closed sections start folded to their plate, one switch
    /// each; a click on any plate opens or folds it.
    pub fold_postponed: bool,
    pub fold_waiting: bool,
    pub fold_done: bool,
    pub fold_dropped: bool,
    /// Opacity of a closed (done, dropped) row's text and chips, %
    /// (20..=100); the status box keeps full strength.
    pub closed_row_opacity: u32,
    /// How grouped lists show in the list panels: `folded` = one tile per
    /// group with its lists behind a drill-in, `flat` = every list as its
    /// own column wearing its group's name as a chip.
    #[ts(type = "\"folded\" | \"flat\"")]
    pub lists_group_display: String,
    /// Day columns on the dedicated Days page (its own width, not tied
    /// to the dashboard grid). 0 is a legacy "follow the dashboard"
    /// value that sanitize resolves to grid_columns.
    pub days_page_columns: u32,
    /// Days page shows a single Today column (its own toggle, separate
    /// from dashboard_today_only).
    pub days_today_only: bool,
    /// Postponed / Done, waiting / Done / Dropped sections sort by category, then
    /// title, alphabetically; off = the same order as the open tasks.
    pub closed_sections_sort_alpha: bool,
    /// "varied" category chips skip palette hues close to the cadence
    /// colors, so a chip never matches the section plate it sits under.
    pub category_avoid_cadence_colors: bool,
    /// Order the tasks inside a list column alphabetically (timed tasks
    /// still pin to the top); off = manual drag order.
    pub list_tasks_sort_alpha: bool,
    /// How many lines a task title may take on a card in a list column
    /// before it is cut off (1 = the old single truncated line).
    pub list_task_lines: u32,
    /// Same, for the task rows inside the list dialog - the roomy view,
    /// so it defaults to more lines than the column.
    pub list_dialog_task_lines: u32,
    /// At day rollover, remove done backlog tasks from the list columns
    /// (the list is a working queue, not history).
    pub clear_done_list_tasks: bool,
    /// A priority task left unfinished past its day gets the overdue
    /// mark like any other task; off = priority carries over silently.
    pub priority_overdue: bool,
    /// Cadence bucket thresholds: a recurring rule counts as
    /// daily/weekly/monthly when it fires at least this many times over
    /// the next year (anything below monthly is yearly).
    pub cadence_daily_min_per_year: u32,
    pub cadence_weekly_min_per_year: u32,
    pub cadence_monthly_min_per_year: u32,
    /// Base UI font size in px (the browser default is 16; every text
    /// size in the app scales from it).
    pub ui_font_size: u32,
    /// Overrides for the two text tones, hex; empty = theme default.
    pub content_color: String,
    pub content_muted_color: String,
    /// Weekly focus line on top of the dashboard; empty = accent color.
    pub weekly_focus_color: String,
    /// Day reminders inside the day columns; empty = secondary tone.
    pub reminder_color: String,
    /// Weekday + date header of a day column, Today included; empty =
    /// main text color (and the accent on Today).
    pub day_header_color: String,
    /// The [SAT#1]-style weekday marker on task cards; empty =
    /// secondary tone.
    pub dow_label_color: String,
    /// Opacity of the weekday marker in its default muted tone, % (20..=100);
    /// a picked `dow_label_color` shows at full strength.
    pub dow_label_opacity: u32,
    /// Date chip of a dated list task inside its LIST column; empty =
    /// the exact-date cadence color. Day columns always use that color.
    pub list_date_chip_color: String,
    /// Plate color of the General cadence group; empty = the neutral
    /// plate style.
    pub cadence_color_general: String,
    /// Plate colors of the closed Postponed / Done, waiting / Done / Dropped /
    /// Not done, dropped blocks, hex - each its own hue, so they read
    /// apart from each other and from the cadence plates above them.
    pub postponed_plate_color: String,
    pub done_plate_color: String,
    pub waiting_plate_color: String,
    pub dropped_plate_color: String,
    /// The card stripe of a dated list task keeps the exact-date color
    /// inside its list too; off = the list color rules there. Day
    /// columns always use the exact-date color.
    pub list_exact_stripe: bool,
    /// Name of the list quick-captured tasks land in. The list is
    /// created on first capture (manual + favorite); empty falls back
    /// to "Inbox".
    pub capture_list: String,
    /// OS-global shortcut opening the quick-capture window (works while
    /// the app runs, even minimized to tray). Empty disables it; an
    /// unparseable or taken combination fails at registration and shows
    /// in the error banner, never blocks saving.
    pub capture_shortcut: String,
    /// Tray icon with Show / Quick capture / Quit.
    pub tray_icon: bool,
    /// Closing the main window hides it to the tray instead of quitting,
    /// keeping the capture shortcut and notifications alive. Forced off
    /// without the tray icon - a hidden window must stay reachable.
    pub close_to_tray: bool,
}

pub const CATEGORY_COLOR_MODES: &[&str] = &["single", "varied", "alternate"];

pub const SECTIONS: &[&str] = &[
    "dashboard",
    "lists",
    "days",
    "upcoming",
    "reminders",
    "calendar",
    "history",
    "review",
    "journal",
    "kb",
];

pub const CADENCE_GROUPS: &[&str] = &["exact", "general", "daily", "weekly", "monthly", "yearly"];

/// Fields a settings profile snapshots: the visual customization - the
/// look of the chrome, the cards and the columns - and nothing
/// behavioral. In Settings terms it is all of Appearance, the geometry
/// of Views, the colors and markers of Task cards, and the whole of
/// Columns; the Settings page marks each group with what a profile does
/// to it, reading this very list through `profile_scope`. Deliberately
/// out: paths and data handling (kb_path, mirror, snapshots, backups),
/// recurring/calendar parameters, notifications, capture/tray, the
/// view-mode toggles (*_today_only - flipped live on the pages, a
/// profile changing them would be surprising), section_order, the list
/// sorting rules, and the interaction timings (done_hold_seconds,
/// undo_toast_seconds - the undo window is a safety net, not a look).
/// Applying a profile resets every key here to its default and overlays
/// the profile's values; keys outside this list in a profile file are
/// ignored.
pub const PROFILE_KEYS: &[&str] = &[
    // theme and chrome
    "theme",
    "accent_color",
    "surface_color",
    "surface_alt_color",
    "line_color",
    // fonts
    "ui_font",
    "ui_font_size",
    "editor_font",
    "editor_font_size",
    // text colors
    "content_color",
    "content_muted_color",
    "weekly_focus_color",
    "reminder_color",
    "day_header_color",
    "dow_label_color",
    "dow_label_opacity",
    // task colors
    "cadence_colors",
    "cadence_color_daily",
    "cadence_color_weekly",
    "cadence_color_monthly",
    "cadence_color_yearly",
    "cadence_color_exact",
    "done_color",
    "waiting_color",
    "dropped_color",
    // category chips
    "category_color",
    "category_color_mode",
    "category_avoid_cadence_colors",
    "category_color_a",
    "category_color_b",
    "chip_font_scale",
    // section plates
    "cadence_color_general",
    "postponed_plate_color",
    "done_plate_color",
    "waiting_plate_color",
    "dropped_plate_color",
    // dated list tasks
    "list_date_chip_color",
    "list_exact_stripe",
    // editor look
    "kb_line_numbers",
    // layout
    "grid_columns",
    "list_columns",
    "dashboard_split",
    "days_page_columns",
    "lists_page_columns",
    "lists_page_align_rows",
    "list_view_plate_scale",
    "gap_fill_color",
    "gap_fill_fade",
    "gap_fill_inset",
    "gap_fill_max_thickness",
    "gap_fill_opacity",
    "list_gap_stripe",
    "section_cards",
    "section_gap",
    "category_gap_bands",
    "row_hairlines",
    "category_headers",
    "category_header_bold",
    "section_plate_count",
    "section_plate_sticky",
    "fold_postponed",
    "fold_waiting",
    "fold_done",
    "fold_dropped",
    "closed_row_opacity",
    "lists_group_display",
    "day_header_centered",
    "cadence_group_order",
    "done_display",
    "list_task_lines",
    "list_dialog_task_lines",
    // card markers
    "cron_weekday_labels",
    "cron_everyday_label",
    "habit_rate_chip",
    "habit_rate_alert_only",
    "habit_rate_alert_color",
];

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            accent_color: String::new(),
            surface_color: String::new(),
            surface_alt_color: String::new(),
            line_color: String::new(),
            grid_columns: 7,
            done_display: "separate".into(),
            retention_days: 0,
            catchup_days: 14,
            cron_ignore_time: true,
            kb_path: String::new(),
            section_order: SECTIONS.iter().map(|s| s.to_string()).collect(),
            section_hidden: Vec::new(),
            dashboard_today_only: false,
            list_columns: 4,
            kb_line_numbers: true,
            notes_timestamps: true,
            journal_day_tasks: true,
            streak_strip_days: 30,
            daily_tasks_today_only: false,
            dashboard_split: 75,
            calendar_daily_days: 3,
            calendar_weekly_weeks: 3,
            calendar_monthly_months: 3,
            calendar_yearly_years: 1,
            calendar_dates_years: 1,
            ui_font: String::new(),
            editor_font: "Consolas".into(),
            editor_font_size: 16,
            done_hold_seconds: 3,
            undo_toast_seconds: 6,
            day_header_centered: false,
            cadence_colors: true,
            cadence_color_daily: "#c2ffce".into(),
            cadence_color_weekly: "#c9c8fe".into(),
            cadence_color_monthly: "#febec3".into(),
            cadence_color_yearly: "#fe9d58".into(),
            cadence_color_exact: "#fe7c7c".into(),
            category_color: "#4d91fe".into(),
            chip_font_scale: 100,
            category_color_mode: "single".into(),
            category_color_a: "#0d9488".into(),
            category_color_b: "#ea580c".into(),
            done_color: "#10b981".into(),
            waiting_color: "#0ea5e9".into(),
            dropped_color: "#ef4444".into(),
            cadence_group_order: CADENCE_GROUPS.iter().map(|s| s.to_string()).collect(),
            subtasks_done_last: true,
            backup_keep: 14,
            notify_system: true,
            notify_snooze_minutes: 10,
            notify_lead_minutes: 0,
            notify_toast_seconds: 15,
            state_snapshot: true,
            sync_auto: true,
            sync_interval_minutes: 15,
            sync_on_leave: true,
            sync_debounce_seconds: 15,
            sync_on_focus: true,
            sync_mass_delete_guard_percent: 30,
            // Trust the WebView first; a floor is for the device where
            // it reports nothing, and guessing one by default would put
            // dead space on every device where it works.
            mobile_safe_area_top: 0,
            mobile_safe_area_bottom: 0,
            tasks_mirror: true,
            tasks_mirror_agenda: true,
            tasks_mirror_ids: true,
            // opt-in: a synced vault must not grow a new file unasked
            tasks_mirror_today: false,
            tasks_mirror_today_days: 1,
            cron_weekday_labels: true,
            cron_everyday_label: true,
            habit_rate_chip: true,
            habit_rate_alert_only: true,
            habit_rate_threshold: 80,
            habit_rate_window: 30,
            habit_rate_min_instances: 3,
            habit_rate_alert_color: "#f97316".into(),
            lists_sort_alpha: false,
            lists_page_columns: 4,
            lists_page_align_rows: true,
            list_view_plate_scale: 100,
            gap_fill_color: String::new(),
            gap_fill_fade: 50,
            gap_fill_inset: 15,
            gap_fill_max_thickness: 20,
            gap_fill_opacity: 0,
            list_gap_stripe: 60,
            section_cards: false,
            section_gap: 16,
            category_gap_bands: false,
            row_hairlines: true,
            category_headers: true,
            category_header_bold: true,
            section_plate_count: true,
            section_plate_sticky: true,
            fold_postponed: false,
            fold_waiting: false,
            fold_done: true,
            fold_dropped: false,
            closed_row_opacity: 50,
            lists_group_display: "flat".into(),
            days_page_columns: 7,
            days_today_only: false,
            closed_sections_sort_alpha: true,
            category_avoid_cadence_colors: true,
            list_tasks_sort_alpha: false,
            list_task_lines: 1,
            list_dialog_task_lines: 3,
            clear_done_list_tasks: true,
            priority_overdue: true,
            // every 1-2 days / up to ~10 days apart / up to a quarter apart
            cadence_daily_min_per_year: 183,
            cadence_weekly_min_per_year: 37,
            cadence_monthly_min_per_year: 4,
            ui_font_size: 16,
            content_color: "#dedede".into(),
            content_muted_color: String::new(),
            weekly_focus_color: String::new(),
            reminder_color: String::new(),
            day_header_color: String::new(),
            dow_label_color: "#c485ff".into(),
            dow_label_opacity: 60,
            list_date_chip_color: "#06b6d4".into(),
            cadence_color_general: "#ffffff".into(),
            postponed_plate_color: "#f59e0b".into(),
            done_plate_color: "#4ade80".into(),
            waiting_plate_color: "#3b82f6".into(),
            dropped_plate_color: "#f87171".into(),
            list_exact_stripe: false,
            capture_list: "Inbox".into(),
            capture_shortcut: "Ctrl+Alt+Space".into(),
            tray_icon: true,
            close_to_tray: true,
        }
    }
}

impl AppConfig {
    /// Days ahead the engine materializes tasks for (and the calendar
    /// projection starts after): the widest day grid any view shows, so
    /// a Days page wider than the dashboard is not left empty.
    pub fn horizon_days(&self) -> u32 {
        self.grid_columns.max(self.days_page_columns).max(1)
    }

    /// Loads app.yml, falling back to defaults when the file is broken
    /// instead of making the vault unopenable. The parse error comes
    /// back for the UI banner; the broken file stays on disk untouched
    /// until the user fixes it or saves a setting.
    pub fn load_or_default(path: &Path) -> (Self, Option<String>) {
        if !path.exists() {
            let config = Self::default();
            let error = config.save(path).err().map(|e| e.to_string());
            return (config, error);
        }
        match fs::read_to_string(path) {
            Ok(raw) => match serde_yaml::from_str::<Self>(&raw) {
                Ok(config) => (config.sanitized(), None),
                Err(e) => (
                    Self::default(),
                    Some(format!("invalid app.yml, defaults are active: {e}")),
                ),
            },
            Err(e) => (Self::default(), Some(e.to_string())),
        }
    }

    /// Clamps values a hand-edited app.yml could set to something that
    /// would panic in chrono date arithmetic (a huge grid horizon or
    /// catch-up window) or that no UI state exists for.
    pub fn sanitized(mut self) -> Self {
        self.grid_columns = self.grid_columns.clamp(1, 31);
        self.catchup_days = self.catchup_days.clamp(1, 365);
        self.retention_days = self.retention_days.min(36500);
        // A pass under a minute apart would spend the battery on
        // listings; a day apart is not a sync, it is a weekly backup.
        self.sync_interval_minutes = self.sync_interval_minutes.clamp(1, 720);
        self.sync_debounce_seconds = self.sync_debounce_seconds.clamp(5, 3600);
        // Under 5% a routine cleanup of old notes would trip it.
        self.sync_mass_delete_guard_percent = self.sync_mass_delete_guard_percent.clamp(5, 100);
        // A status bar is ~24-48dp and a navigation bar about the same;
        // past 200 the padding is no longer describing a system bar.
        self.mobile_safe_area_top = self.mobile_safe_area_top.min(200);
        self.mobile_safe_area_bottom = self.mobile_safe_area_bottom.min(200);
        if !["dark", "light"].contains(&self.theme.as_str()) {
            self.theme = "dark".into();
        }
        if !["inline", "separate"].contains(&self.done_display.as_str()) {
            self.done_display = "inline".into();
        }
        if !["folded", "flat"].contains(&self.lists_group_display.as_str()) {
            self.lists_group_display = "folded".into();
        }
        self.dashboard_split = self.dashboard_split.clamp(20, 80);
        self.list_columns = self.list_columns.clamp(1, 12);
        self.lists_page_columns = self.lists_page_columns.clamp(1, 12);
        if self.days_page_columns == 0 {
            self.days_page_columns = self.grid_columns;
        }
        self.days_page_columns = self.days_page_columns.clamp(1, 14);
        self.list_view_plate_scale = self.list_view_plate_scale.clamp(100, 400);
        self.gap_fill_fade = self.gap_fill_fade.min(100);
        self.gap_fill_inset = self.gap_fill_inset.min(45);
        self.gap_fill_max_thickness = self.gap_fill_max_thickness.clamp(1, 64);
        self.gap_fill_opacity = self.gap_fill_opacity.min(100);
        self.list_gap_stripe = self.list_gap_stripe.clamp(25, 150);
        self.section_gap = self.section_gap.min(64);
        self.closed_row_opacity = self.closed_row_opacity.clamp(20, 100);
        self.dow_label_opacity = self.dow_label_opacity.clamp(20, 100);
        self.calendar_daily_days = self.calendar_daily_days.min(366);
        self.calendar_weekly_weeks = self.calendar_weekly_weeks.min(52);
        self.calendar_monthly_months = self.calendar_monthly_months.min(24);
        self.calendar_yearly_years = self.calendar_yearly_years.min(5);
        self.calendar_dates_years = self.calendar_dates_years.min(5);
        self.done_hold_seconds = self.done_hold_seconds.min(30);
        self.undo_toast_seconds = self.undo_toast_seconds.min(30);
        self.notify_snooze_minutes = self.notify_snooze_minutes.clamp(1, 180);
        self.notify_lead_minutes = self.notify_lead_minutes.min(240);
        self.streak_strip_days = self.streak_strip_days.min(180);
        self.notify_toast_seconds = self.notify_toast_seconds.clamp(3, 600);
        self.backup_keep = self.backup_keep.min(365);
        self.ui_font_size = self.ui_font_size.clamp(10, 28);
        self.editor_font_size = self.editor_font_size.clamp(10, 28);
        // bucket thresholds must stay strictly ordered or every rule
        // would land in one bucket
        self.cadence_monthly_min_per_year = self.cadence_monthly_min_per_year.clamp(1, 998);
        self.cadence_weekly_min_per_year = self
            .cadence_weekly_min_per_year
            .clamp(self.cadence_monthly_min_per_year + 1, 999);
        self.cadence_daily_min_per_year = self
            .cadence_daily_min_per_year
            .clamp(self.cadence_weekly_min_per_year + 1, 1000);
        // a card that grows without bound stops being a card
        self.list_task_lines = self.list_task_lines.clamp(1, 10);
        self.list_dialog_task_lines = self.list_dialog_task_lines.clamp(1, 10);
        self.ui_font = self.ui_font.trim().to_string();
        self.editor_font = self.editor_font.trim().to_string();
        // hex colors land in inline styles; anything malformed falls
        // back to the default so no arbitrary string reaches the DOM
        let defaults = Self::default();
        let sanitize_color = |value: &mut String, default: String| {
            *value = value.trim().to_lowercase();
            if !(value.len() == 7
                && value.starts_with('#')
                && value[1..].chars().all(|c| c.is_ascii_hexdigit()))
            {
                *value = default;
            }
        };
        sanitize_color(&mut self.cadence_color_daily, defaults.cadence_color_daily);
        sanitize_color(
            &mut self.cadence_color_weekly,
            defaults.cadence_color_weekly,
        );
        sanitize_color(
            &mut self.cadence_color_monthly,
            defaults.cadence_color_monthly,
        );
        sanitize_color(
            &mut self.cadence_color_yearly,
            defaults.cadence_color_yearly,
        );
        sanitize_color(&mut self.cadence_color_exact, defaults.cadence_color_exact);
        sanitize_color(&mut self.category_color, defaults.category_color);
        sanitize_color(&mut self.category_color_a, defaults.category_color_a);
        sanitize_color(&mut self.category_color_b, defaults.category_color_b);
        if !CATEGORY_COLOR_MODES.contains(&self.category_color_mode.as_str()) {
            self.category_color_mode = defaults.category_color_mode;
        }
        self.chip_font_scale = self.chip_font_scale.clamp(50, 200);
        sanitize_color(&mut self.done_color, defaults.done_color);
        sanitize_color(&mut self.waiting_color, defaults.waiting_color);
        sanitize_color(&mut self.dropped_color, defaults.dropped_color);
        // an empty plate color is the old "neutral" value: it takes the
        // section's own default hue now
        sanitize_color(
            &mut self.postponed_plate_color,
            defaults.postponed_plate_color,
        );
        sanitize_color(&mut self.done_plate_color, defaults.done_plate_color);
        sanitize_color(&mut self.waiting_plate_color, defaults.waiting_plate_color);
        sanitize_color(&mut self.dropped_plate_color, defaults.dropped_plate_color);
        sanitize_color(
            &mut self.habit_rate_alert_color,
            defaults.habit_rate_alert_color,
        );
        self.habit_rate_threshold = self.habit_rate_threshold.min(100);
        self.habit_rate_window = self.habit_rate_window.min(3650);
        self.habit_rate_min_instances = self.habit_rate_min_instances.clamp(1, 365);
        // text tone overrides: empty means "theme default", anything
        // else must be a well-formed hex color
        let sanitize_optional_color = |value: &mut String| {
            *value = value.trim().to_lowercase();
            if !value.is_empty()
                && !(value.len() == 7
                    && value.starts_with('#')
                    && value[1..].chars().all(|c| c.is_ascii_hexdigit()))
            {
                value.clear();
            }
        };
        sanitize_optional_color(&mut self.accent_color);
        sanitize_optional_color(&mut self.surface_color);
        sanitize_optional_color(&mut self.surface_alt_color);
        sanitize_optional_color(&mut self.line_color);
        sanitize_optional_color(&mut self.content_color);
        sanitize_optional_color(&mut self.content_muted_color);
        sanitize_optional_color(&mut self.weekly_focus_color);
        sanitize_optional_color(&mut self.reminder_color);
        sanitize_optional_color(&mut self.day_header_color);
        sanitize_optional_color(&mut self.dow_label_color);
        sanitize_optional_color(&mut self.list_date_chip_color);
        sanitize_optional_color(&mut self.cadence_color_general);
        sanitize_optional_color(&mut self.gap_fill_color);
        // unknown names are dropped, missing entries come back in their
        // default position, so a typo can never lose a tab or a group
        let sanitize_order = |input: &[String], known: &[&str]| {
            let mut order: Vec<String> = Vec::new();
            for name in input {
                if known.contains(&name.as_str()) && !order.contains(name) {
                    order.push(name.clone());
                }
            }
            for name in known {
                if !order.iter().any(|o| o == name) {
                    order.push((*name).to_string());
                }
            }
            order
        };
        self.section_order = sanitize_order(&self.section_order, SECTIONS);
        // hidden is a set, not an order: unknown names go, duplicates go,
        // and missing ones stay missing (the default is "nothing hidden")
        self.section_hidden = {
            let mut kept: Vec<String> = Vec::new();
            for name in &self.section_hidden {
                if SECTIONS.contains(&name.as_str()) && !kept.contains(name) {
                    kept.push(name.clone());
                }
            }
            kept
        };
        self.cadence_group_order = sanitize_order(&self.cadence_group_order, CADENCE_GROUPS);
        self.capture_list = self.capture_list.trim().to_string();
        if self.capture_list.is_empty() {
            self.capture_list = defaults.capture_list;
        }
        self.tasks_mirror_today_days = self.tasks_mirror_today_days.clamp(1, 7);
        self.capture_shortcut = self.capture_shortcut.trim().to_string();
        if !self.tray_icon {
            self.close_to_tray = false;
        }
        self
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        crate::vault::write_atomic(path, &serde_yaml::to_string(self)?)?;
        Ok(())
    }

    /// The profile-scope subset as a YAML mapping with native value
    /// types - the settings-profile file format.
    pub fn profile_subset(&self) -> Result<serde_yaml::Mapping> {
        let value = serde_yaml::to_value(self)?;
        let mapping = value.as_mapping().cloned().unwrap_or_default();
        Ok(mapping
            .into_iter()
            .filter(|(key, _)| {
                key.as_str()
                    .map(|key| PROFILE_KEYS.contains(&key))
                    .unwrap_or(false)
            })
            .collect())
    }

    pub fn settings_pairs(&self) -> Vec<(&'static str, String)> {
        vec![
            ("theme", self.theme.clone()),
            ("accent_color", self.accent_color.clone()),
            ("surface_color", self.surface_color.clone()),
            ("surface_alt_color", self.surface_alt_color.clone()),
            ("line_color", self.line_color.clone()),
            ("grid_columns", self.grid_columns.to_string()),
            ("done_display", self.done_display.clone()),
            ("retention_days", self.retention_days.to_string()),
            ("catchup_days", self.catchup_days.to_string()),
            ("cron_ignore_time", self.cron_ignore_time.to_string()),
            ("kb_path", self.kb_path.clone()),
            ("section_order", self.section_order.join(",")),
            ("section_hidden", self.section_hidden.join(",")),
            (
                "dashboard_today_only",
                self.dashboard_today_only.to_string(),
            ),
            ("list_columns", self.list_columns.to_string()),
            ("kb_line_numbers", self.kb_line_numbers.to_string()),
            ("notes_timestamps", self.notes_timestamps.to_string()),
            ("journal_day_tasks", self.journal_day_tasks.to_string()),
            ("streak_strip_days", self.streak_strip_days.to_string()),
            (
                "daily_tasks_today_only",
                self.daily_tasks_today_only.to_string(),
            ),
            ("dashboard_split", self.dashboard_split.to_string()),
            ("calendar_daily_days", self.calendar_daily_days.to_string()),
            (
                "calendar_weekly_weeks",
                self.calendar_weekly_weeks.to_string(),
            ),
            (
                "calendar_monthly_months",
                self.calendar_monthly_months.to_string(),
            ),
            (
                "calendar_yearly_years",
                self.calendar_yearly_years.to_string(),
            ),
            (
                "calendar_dates_years",
                self.calendar_dates_years.to_string(),
            ),
            ("ui_font", self.ui_font.clone()),
            ("editor_font", self.editor_font.clone()),
            ("editor_font_size", self.editor_font_size.to_string()),
            ("done_hold_seconds", self.done_hold_seconds.to_string()),
            ("undo_toast_seconds", self.undo_toast_seconds.to_string()),
            ("day_header_centered", self.day_header_centered.to_string()),
            ("cadence_colors", self.cadence_colors.to_string()),
            ("cadence_color_daily", self.cadence_color_daily.clone()),
            ("cadence_color_weekly", self.cadence_color_weekly.clone()),
            ("cadence_color_monthly", self.cadence_color_monthly.clone()),
            ("cadence_color_yearly", self.cadence_color_yearly.clone()),
            ("cadence_color_exact", self.cadence_color_exact.clone()),
            ("category_color", self.category_color.clone()),
            ("chip_font_scale", self.chip_font_scale.to_string()),
            ("category_color_mode", self.category_color_mode.clone()),
            ("category_color_a", self.category_color_a.clone()),
            ("category_color_b", self.category_color_b.clone()),
            ("done_color", self.done_color.clone()),
            ("waiting_color", self.waiting_color.clone()),
            ("dropped_color", self.dropped_color.clone()),
            ("cadence_group_order", self.cadence_group_order.join(",")),
            ("subtasks_done_last", self.subtasks_done_last.to_string()),
            ("backup_keep", self.backup_keep.to_string()),
            ("notify_system", self.notify_system.to_string()),
            (
                "notify_snooze_minutes",
                self.notify_snooze_minutes.to_string(),
            ),
            ("notify_lead_minutes", self.notify_lead_minutes.to_string()),
            (
                "notify_toast_seconds",
                self.notify_toast_seconds.to_string(),
            ),
            ("state_snapshot", self.state_snapshot.to_string()),
            ("sync_auto", self.sync_auto.to_string()),
            (
                "sync_interval_minutes",
                self.sync_interval_minutes.to_string(),
            ),
            ("sync_on_leave", self.sync_on_leave.to_string()),
            (
                "sync_debounce_seconds",
                self.sync_debounce_seconds.to_string(),
            ),
            ("sync_on_focus", self.sync_on_focus.to_string()),
            (
                "sync_mass_delete_guard_percent",
                self.sync_mass_delete_guard_percent.to_string(),
            ),
            (
                "mobile_safe_area_top",
                self.mobile_safe_area_top.to_string(),
            ),
            (
                "mobile_safe_area_bottom",
                self.mobile_safe_area_bottom.to_string(),
            ),
            ("tasks_mirror", self.tasks_mirror.to_string()),
            ("tasks_mirror_agenda", self.tasks_mirror_agenda.to_string()),
            ("tasks_mirror_ids", self.tasks_mirror_ids.to_string()),
            ("tasks_mirror_today", self.tasks_mirror_today.to_string()),
            (
                "tasks_mirror_today_days",
                self.tasks_mirror_today_days.to_string(),
            ),
            ("cron_weekday_labels", self.cron_weekday_labels.to_string()),
            ("cron_everyday_label", self.cron_everyday_label.to_string()),
            ("habit_rate_chip", self.habit_rate_chip.to_string()),
            (
                "habit_rate_alert_only",
                self.habit_rate_alert_only.to_string(),
            ),
            (
                "habit_rate_threshold",
                self.habit_rate_threshold.to_string(),
            ),
            ("habit_rate_window", self.habit_rate_window.to_string()),
            (
                "habit_rate_min_instances",
                self.habit_rate_min_instances.to_string(),
            ),
            (
                "habit_rate_alert_color",
                self.habit_rate_alert_color.clone(),
            ),
            ("lists_sort_alpha", self.lists_sort_alpha.to_string()),
            ("lists_page_columns", self.lists_page_columns.to_string()),
            (
                "lists_page_align_rows",
                self.lists_page_align_rows.to_string(),
            ),
            (
                "list_view_plate_scale",
                self.list_view_plate_scale.to_string(),
            ),
            ("gap_fill_color", self.gap_fill_color.clone()),
            ("gap_fill_fade", self.gap_fill_fade.to_string()),
            ("gap_fill_inset", self.gap_fill_inset.to_string()),
            (
                "gap_fill_max_thickness",
                self.gap_fill_max_thickness.to_string(),
            ),
            ("gap_fill_opacity", self.gap_fill_opacity.to_string()),
            ("list_gap_stripe", self.list_gap_stripe.to_string()),
            ("section_cards", self.section_cards.to_string()),
            ("section_gap", self.section_gap.to_string()),
            ("category_gap_bands", self.category_gap_bands.to_string()),
            ("row_hairlines", self.row_hairlines.to_string()),
            ("category_headers", self.category_headers.to_string()),
            (
                "category_header_bold",
                self.category_header_bold.to_string(),
            ),
            ("section_plate_count", self.section_plate_count.to_string()),
            (
                "section_plate_sticky",
                self.section_plate_sticky.to_string(),
            ),
            ("fold_postponed", self.fold_postponed.to_string()),
            ("fold_waiting", self.fold_waiting.to_string()),
            ("fold_done", self.fold_done.to_string()),
            ("fold_dropped", self.fold_dropped.to_string()),
            ("closed_row_opacity", self.closed_row_opacity.to_string()),
            ("lists_group_display", self.lists_group_display.clone()),
            ("days_page_columns", self.days_page_columns.to_string()),
            ("days_today_only", self.days_today_only.to_string()),
            (
                "closed_sections_sort_alpha",
                self.closed_sections_sort_alpha.to_string(),
            ),
            (
                "category_avoid_cadence_colors",
                self.category_avoid_cadence_colors.to_string(),
            ),
            (
                "list_tasks_sort_alpha",
                self.list_tasks_sort_alpha.to_string(),
            ),
            (
                "clear_done_list_tasks",
                self.clear_done_list_tasks.to_string(),
            ),
            ("priority_overdue", self.priority_overdue.to_string()),
            (
                "cadence_daily_min_per_year",
                self.cadence_daily_min_per_year.to_string(),
            ),
            (
                "cadence_weekly_min_per_year",
                self.cadence_weekly_min_per_year.to_string(),
            ),
            (
                "cadence_monthly_min_per_year",
                self.cadence_monthly_min_per_year.to_string(),
            ),
            ("ui_font_size", self.ui_font_size.to_string()),
            ("content_color", self.content_color.clone()),
            ("content_muted_color", self.content_muted_color.clone()),
            ("weekly_focus_color", self.weekly_focus_color.clone()),
            ("reminder_color", self.reminder_color.clone()),
            ("day_header_color", self.day_header_color.clone()),
            ("dow_label_color", self.dow_label_color.clone()),
            ("dow_label_opacity", self.dow_label_opacity.to_string()),
            ("list_task_lines", self.list_task_lines.to_string()),
            (
                "list_dialog_task_lines",
                self.list_dialog_task_lines.to_string(),
            ),
            ("list_date_chip_color", self.list_date_chip_color.clone()),
            ("cadence_color_general", self.cadence_color_general.clone()),
            ("postponed_plate_color", self.postponed_plate_color.clone()),
            ("done_plate_color", self.done_plate_color.clone()),
            ("waiting_plate_color", self.waiting_plate_color.clone()),
            ("dropped_plate_color", self.dropped_plate_color.clone()),
            ("list_exact_stripe", self.list_exact_stripe.to_string()),
            ("capture_list", self.capture_list.clone()),
            ("capture_shortcut", self.capture_shortcut.clone()),
            ("tray_icon", self.tray_icon.to_string()),
            ("close_to_tray", self.close_to_tray.to_string()),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_created_when_file_missing() {
        let dir = std::env::temp_dir().join("app-pkb-test-config");
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("app.yml");

        let (config, error) = AppConfig::load_or_default(&path);
        assert!(error.is_none());
        assert_eq!(config, AppConfig::default());
        assert!(path.exists());

        let (reloaded, _) = AppConfig::load_or_default(&path);
        assert_eq!(reloaded, config);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn broken_app_yml_falls_back_to_defaults_with_error() {
        let dir = std::env::temp_dir().join("app-pkb-test-config-broken");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("app.yml");
        fs::write(&path, "theme: [broken\n").unwrap();

        let (config, error) = AppConfig::load_or_default(&path);
        assert_eq!(config, AppConfig::default());
        assert!(error.is_some());
        // the broken file is left untouched for the user to fix
        assert_eq!(fs::read_to_string(&path).unwrap(), "theme: [broken\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sanitize_clamps_dangerous_values() {
        let config = AppConfig {
            grid_columns: 0,
            catchup_days: 99_999_999,
            theme: "solarized".into(),
            done_display: "weird".into(),
            dashboard_split: 99,
            section_order: vec!["kb".into(), "typo".into(), "kb".into()],
            section_hidden: vec!["kb".into(), "typo".into(), "kb".into()],
            lists_group_display: "sideways".into(),
            ..AppConfig::default()
        }
        .sanitized();
        assert_eq!(config.section_hidden, vec!["kb"]);
        assert_eq!(config.lists_group_display, "folded");
        assert_eq!(config.grid_columns, 1);
        assert_eq!(config.catchup_days, 365);
        assert_eq!(config.theme, "dark");
        assert_eq!(config.done_display, "inline");
        assert_eq!(config.dashboard_split, 80);
        assert_eq!(
            config.section_order,
            vec![
                "kb",
                "dashboard",
                "lists",
                "days",
                "upcoming",
                "reminders",
                "calendar",
                "history",
                "review",
                "journal"
            ]
        );
    }

    /// AppConfig fields must be mirrored in settings_pairs by hand;
    /// this pins the two together so a new field cannot silently skip
    /// the settings mirror.
    #[test]
    fn settings_pairs_covers_every_field() {
        let config = AppConfig::default();
        let yaml = serde_yaml::to_value(&config).unwrap();
        let mapping = yaml.as_mapping().unwrap();
        let pairs = config.settings_pairs();
        for key in mapping.keys() {
            let key = key.as_str().unwrap();
            assert!(
                pairs.iter().any(|(k, _)| *k == key),
                "settings_pairs is missing '{key}'"
            );
        }
        assert_eq!(pairs.len(), mapping.len());
    }

    /// PROFILE_KEYS is a hand-maintained whitelist over the serde field
    /// names; a typo or a renamed field must fail loudly, not silently
    /// drop the key from every profile.
    #[test]
    fn profile_keys_are_real_fields() {
        let yaml = serde_yaml::to_value(AppConfig::default()).unwrap();
        let mapping = yaml.as_mapping().unwrap();
        for key in PROFILE_KEYS {
            assert!(
                mapping.contains_key(serde_yaml::Value::from(*key)),
                "PROFILE_KEYS names unknown field '{key}'"
            );
        }
        // no duplicates
        let unique: std::collections::HashSet<_> = PROFILE_KEYS.iter().collect();
        assert_eq!(unique.len(), PROFILE_KEYS.len());
        let subset = AppConfig::default().profile_subset().unwrap();
        assert_eq!(subset.len(), PROFILE_KEYS.len());
    }

    #[test]
    fn horizon_follows_the_widest_day_grid() {
        let mut config = AppConfig {
            grid_columns: 3,
            days_page_columns: 10,
            ..Default::default()
        };
        assert_eq!(config.horizon_days(), 10);
        config.days_page_columns = 1;
        assert_eq!(config.horizon_days(), 3);
    }

    #[test]
    fn partial_yaml_falls_back_to_defaults() {
        let config: AppConfig = serde_yaml::from_str("theme: light\n").unwrap();
        assert_eq!(config.theme, "light");
        assert_eq!(config.grid_columns, 7);
    }
}
