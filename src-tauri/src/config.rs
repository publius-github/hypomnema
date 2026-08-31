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
    /// Named chrome palette applied on top of the dark/light theme
    /// ("default" = the stylesheet colors); each preset carries both a
    /// dark and a light variant.
    #[ts(type = "\"default\" | \"black\" | \"vscode\" | \"nord\" | \"gruvbox\" | \"solarized\"")]
    pub theme_preset: String,
    /// Individual chrome color overrides, hex; empty = preset default.
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
    /// Dashboard shows a single Today column instead of the week grid.
    pub dashboard_today_only: bool,
    /// How many list columns are visible at once in the dashboard list
    /// zone; the rest are paged with the arrows.
    pub list_columns: u32,
    /// Show line numbers in the Notes editor (config files always do).
    pub kb_line_numbers: bool,
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
    /// Checked (done) checkboxes on task cards and subtasks.
    pub done_color: String,
    /// Vertical gap between task cards inside a column, px.
    /// (New numeric keys replace the old cadence_group_gap/category_gap
    /// booleans; stale keys in app.yml are ignored by serde.)
    pub task_gap: u32,
    /// Vertical gap before each section of a column (cadence groups,
    /// Postponed, Done), px.
    pub section_gap: u32,
    /// Vertical gap between {Category} blocks inside a section, px.
    pub category_block_gap: u32,
    /// Vertical gap before the Postponed and Done sections of a column
    /// (done_display = separate), px; lets them sit visibly below the
    /// active tasks instead of blending in.
    pub done_section_gap: u32,
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
    /// Two-way Markdown mirror of the manual tasks under <vault>/tasks/
    /// (one file per list + scheduled.md) for bulk editing in any editor.
    pub tasks_mirror: bool,
    /// Show a [SAT#1]-style marker before recurring tasks whose cron
    /// pins concrete weekdays.
    pub cron_weekday_labels: bool,
    /// With cron_weekday_labels on, rules free on both day fields wear
    /// an [EVERYDAY] marker instead of going unlabeled.
    pub cron_everyday_label: bool,
    /// Order the dashboard list columns alphabetically (favorites still
    /// come first); off = manual creation order.
    pub lists_sort_alpha: bool,
    /// Grid columns on the dedicated Lists page.
    pub lists_page_columns: u32,
    /// Lists page: stretch every list column to its grid row's height so
    /// the rows line up; off = each column takes its natural height.
    pub lists_page_align_rows: bool,
    /// Day columns on the dedicated Days page (its own width, not tied
    /// to the dashboard grid). 0 is a legacy "follow the dashboard"
    /// value that sanitize resolves to grid_columns.
    pub days_page_columns: u32,
    /// Days page shows a single Today column (its own toggle, separate
    /// from dashboard_today_only).
    pub days_today_only: bool,
    /// Order the tasks inside a list column alphabetically (timed tasks
    /// still pin to the top); off = manual drag order.
    pub list_tasks_sort_alpha: bool,
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
    /// Date chip of a dated list task inside its LIST column; empty =
    /// the exact-date cadence color. Day columns always use that color.
    pub list_date_chip_color: String,
    /// Section plate colors: the General cadence group and the Postponed
    /// and Done blocks; empty = the neutral plate style.
    pub cadence_color_general: String,
    pub postponed_plate_color: String,
    pub done_plate_color: String,
    /// The card stripe of a dated list task keeps the exact-date color
    /// inside its list too; off = the list color rules there. Day
    /// columns always use the exact-date color.
    pub list_exact_stripe: bool,
    /// Markdown editor color scheme: a named preset, or "custom" using
    /// the md_color_* values below.
    #[ts(type = "\"vscode\" | \"monokai\" | \"one-dark\" | \"github\" | \"custom\"")]
    pub md_preset: String,
    /// Custom markdown token colors (used when md_preset = custom).
    pub md_color_heading: String,
    pub md_color_bold: String,
    pub md_color_italic: String,
    pub md_color_code: String,
    pub md_color_link: String,
    pub md_color_quote: String,
    pub md_color_marker: String,
}

pub const MD_PRESETS: &[&str] = &["vscode", "monokai", "one-dark", "github", "custom"];

pub const THEME_PRESETS: &[&str] = &["default", "black", "vscode", "nord", "gruvbox", "solarized"];

pub const SECTIONS: &[&str] = &[
    "dashboard",
    "lists",
    "days",
    "upcoming",
    "calendar",
    "history",
    "journal",
    "kb",
];

