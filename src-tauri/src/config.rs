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
    pub journal_template: String,
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
}

pub const SECTIONS: &[&str] = &["dashboard", "upcoming", "calendar", "journal", "kb"];

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
            journal_template: "journal/templates/daily.md".into(),
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
        // unknown names are dropped, missing sections come back in their
        // default position, so a typo can never lose a tab
        let mut order: Vec<String> = Vec::new();
        for name in &self.section_order {
            if SECTIONS.contains(&name.as_str()) && !order.contains(name) {
                order.push(name.clone());
            }
        }
        for name in SECTIONS {
            if !order.iter().any(|o| o == name) {
                order.push((*name).to_string());
            }
        }
        self.section_order = order;
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
            ("journal_template", self.journal_template.clone()),
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
            vec!["kb", "dashboard", "upcoming", "calendar", "journal"]
        );
    }

    #[test]
    fn partial_yaml_falls_back_to_defaults() {
        let config: AppConfig = serde_yaml::from_str("theme: light\n").unwrap();
        assert_eq!(config.theme, "light");
        assert_eq!(config.grid_columns, 7);
    }
}
