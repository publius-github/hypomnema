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
    /// Extra vertical spacing before each cadence group in day columns.
    pub cadence_group_gap: bool,
    /// Extra vertical spacing between {Category} blocks inside a
    /// section of a day column.
    pub category_gap: bool,
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
}

pub const SECTIONS: &[&str] = &[
    "dashboard",
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
            done_hold_seconds: 3,
            day_header_centered: false,
            cadence_colors: true,
            cadence_color_daily: "#9ca3af".into(),
            cadence_color_weekly: "#3b82f6".into(),
            cadence_color_monthly: "#a855f7".into(),
            cadence_color_yearly: "#f59e0b".into(),
            cadence_color_exact: "#0ea5e9".into(),
            category_color: "#3b82f6".into(),
            cadence_group_gap: true,
            category_gap: true,
            cadence_group_order: CADENCE_GROUPS.iter().map(|s| s.to_string()).collect(),
            subtasks_done_last: true,
            backup_keep: 14,
            notify_system: true,
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
        if !["inline", "separate"].contains(&self.done_display.as_str()) {
            self.done_display = "inline".into();
        }
        self.dashboard_split = self.dashboard_split.clamp(20, 80);
        self.list_columns = self.list_columns.clamp(1, 12);
        self.calendar_daily_days = self.calendar_daily_days.min(366);
        self.calendar_weekly_weeks = self.calendar_weekly_weeks.min(52);
        self.calendar_monthly_months = self.calendar_monthly_months.min(24);
        self.calendar_yearly_years = self.calendar_yearly_years.min(5);
        self.calendar_dates_years = self.calendar_dates_years.min(5);
        self.done_hold_seconds = self.done_hold_seconds.min(30);
        self.backup_keep = self.backup_keep.min(365);
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
            ("done_hold_seconds", self.done_hold_seconds.to_string()),
            ("day_header_centered", self.day_header_centered.to_string()),
            ("cadence_colors", self.cadence_colors.to_string()),
            ("cadence_color_daily", self.cadence_color_daily.clone()),
            ("cadence_color_weekly", self.cadence_color_weekly.clone()),
            ("cadence_color_monthly", self.cadence_color_monthly.clone()),
            ("cadence_color_yearly", self.cadence_color_yearly.clone()),
            ("cadence_color_exact", self.cadence_color_exact.clone()),
            ("category_color", self.category_color.clone()),
            ("cadence_group_gap", self.cadence_group_gap.to_string()),
            ("category_gap", self.category_gap.to_string()),
            ("cadence_group_order", self.cadence_group_order.join(",")),
            ("subtasks_done_last", self.subtasks_done_last.to_string()),
            ("backup_keep", self.backup_keep.to_string()),
            ("notify_system", self.notify_system.to_string()),
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
