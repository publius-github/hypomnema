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
    /// Contrast floor for the object colors (plates, chips, stripes,
    /// status marks, header and marker tones), in tenths of a ratio
    /// (45 = 4.5:1): a color that reads below it on the current theme's
    /// panels is moved in lightness until it does, hue kept - lighter
    /// on a dark theme, darker on a light one. Marks stop at 3:1.
    /// 0 = off, colors used as picked.
    pub color_min_contrast: u32,
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
    /// pins concrete weekdays, and an [EVERYDAY] one on rules free on
    /// both day fields.
    pub cron_weekday_labels: bool,
    /// Recurring task cards wear a `Rate: 82%` chip - the share of the
    /// rule item's settled instances that were done: "off", "alert" =
    /// only once it falls below its threshold, "always".
    #[ts(type = "\"off\" | \"alert\" | \"always\"")]
    pub habit_rate_display: String,
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
    /// Order the list columns alphabetically (favorites still come
    /// first), and the tasks inside each list too (timed tasks still pin
    /// to the top); off = manual creation and drag order.
    pub lists_sort_alpha: bool,
    /// Grid columns on the dedicated Lists page.
    pub lists_page_columns: u32,
    /// Lists page: stretch every list column to its grid row's height so
    /// the rows line up; off = each column takes its natural height.
    pub lists_page_align_rows: bool,
    /// Section plate height in the day and list columns, % of the
    /// plate's normal height (100..=400); the plate text scales with it.
    pub list_view_plate_scale: u32,
    /// Breaks between list rows are plain space in fixed stripes: one
    /// stripe is this % of a single-line row's height (25..=150). A
    /// category break is one stripe, a section break two, the break
    /// into the closed blocks three.
    pub list_gap_stripe: u32,
    /// Hairlines between the rows of a column.
    pub row_hairlines: bool,
    /// A category block names its category once, as a bold header over
    /// its rows, instead of a chip on every row.
    pub category_headers: bool,
    /// Section plates show how many tasks the section holds (done/total
    /// when closed tasks stay inline).
    pub section_plate_count: bool,
    /// Section plates stick to the top of the column while its rows
    /// scroll under them.
    pub section_plate_sticky: bool,
    /// Sections folded to their plate (cadence keys, "priority",
    /// "postponed", "waiting", "done", "dropped"): a click on a plate
    /// folds or opens that section in every column, and the choice is
    /// remembered here instead of being a setting.
    pub folded_sections: Vec<String>,
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
    /// Keep running in the tray: a tray icon with Show / Quick capture /
    /// Quit, and closing the main window hides it there instead of
    /// quitting, keeping the capture shortcut and notifications alive.
    pub tray_icon: bool,
    /// Desktop: at startup ask the project's GitHub releases whether a
    /// newer version exists (the only network request the app makes on
    /// its own; installing still asks first). Off = never ask.
    pub update_check: bool,
}

pub const CATEGORY_COLOR_MODES: &[&str] = &["single", "varied", "alternate"];

/// The color scheme: fields kept in the synced `config/colors.yml`
/// (`vault::synced_file`) instead of the per-device app.yml, so every
/// device paints the vault the same way - the scheme belongs to the
/// user, while column counts and the theme belong to the screen. app.yml
/// never carries them: a copy left there by an older version is ignored
/// on load and dropped on the next save. A missing colors.yml means the
/// defaults. Settings has no controls for these; colors.yml is edited by
/// hand (Notes > Config).
pub const COLOR_KEYS: &[&str] = &[
    "accent_color",
    "surface_color",
    "surface_alt_color",
    "line_color",
    "color_min_contrast",
    "content_color",
    "content_muted_color",
    "weekly_focus_color",
    "reminder_color",
    "day_header_color",
    "dow_label_color",
    "dow_label_opacity",
    "cadence_colors",
    "cadence_color_general",
    "cadence_color_daily",
    "cadence_color_weekly",
    "cadence_color_monthly",
    "cadence_color_yearly",
    "cadence_color_exact",
    "done_color",
    "waiting_color",
    "dropped_color",
    "category_color",
    "category_color_mode",
    "category_avoid_cadence_colors",
    "category_color_a",
    "category_color_b",
    "habit_rate_alert_color",
    "postponed_plate_color",
    "done_plate_color",
    "waiting_plate_color",
    "dropped_plate_color",
    "list_date_chip_color",
    "list_exact_stripe",
];