pub const CADENCE_GROUPS: &[&str] = &["exact", "general", "daily", "weekly", "monthly", "yearly"];

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            theme_preset: "default".into(),
            accent_color: String::new(),
            surface_color: String::new(),
            surface_alt_color: String::new(),
            line_color: String::new(),
            grid_columns: 7,
            done_display: "inline".into(),
            retention_days: 0,
            catchup_days: 14,
            cron_ignore_time: true,
            kb_path: String::new(),
            section_order: SECTIONS.iter().map(|s| s.to_string()).collect(),
            dashboard_today_only: false,
            list_columns: 4,
            kb_line_numbers: false,
            daily_tasks_today_only: false,
            dashboard_split: 60,
            calendar_daily_days: 3,
            calendar_weekly_weeks: 3,
            calendar_monthly_months: 3,
            calendar_yearly_years: 1,
            calendar_dates_years: 1,
            ui_font: String::new(),
            editor_font: "Consolas".into(),
            editor_font_size: 16,
            done_hold_seconds: 3,
            day_header_centered: false,
            cadence_colors: true,
            cadence_color_daily: "#9ca3af".into(),
            cadence_color_weekly: "#3b82f6".into(),
            cadence_color_monthly: "#a855f7".into(),
            cadence_color_yearly: "#f59e0b".into(),
            cadence_color_exact: "#0ea5e9".into(),
            category_color: "#3b82f6".into(),
            done_color: "#22c55e".into(),
            task_gap: 6,
            section_gap: 12,
            category_block_gap: 12,
            done_section_gap: 12,
            cadence_group_order: CADENCE_GROUPS.iter().map(|s| s.to_string()).collect(),
            subtasks_done_last: true,
            backup_keep: 14,
            notify_system: true,
            tasks_mirror: true,
            cron_weekday_labels: true,
            cron_everyday_label: true,
            lists_sort_alpha: false,
            lists_page_columns: 4,
            lists_page_align_rows: true,
            days_page_columns: 7,
            days_today_only: false,
            list_tasks_sort_alpha: false,
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
            dow_label_color: String::new(),
            list_date_chip_color: String::new(),
            cadence_color_general: String::new(),
            postponed_plate_color: String::new(),
            done_plate_color: String::new(),
            list_exact_stripe: false,
            md_preset: "vscode".into(),
            // custom starts from the Dark+ values
            md_color_heading: "#569cd6".into(),
            md_color_bold: "#569cd6".into(),
            md_color_italic: "#c586c0".into(),
            md_color_code: "#ce9178".into(),
            md_color_link: "#ce9178".into(),
            md_color_quote: "#6a9955".into(),
            md_color_marker: "#6796e6".into(),
        }
    }
}

