use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct AppConfig {
    pub theme: String,
    pub grid_columns: u32,
    pub done_display: String,
    pub retention_days: u32,
    pub catchup_days: u32,
    /// Catch up recurring crons by calendar day: a firing counts as
    /// missed based on its date only, as if it fired at 23:59.
    pub cron_ignore_time: bool,
    pub kb_path: String,
    pub journal_template: String,
}

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
        }
    }
}

impl AppConfig {
    pub fn load_or_create(path: &Path) -> Result<Self> {
        if path.exists() {
            let raw = fs::read_to_string(path)?;
            Ok(serde_yaml::from_str(&raw)?)
        } else {
            let config = Self::default();
            config.save(path)?;
            Ok(config)
        }
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_yaml::to_string(self)?)?;
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

        let config = AppConfig::load_or_create(&path).unwrap();
        assert_eq!(config, AppConfig::default());
        assert!(path.exists());

        let reloaded = AppConfig::load_or_create(&path).unwrap();
        assert_eq!(reloaded, config);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn partial_yaml_falls_back_to_defaults() {
        let config: AppConfig = serde_yaml::from_str("theme: light\n").unwrap();
        assert_eq!(config.theme, "light");
        assert_eq!(config.grid_columns, 7);
    }
}