/// Rules every device must agree on, kept in the synced
/// `config/shared.yml`: the engine runs on each device, so a retention
/// window, catch-up window, cadence threshold or cleanup switch that
/// differed between them would make two devices clean up and generate
/// differently. The capture list and the completion-rate inputs ride
/// along so a task captured or a rate shown means the same everywhere.
/// These keep their Settings controls - only where they are stored
/// changes.
pub const SHARED_KEYS: &[&str] = &[
    "retention_days",
    "catchup_days",
    "cron_ignore_time",
    "clear_done_list_tasks",
    "priority_overdue",
    "cadence_daily_min_per_year",
    "cadence_weekly_min_per_year",
    "cadence_monthly_min_per_year",
    "capture_list",
    "habit_rate_threshold",
    "habit_rate_window",
    "habit_rate_min_instances",
];

/// A slice of AppConfig that lives in a synced file under config/
/// instead of the per-device app.yml.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncedPart {
    Colors,
    Shared,
}

impl SyncedPart {
    pub const ALL: [SyncedPart; 2] = [SyncedPart::Colors, SyncedPart::Shared];

    /// The file under config/.
    pub fn file(self) -> &'static str {
        match self {
            SyncedPart::Colors => "colors.yml",
            SyncedPart::Shared => "shared.yml",
        }
    }

    pub fn keys(self) -> &'static [&'static str] {
        match self {
            SyncedPart::Colors => COLOR_KEYS,
            SyncedPart::Shared => SHARED_KEYS,
        }
    }

    pub fn from_file(file: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|part| part.file() == file)
    }

    fn owns(self, key: &serde_yaml::Value) -> bool {
        key.as_str()
            .map(|k| self.keys().contains(&k))
            .unwrap_or(false)
    }
}