impl AppConfig {
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
        if !["dark", "light"].contains(&self.theme.as_str()) {
            self.theme = "dark".into();
        }
        if !THEME_PRESETS.contains(&self.theme_preset.as_str()) {
            self.theme_preset = "default".into();
        }
        if !["inline", "separate"].contains(&self.done_display.as_str()) {
            self.done_display = "inline".into();
        }
        self.dashboard_split = self.dashboard_split.clamp(20, 80);
        self.list_columns = self.list_columns.clamp(1, 12);
        self.lists_page_columns = self.lists_page_columns.clamp(1, 12);
        if self.days_page_columns == 0 {
            self.days_page_columns = self.grid_columns;
        }
        self.days_page_columns = self.days_page_columns.clamp(1, 14);
        self.calendar_daily_days = self.calendar_daily_days.min(366);
        self.calendar_weekly_weeks = self.calendar_weekly_weeks.min(52);
        self.calendar_monthly_months = self.calendar_monthly_months.min(24);
        self.calendar_yearly_years = self.calendar_yearly_years.min(5);
        self.calendar_dates_years = self.calendar_dates_years.min(5);
        self.done_hold_seconds = self.done_hold_seconds.min(30);
        self.backup_keep = self.backup_keep.min(365);
        self.ui_font_size = self.ui_font_size.clamp(10, 28);
        self.editor_font_size = self.editor_font_size.clamp(10, 28);
        if !MD_PRESETS.contains(&self.md_preset.as_str()) {
            self.md_preset = "vscode".into();
        }
        // bucket thresholds must stay strictly ordered or every rule
        // would land in one bucket
        self.cadence_monthly_min_per_year = self.cadence_monthly_min_per_year.clamp(1, 998);
        self.cadence_weekly_min_per_year = self
            .cadence_weekly_min_per_year
            .clamp(self.cadence_monthly_min_per_year + 1, 999);
        self.cadence_daily_min_per_year = self
            .cadence_daily_min_per_year
            .clamp(self.cadence_weekly_min_per_year + 1, 1000);
        self.task_gap = self.task_gap.min(48);
        self.section_gap = self.section_gap.min(48);
        self.category_block_gap = self.category_block_gap.min(48);
        // deliberately roomier than the other gaps: its point is pushing
        // Postponed/Done visibly below the active tasks
        self.done_section_gap = self.done_section_gap.min(400);
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
        sanitize_color(&mut self.done_color, defaults.done_color);
        sanitize_color(&mut self.md_color_heading, defaults.md_color_heading);
        sanitize_color(&mut self.md_color_bold, defaults.md_color_bold);
        sanitize_color(&mut self.md_color_italic, defaults.md_color_italic);
        sanitize_color(&mut self.md_color_code, defaults.md_color_code);
        sanitize_color(&mut self.md_color_link, defaults.md_color_link);
        sanitize_color(&mut self.md_color_quote, defaults.md_color_quote);
        sanitize_color(&mut self.md_color_marker, defaults.md_color_marker);
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
        sanitize_optional_color(&mut self.postponed_plate_color);
        sanitize_optional_color(&mut self.done_plate_color);
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
        self.cadence_group_order = sanitize_order(&self.cadence_group_order, CADENCE_GROUPS);
        self
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        crate::vault::write_atomic(path, &serde_yaml::to_string(self)?)?;
        Ok(())
    }

    pub fn settings_pairs(&self) -> Vec<(&'static str, String)> {
        vec![
            ("theme", self.theme.clone()),
            ("theme_preset", self.theme_preset.clone()),
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
            (
                "dashboard_today_only",
                self.dashboard_today_only.to_string(),
            ),
            ("list_columns", self.list_columns.to_string()),
            ("kb_line_numbers", self.kb_line_numbers.to_string()),
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
            ("day_header_centered", self.day_header_centered.to_string()),
            ("cadence_colors", self.cadence_colors.to_string()),
            ("cadence_color_daily", self.cadence_color_daily.clone()),
            ("cadence_color_weekly", self.cadence_color_weekly.clone()),
            ("cadence_color_monthly", self.cadence_color_monthly.clone()),
            ("cadence_color_yearly", self.cadence_color_yearly.clone()),
            ("cadence_color_exact", self.cadence_color_exact.clone()),
            ("category_color", self.category_color.clone()),
            ("done_color", self.done_color.clone()),
            ("task_gap", self.task_gap.to_string()),
            ("section_gap", self.section_gap.to_string()),
            ("category_block_gap", self.category_block_gap.to_string()),
            ("done_section_gap", self.done_section_gap.to_string()),
            ("cadence_group_order", self.cadence_group_order.join(",")),
            ("subtasks_done_last", self.subtasks_done_last.to_string()),
            ("backup_keep", self.backup_keep.to_string()),
            ("notify_system", self.notify_system.to_string()),
            ("tasks_mirror", self.tasks_mirror.to_string()),
            ("cron_weekday_labels", self.cron_weekday_labels.to_string()),
            ("cron_everyday_label", self.cron_everyday_label.to_string()),
            ("lists_sort_alpha", self.lists_sort_alpha.to_string()),
            ("lists_page_columns", self.lists_page_columns.to_string()),
            (
                "lists_page_align_rows",
                self.lists_page_align_rows.to_string(),
            ),
            ("days_page_columns", self.days_page_columns.to_string()),
            ("days_today_only", self.days_today_only.to_string()),
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
            ("list_date_chip_color", self.list_date_chip_color.clone()),
            ("cadence_color_general", self.cadence_color_general.clone()),
            ("postponed_plate_color", self.postponed_plate_color.clone()),
            ("done_plate_color", self.done_plate_color.clone()),
            ("list_exact_stripe", self.list_exact_stripe.to_string()),
            ("md_preset", self.md_preset.clone()),
            ("md_color_heading", self.md_color_heading.clone()),
            ("md_color_bold", self.md_color_bold.clone()),
            ("md_color_italic", self.md_color_italic.clone()),
            ("md_color_code", self.md_color_code.clone()),
            ("md_color_link", self.md_color_link.clone()),
            ("md_color_quote", self.md_color_quote.clone()),
            ("md_color_marker", self.md_color_marker.clone()),
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
            ..AppConfig::default()
        }
        .sanitized();
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
                "calendar",
                "history",
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
    fn partial_yaml_falls_back_to_defaults() {
        let config: AppConfig = serde_yaml::from_str("theme: light\n").unwrap();
        assert_eq!(config.theme, "light");
        assert_eq!(config.grid_columns, 7);
    }
}