fn is_synced_key(key: &serde_yaml::Value) -> bool {
    SyncedPart::ALL.iter().any(|part| part.owns(key))
}

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

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            accent_color: String::new(),
            surface_color: String::new(),
            surface_alt_color: String::new(),
            line_color: String::new(),
            color_min_contrast: 45,
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
            cadence_color_daily: "#0a8c81".into(),
            cadence_color_weekly: "#d8ac5f".into(),
            cadence_color_monthly: "#8b68db".into(),
            cadence_color_yearly: "#cb5092".into(),
            cadence_color_exact: "#df4645".into(),
            category_color: "#5194e6".into(),
            chip_font_scale: 100,
            category_color_mode: "single".into(),
            category_color_a: "#5a8a05".into(),
            category_color_b: "#c95e05".into(),
            done_color: "#079042".into(),
            waiting_color: "#0a88a5".into(),
            dropped_color: "#b76262".into(),
            cadence_group_order: CADENCE_GROUPS.iter().map(|s| s.to_string()).collect(),
            subtasks_done_last: true,
            backup_keep: 14,
            notify_system: true,
            notify_snooze_minutes: 10,
            notify_lead_minutes: 0,
            notify_toast_seconds: 15,
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
            habit_rate_display: "alert".into(),
            habit_rate_threshold: 80,
            habit_rate_window: 30,
            habit_rate_min_instances: 3,
            habit_rate_alert_color: "#c95e05".into(),
            lists_sort_alpha: false,
            lists_page_columns: 4,
            lists_page_align_rows: true,
            list_view_plate_scale: 100,
            list_gap_stripe: 60,
            folded_sections: vec!["done".into(), "dropped".into()],
            row_hairlines: true,
            category_headers: true,
            section_plate_count: true,
            section_plate_sticky: true,
            closed_row_opacity: 50,
            lists_group_display: "flat".into(),
            days_page_columns: 7,
            days_today_only: false,
            closed_sections_sort_alpha: true,
            category_avoid_cadence_colors: true,
            list_task_lines: 1,
            list_dialog_task_lines: 3,
            clear_done_list_tasks: true,
            priority_overdue: true,
            // every 1-2 days / up to ~10 days apart / up to a quarter apart
            cadence_daily_min_per_year: 183,
            cadence_weekly_min_per_year: 37,
            cadence_monthly_min_per_year: 4,
            ui_font_size: 16,
            content_color: String::new(),
            content_muted_color: String::new(),
            weekly_focus_color: String::new(),
            reminder_color: String::new(),
            day_header_color: String::new(),
            dow_label_color: "#bb9dc8".into(),
            dow_label_opacity: 60,
            list_date_chip_color: String::new(),
            cadence_color_general: String::new(),
            postponed_plate_color: "#a97205".into(),
            done_plate_color: "#079042".into(),
            waiting_plate_color: "#0a88a5".into(),
            dropped_plate_color: "#797d85".into(),
            list_exact_stripe: true,
            capture_list: "Inbox".into(),
            capture_shortcut: "Ctrl+Alt+Space".into(),
            tray_icon: true,
            update_check: true,
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

    /// Loads app.yml plus the synced files under `config_dir`
    /// (colors.yml, shared.yml), falling back to defaults when app.yml
    /// is broken instead of making the vault unopenable. The parse error
    /// comes back for the UI banner; the broken file stays on disk
    /// untouched until the user fixes it or saves a setting.
    pub fn load_or_default(settings: &Path, config_dir: &Path) -> (Self, Option<String>) {
        if !settings.exists() {
            let config = Self::default();
            if let Err(e) = config.save(settings) {
                return (config, Some(e.to_string()));
            }
        }
        Self::seed_shared(settings, config_dir);
        match Self::read(settings, config_dir) {
            Ok((config, errors)) => {
                // an app.yml from an older version carries synced fields
                // and retired ones; rewrite it once so what the Notes >
                // Config editor shows is exactly what is in effect
                if config.has_stale_keys(settings) {
                    let _ = config.save(settings);
                }
                let error = errors
                    .into_iter()
                    .map(|(part, e)| {
                        format!("invalid {}, its defaults are active: {e}", part.file())
                    })
                    .reduce(|a, b| format!("{a}; {b}"));
                (config, error)
            }
            Err(e) => (
                Self::default(),
                Some(format!("invalid app.yml, defaults are active: {e}")),
            ),
        }
    }

    /// First open after the rules moved to shared.yml: a device whose
    /// app.yml still holds non-default values for them writes those into
    /// shared.yml, so they are not silently lost. A device sitting at
    /// the defaults writes nothing and waits for the file to sync in.
    /// (Colors were not seeded: the defaults are the owner's scheme.)
    fn seed_shared(settings: &Path, config_dir: &Path) {
        let shared = config_dir.join(SyncedPart::Shared.file());
        if shared.exists() {
            return;
        }
        let Ok(raw) = fs::read_to_string(settings) else {
            return;
        };
        let Ok(legacy) = serde_yaml::from_str::<Self>(&raw) else {
            return;
        };
        let legacy = legacy.sanitized();
        let (Ok(mine), Ok(defaults)) = (
            legacy.part_mapping(SyncedPart::Shared),
            Self::default().part_mapping(SyncedPart::Shared),
        ) else {
            return;
        };
        if mine != defaults {
            let _ = legacy.save_part(SyncedPart::Shared, &shared);
        }
    }

    /// Reads app.yml (absent = defaults) with each synced file laid over
    /// it. Err = app.yml itself is unreadable; a broken synced file only
    /// costs its own fields - they fall back to the defaults and the
    /// list says which file and why.
    pub fn read(
        settings: &Path,
        config_dir: &Path,
    ) -> std::result::Result<(Self, Vec<(SyncedPart, String)>), String> {
        let mut config = if settings.exists() {
            let raw = fs::read_to_string(settings).map_err(|e| e.to_string())?;
            let mut map = serde_yaml::from_str::<Option<serde_yaml::Mapping>>(&raw)
                .map_err(|e| e.to_string())?
                .unwrap_or_default();
            // synced fields left in app.yml are an older version's
            // leftover: the synced files own them now
            map.retain(|key, _| !is_synced_key(key));
            Self::from_mapping(map).map_err(|e| e.to_string())?
        } else {
            Self::default()
        }
        .sanitized();
        let mut errors = Vec::new();
        for part in SyncedPart::ALL {
            let path = config_dir.join(part.file());
            if !path.exists() {
                continue;
            }
            let layered = fs::read_to_string(&path)
                .map_err(|e| e.to_string())
                .and_then(|raw| {
                    serde_yaml::from_str::<Option<serde_yaml::Mapping>>(&raw)
                        .map_err(|e| e.to_string())
                })
                .and_then(|map| {
                    config
                        .clone()
                        .with_part(part, &map.unwrap_or_default())
                        .map_err(|e| e.to_string())
                });
            match layered {
                Ok(next) => config = next,
                Err(e) => errors.push((part, e)),
            }
        }
        Ok((config, errors))
    }

    /// app.yml holds a key `save` would not write: a synced field, or a
    /// field this version no longer has.
    fn has_stale_keys(&self, settings: &Path) -> bool {
        let Ok(raw) = fs::read_to_string(settings) else {
            return false;
        };
        let Ok(Some(file)) = serde_yaml::from_str::<Option<serde_yaml::Mapping>>(&raw) else {
            return false;
        };
        let Ok(known) = self.to_mapping() else {
            return false;
        };
        file.keys()
            .any(|key| is_synced_key(key) || !known.contains_key(key))
    }

    fn to_mapping(&self) -> Result<serde_yaml::Mapping> {
        Ok(serde_yaml::to_value(self)?
            .as_mapping()
            .cloned()
            .unwrap_or_default())
    }

    fn from_mapping(map: serde_yaml::Mapping) -> Result<Self> {
        Ok(serde_yaml::from_value(serde_yaml::Value::Mapping(map))?)
    }

    /// A synced part's fields as a mapping - its file format.
    pub fn part_mapping(&self, part: SyncedPart) -> Result<serde_yaml::Mapping> {
        let mut map = self.to_mapping()?;
        map.retain(|key, _| part.owns(key));
        Ok(map)
    }

    /// This config with a synced part's fields from `values` laid over
    /// it; any other key in `values` is ignored.
    pub fn with_part(self, part: SyncedPart, values: &serde_yaml::Mapping) -> Result<Self> {
        let mut map = self.to_mapping()?;
        for (key, value) in values {
            if part.owns(key) {
                map.insert(key.clone(), value.clone());
            }
        }
        Ok(Self::from_mapping(map)?.sanitized())
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
        self.list_gap_stripe = self.list_gap_stripe.clamp(25, 150);
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
        // below 1:1 a floor means nothing; 21:1 is black on white
        self.color_min_contrast = match self.color_min_contrast {
            0..=9 => 0,
            n => n.min(210),
        };
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
        if !["off", "alert", "always"].contains(&self.habit_rate_display.as_str()) {
            self.habit_rate_display = defaults.habit_rate_display;
        }
        // a fold is a section key: keep each once, and only short plain
        // keys - the list lands in app.yml, not in the DOM
        let mut folded: Vec<String> = Vec::new();
        for key in &self.folded_sections {
            let key = key.trim();
            if !key.is_empty() && key.len() <= 32 && !folded.iter().any(|k| k == key) {
                folded.push(key.to_string());
            }
        }
        self.folded_sections = folded;
        self
    }

    /// Writes app.yml: everything but the synced parts, which live in
    /// their own files (`save_part`).
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut map = self.to_mapping()?;
        map.retain(|key, _| !is_synced_key(key));
        crate::vault::write_atomic(path, &serde_yaml::to_string(&map)?)?;
        Ok(())
    }

    /// Writes a synced part's file.
    pub fn save_part(&self, part: SyncedPart, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        crate::vault::write_atomic(path, &serde_yaml::to_string(&self.part_mapping(part)?)?)?;
        Ok(())
    }

    pub fn settings_pairs(&self) -> Vec<(&'static str, String)> {
        vec![
            ("theme", self.theme.clone()),
            ("accent_color", self.accent_color.clone()),
            ("surface_color", self.surface_color.clone()),
            ("surface_alt_color", self.surface_alt_color.clone()),
            ("line_color", self.line_color.clone()),
            ("color_min_contrast", self.color_min_contrast.to_string()),
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
            ("habit_rate_display", self.habit_rate_display.clone()),
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
            ("list_gap_stripe", self.list_gap_stripe.to_string()),
            ("folded_sections", self.folded_sections.join(",")),
            ("row_hairlines", self.row_hairlines.to_string()),
            ("category_headers", self.category_headers.to_string()),
            ("section_plate_count", self.section_plate_count.to_string()),
            (
                "section_plate_sticky",
                self.section_plate_sticky.to_string(),
            ),
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
            ("update_check", self.update_check.to_string()),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_created_when_file_missing() {
        let dir = std::env::temp_dir().join("hypomnema-test-config");
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("app.yml");

        let (config, error) = AppConfig::load_or_default(&path, &dir);
        assert!(error.is_none());
        assert_eq!(config, AppConfig::default());
        assert!(path.exists());

        let (reloaded, _) = AppConfig::load_or_default(&path, &dir);
        assert_eq!(reloaded, config);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn broken_app_yml_falls_back_to_defaults_with_error() {
        let dir = std::env::temp_dir().join("hypomnema-test-config-broken");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("app.yml");
        fs::write(&path, "theme: [broken\n").unwrap();

        let (config, error) = AppConfig::load_or_default(&path, &dir);
        assert_eq!(config, AppConfig::default());
        assert!(error.is_some());
        // the broken file is left untouched for the user to fix
        assert_eq!(fs::read_to_string(&path).unwrap(), "theme: [broken\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn colors_live_in_their_own_file() {
        let dir = std::env::temp_dir().join("hypomnema-test-config-colors");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let (settings, colors) = (dir.join("app.yml"), dir.join("colors.yml"));
        let config = AppConfig {
            grid_columns: 5,
            cadence_color_weekly: "#123456".into(),
            ..AppConfig::default()
        };
        config.save(&settings).unwrap();
        config.save_part(SyncedPart::Colors, &colors).unwrap();
        let app_yml = fs::read_to_string(&settings).unwrap();
        assert!(app_yml.contains("grid_columns: 5"));
        assert!(!app_yml.contains("cadence_color_weekly"));
        let colors_yml = fs::read_to_string(&colors).unwrap();
        assert!(colors_yml.contains("cadence_color_weekly: '#123456'"));
        assert!(!colors_yml.contains("grid_columns"));

        let (loaded, error) = AppConfig::load_or_default(&settings, &dir);
        assert!(error.is_none());
        assert_eq!(loaded, config);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stale_keys_are_dropped_from_app_yml_on_load() {
        let dir = std::env::temp_dir().join("hypomnema-test-config-stale");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let settings = dir.join("app.yml");
        fs::write(
            &settings,
            "grid_columns: 5\ndone_color: '#123456'\nsection_cards: true\n",
        )
        .unwrap();
        let (loaded, _) = AppConfig::load_or_default(&settings, &dir);
        assert_eq!(loaded.grid_columns, 5);
        let raw = fs::read_to_string(&settings).unwrap();
        assert!(raw.contains("grid_columns: 5"));
        assert!(!raw.contains("done_color"));
        assert!(!raw.contains("section_cards"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn colors_left_in_app_yml_are_ignored() {
        let dir = std::env::temp_dir().join("hypomnema-test-config-legacy-colors");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let settings = dir.join("app.yml");
        fs::write(
            &settings,
            "grid_columns: 5\ncadence_color_weekly: '#123456'\n",
        )
        .unwrap();
        // no colors.yml yet: the defaults, not the stale per-device copy
        let (loaded, error) = AppConfig::load_or_default(&settings, &dir);
        assert!(error.is_none());
        assert_eq!(loaded.grid_columns, 5);
        assert_eq!(
            loaded.cadence_color_weekly,
            AppConfig::default().cadence_color_weekly
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn broken_colors_yml_costs_only_the_colors() {
        let dir = std::env::temp_dir().join("hypomnema-test-config-broken-colors");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let (settings, colors) = (dir.join("app.yml"), dir.join("colors.yml"));
        fs::write(&settings, "grid_columns: 5\n").unwrap();
        fs::write(&colors, "cadence_colors: [not a bool\n").unwrap();
        let (loaded, error) = AppConfig::load_or_default(&settings, &dir);
        assert_eq!(loaded.grid_columns, 5);
        assert_eq!(loaded.cadence_colors, AppConfig::default().cadence_colors);
        assert!(error.unwrap().contains("colors.yml"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn colors_yml_ignores_keys_that_are_not_colors() {
        let colors: serde_yaml::Mapping =
            serde_yaml::from_str("grid_columns: 9\ndone_color: '#00ff00'\n").unwrap();
        let config = AppConfig::default()
            .with_part(SyncedPart::Colors, &colors)
            .unwrap();
        assert_eq!(config.grid_columns, AppConfig::default().grid_columns);
        assert_eq!(config.done_color, "#00ff00");
    }

    #[test]
    fn shared_rules_are_seeded_once_from_an_old_app_yml() {
        let dir = std::env::temp_dir().join("hypomnema-test-config-seed-shared");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let settings = dir.join("app.yml");
        fs::write(
            &settings,
            "grid_columns: 5\nretention_days: 365\ncatchup_days: 30\n",
        )
        .unwrap();
        let (loaded, error) = AppConfig::load_or_default(&settings, &dir);
        assert!(error.is_none());
        assert_eq!((loaded.retention_days, loaded.catchup_days), (365, 30));
        let shared = fs::read_to_string(dir.join("shared.yml")).unwrap();
        assert!(shared.contains("retention_days: 365"));
        assert!(!shared.contains("grid_columns"));
        // and app.yml no longer carries them
        let app_yml = fs::read_to_string(&settings).unwrap();
        assert!(!app_yml.contains("retention_days"));
        assert!(app_yml.contains("grid_columns: 5"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_device_at_the_defaults_does_not_seed_shared_yml() {
        let dir = std::env::temp_dir().join("hypomnema-test-config-no-seed");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let settings = dir.join("app.yml");
        fs::write(&settings, "grid_columns: 5\n").unwrap();
        let _ = AppConfig::load_or_default(&settings, &dir);
        assert!(!dir.join("shared.yml").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn shared_yml_wins_over_an_old_app_yml() {
        let dir = std::env::temp_dir().join("hypomnema-test-config-shared-wins");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let settings = dir.join("app.yml");
        fs::write(&settings, "retention_days: 7\n").unwrap();
        fs::write(dir.join("shared.yml"), "retention_days: 365\n").unwrap();
        let (loaded, _) = AppConfig::load_or_default(&settings, &dir);
        assert_eq!(loaded.retention_days, 365);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn synced_keys_are_real_fields_and_owned_once() {
        let yaml = serde_yaml::to_value(AppConfig::default()).unwrap();
        let mapping = yaml.as_mapping().unwrap();
        for key in SHARED_KEYS {
            assert!(mapping.contains_key(*key), "unknown shared key '{key}'");
            assert!(!COLOR_KEYS.contains(key), "'{key}' is in both files");
        }
    }

    #[test]
    fn color_keys_are_real_fields() {
        let yaml = serde_yaml::to_value(AppConfig::default()).unwrap();
        let mapping = yaml.as_mapping().unwrap();
        for key in COLOR_KEYS {
            assert!(mapping.contains_key(*key), "unknown color key '{key}'");
        }
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
