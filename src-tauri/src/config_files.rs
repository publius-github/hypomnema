//! Round-trip CRUD and validation for the task config YAML files.
//! The files are the source of truth; saving reformats them and drops
//! comments (documented trade-off, see IMPLEMENTATION_PLAN section 10).

use std::fs;
use std::path::Path;

use chrono::NaiveDate;
use croner::Cron;
use serde::{Deserialize, Serialize};

use crate::error::Result;

#[derive(Debug, Clone, Serialize)]
pub struct ConfigError {
    pub file: String,
    pub line: Option<usize>,
    pub message: String,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RecurringFile {
    #[serde(default)]
    pub(crate) tasks: Vec<RecurringRule>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecurringRule {
    pub schedule: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub items: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct ScheduledFile {
    #[serde(default)]
    pub(crate) events: Vec<ScheduledEvent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScheduledEvent {
    pub date: String,
    pub title: String,
    #[serde(default)]
    pub time: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct BirthdaysFile {
    #[serde(default)]
    pub(crate) birthdays: Vec<BirthdayEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BirthdayEntry {
    pub name: String,
    /// MM-DD
    pub date: String,
    #[serde(default)]
    pub year: Option<i32>,
}

/// "MM-DD" -> (month, day), validated to calendar ranges.
pub(crate) fn parse_mmdd(date: &str) -> Option<(u32, u32)> {
    let (m, d) = date.split_once('-')?;
    let (m, d) = (m.parse().ok()?, d.parse().ok()?);
    ((1..=12).contains(&m) && (1..=31).contains(&d)).then_some((m, d))
}

pub(crate) fn load_yaml<T: serde::de::DeserializeOwned + Default>(
    dir: &Path,
    file: &str,
    errors: &mut Vec<ConfigError>,
) -> Option<T> {
    let path = dir.join(file);
    if !path.exists() {
        return Some(T::default());
    }
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) => {
            errors.push(ConfigError {
                file: file.into(),
                line: None,
                message: e.to_string(),
            });
            return None;
        }
    };
    if raw.trim().is_empty() {
        return Some(T::default());
    }
    match serde_yaml::from_str::<T>(&raw) {
        Ok(value) => Some(value),
        Err(e) => {
            errors.push(ConfigError {
                file: file.into(),
                line: e.location().map(|l| l.line()),
                message: e.to_string(),
            });
            None
        }
    }
}

pub fn append_recurring(config_dir: &Path, mut rule: RecurringRule) -> Result<()> {
    let mut errors = Vec::new();
    let mut file = load_yaml::<RecurringFile>(config_dir, "recurring.yml", &mut errors)
        .ok_or_else(|| {
            crate::error::Error::State(format!(
                "recurring.yml is invalid, fix it before adding rules: {}",
                errors.first().map(|e| e.message.as_str()).unwrap_or("")
            ))
        })?;
    Cron::new(&rule.schedule).parse().map_err(|e| {
        crate::error::Error::State(format!("invalid cron '{}': {e}", rule.schedule))
    })?;
    rule.items.retain(|item| !item.trim().is_empty());
    if rule.items.is_empty() {
        return Err(crate::error::Error::State(
            "a recurring rule needs at least one item".into(),
        ));
    }
    file.tasks.push(rule);
    let yaml = serde_yaml::to_string(&RecurFileOut { tasks: file.tasks })?;
    crate::vault::write_atomic(&config_dir.join("recurring.yml"), &yaml)?;
    Ok(())
}

/// Quick-add write-back (req. 21-22). Note: saving reformats the file
/// and drops YAML comments; the file remains the source of truth.
pub fn append_scheduled(config_dir: &Path, event: ScheduledEvent) -> Result<()> {
    let mut errors = Vec::new();
    let mut file = load_yaml::<ScheduledFile>(config_dir, "scheduled.yml", &mut errors)
        .ok_or_else(|| {
            crate::error::Error::State(format!(
                "scheduled.yml is invalid, fix it before adding events: {}",
                errors.first().map(|e| e.message.as_str()).unwrap_or("")
            ))
        })?;
    NaiveDate::parse_from_str(&event.date, "%Y-%m-%d")
        .map_err(|_| crate::error::Error::State(format!("invalid date: {}", event.date)))?;
    file.events.push(event);
    file.events.sort_by(|a, b| a.date.cmp(&b.date));
    let yaml = serde_yaml::to_string(&SchedFileOut {
        events: file.events,
    })?;
    crate::vault::write_atomic(&config_dir.join("scheduled.yml"), &yaml)?;
    Ok(())
}

pub fn append_birthday(config_dir: &Path, entry: BirthdayEntry) -> Result<()> {
    let mut errors = Vec::new();
    let mut file = load_yaml::<BirthdaysFile>(config_dir, "birthdays.yml", &mut errors)
        .ok_or_else(|| {
            crate::error::Error::State(format!(
                "birthdays.yml is invalid, fix it before adding entries: {}",
                errors.first().map(|e| e.message.as_str()).unwrap_or("")
            ))
        })?;
    if parse_mmdd(&entry.date).is_none() {
        return Err(crate::error::Error::State(format!(
            "invalid birthday date '{}', expected MM-DD",
            entry.date
        )));
    }
    file.birthdays.push(entry);
    let yaml = serde_yaml::to_string(&BdayFileOut {
        birthdays: file.birthdays,
    })?;
    crate::vault::write_atomic(&config_dir.join("birthdays.yml"), &yaml)?;
    Ok(())
}

/// Replaces (or, with `None`, removes) the rule at `index` in file
/// order; the Recurring view lists rules unfiltered, so the index is
/// stable.
pub fn edit_recurring(
    config_dir: &Path,
    index: usize,
    replacement: Option<RecurringRule>,
) -> Result<()> {
    let mut errors = Vec::new();
    let mut file = load_yaml::<RecurringFile>(config_dir, "recurring.yml", &mut errors)
        .ok_or_else(|| {
            crate::error::Error::State(format!(
                "recurring.yml is invalid, fix it before editing rules: {}",
                errors.first().map(|e| e.message.as_str()).unwrap_or("")
            ))
        })?;
    if index >= file.tasks.len() {
        return Err(crate::error::Error::State(format!(
            "rule {} not found in recurring.yml (edited externally?)",
            index + 1
        )));
    }
    match replacement {
        Some(mut rule) => {
            Cron::new(&rule.schedule).parse().map_err(|e| {
                crate::error::Error::State(format!("invalid cron '{}': {e}", rule.schedule))
            })?;
            rule.items.retain(|item| !item.trim().is_empty());
            if rule.items.is_empty() {
                return Err(crate::error::Error::State(
                    "a recurring rule needs at least one item".into(),
                ));
            }
            file.tasks[index] = rule;
        }
        None => {
            file.tasks.remove(index);
        }
    }
    let yaml = serde_yaml::to_string(&RecurFileOut { tasks: file.tasks })?;
    crate::vault::write_atomic(&config_dir.join("recurring.yml"), &yaml)?;
    Ok(())
}

/// Replaces (or, with `None`, removes) the first entry equal to
/// `original`. Matching is by value because the Upcoming view filters
/// and sorts, so indexes do not line up with file order.
pub fn edit_scheduled(
    config_dir: &Path,
    original: ScheduledEvent,
    replacement: Option<ScheduledEvent>,
) -> Result<()> {
    let mut errors = Vec::new();
    let mut file = load_yaml::<ScheduledFile>(config_dir, "scheduled.yml", &mut errors)
        .ok_or_else(|| {
            crate::error::Error::State(format!(
                "scheduled.yml is invalid, fix it before editing events: {}",
                errors.first().map(|e| e.message.as_str()).unwrap_or("")
            ))
        })?;
    let pos = file
        .events
        .iter()
        .position(|event| *event == original)
        .ok_or_else(|| {
            crate::error::Error::State(
                "event not found in scheduled.yml (changed externally?)".into(),
            )
        })?;
    match replacement {
        Some(event) => {
            NaiveDate::parse_from_str(&event.date, "%Y-%m-%d")
                .map_err(|_| crate::error::Error::State(format!("invalid date: {}", event.date)))?;
            file.events[pos] = event;
        }
        None => {
            file.events.remove(pos);
        }
    }
    file.events.sort_by(|a, b| a.date.cmp(&b.date));
    let yaml = serde_yaml::to_string(&SchedFileOut {
        events: file.events,
    })?;
    crate::vault::write_atomic(&config_dir.join("scheduled.yml"), &yaml)?;
    Ok(())
}

pub fn edit_birthday(
    config_dir: &Path,
    original: BirthdayEntry,
    replacement: Option<BirthdayEntry>,
) -> Result<()> {
    let mut errors = Vec::new();
    let mut file = load_yaml::<BirthdaysFile>(config_dir, "birthdays.yml", &mut errors)
        .ok_or_else(|| {
            crate::error::Error::State(format!(
                "birthdays.yml is invalid, fix it before editing entries: {}",
                errors.first().map(|e| e.message.as_str()).unwrap_or("")
            ))
        })?;
    let pos = file
        .birthdays
        .iter()
        .position(|entry| *entry == original)
        .ok_or_else(|| {
            crate::error::Error::State(
                "entry not found in birthdays.yml (changed externally?)".into(),
            )
        })?;
    match replacement {
        Some(entry) => {
            if parse_mmdd(&entry.date).is_none() {
                return Err(crate::error::Error::State(format!(
                    "invalid birthday date '{}', expected MM-DD",
                    entry.date
                )));
            }
            file.birthdays[pos] = entry;
        }
        None => {
            file.birthdays.remove(pos);
        }
    }
    let yaml = serde_yaml::to_string(&BdayFileOut {
        birthdays: file.birthdays,
    })?;
    crate::vault::write_atomic(&config_dir.join("birthdays.yml"), &yaml)?;
    Ok(())
}

/// Validates the content of a task-config file without writing it.
/// Used by the Settings editor for inline validation before save.
pub fn validate_config_content(file: &str, content: &str) -> Vec<ConfigError> {
    let mut errors = Vec::new();
    let mut push_yaml_error = |e: serde_yaml::Error| {
        errors.push(ConfigError {
            file: file.into(),
            line: e.location().map(|l| l.line()),
            message: e.to_string(),
        });
    };
    if content.trim().is_empty() {
        return errors;
    }
    match file {
        "recurring.yml" => match serde_yaml::from_str::<RecurringFile>(content) {
            Ok(parsed) => {
                for (index, rule) in parsed.tasks.iter().enumerate() {
                    if let Err(e) = Cron::new(&rule.schedule).parse() {
                        errors.push(ConfigError {
                            file: file.into(),
                            line: None,
                            message: format!(
                                "rule {}: invalid cron '{}': {e}",
                                index + 1,
                                rule.schedule
                            ),
                        });
                    }
                }
            }
            Err(e) => push_yaml_error(e),
        },
        "scheduled.yml" => match serde_yaml::from_str::<ScheduledFile>(content) {
            Ok(parsed) => {
                for (index, event) in parsed.events.iter().enumerate() {
                    if NaiveDate::parse_from_str(&event.date, "%Y-%m-%d").is_err() {
                        errors.push(ConfigError {
                            file: file.into(),
                            line: None,
                            message: format!("event {}: invalid date '{}'", index + 1, event.date),
                        });
                    }
                }
            }
            Err(e) => push_yaml_error(e),
        },
        "birthdays.yml" => match serde_yaml::from_str::<BirthdaysFile>(content) {
            Ok(parsed) => {
                for (index, entry) in parsed.birthdays.iter().enumerate() {
                    if parse_mmdd(&entry.date).is_none() {
                        errors.push(ConfigError {
                            file: file.into(),
                            line: None,
                            message: format!(
                                "entry {}: invalid date '{}', expected MM-DD",
                                index + 1,
                                entry.date
                            ),
                        });
                    }
                }
            }
            Err(e) => push_yaml_error(e),
        },
        _ => {
            if let Err(e) = serde_yaml::from_str::<serde_yaml::Value>(content) {
                push_yaml_error(e);
            }
        }
    }
    errors
}

#[derive(Serialize)]
struct RecurFileOut {
    tasks: Vec<RecurringRule>,
}

#[derive(Serialize)]
struct SchedFileOut {
    events: Vec<ScheduledEvent>,
}

#[derive(Serialize)]
struct BdayFileOut {
    birthdays: Vec<BirthdayEntry>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::views::recurring_list;
    use std::path::PathBuf;

    fn dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("app-pkb-config-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn edit_and_delete_config_entries_round_trip() {
        let dir = dir("edit-entries");
        let event = ScheduledEvent {
            date: "2026-09-10".into(),
            title: "dentist".into(),
            time: None,
        };
        append_scheduled(&dir, event.clone()).unwrap();
        let updated = ScheduledEvent {
            date: "2026-09-11".into(),
            title: "dentist moved".into(),
            time: Some("10:00".into()),
        };
        edit_scheduled(&dir, event.clone(), Some(updated.clone())).unwrap();
        assert!(edit_scheduled(&dir, event, None).is_err());
        edit_scheduled(&dir, updated, None).unwrap();
        let mut errors = Vec::new();
        let file = load_yaml::<ScheduledFile>(&dir, "scheduled.yml", &mut errors).unwrap();
        assert!(file.events.is_empty());

        let entry = BirthdayEntry {
            name: "Jane".into(),
            date: "08-30".into(),
            year: None,
        };
        append_birthday(&dir, entry.clone()).unwrap();
        assert!(edit_birthday(
            &dir,
            entry.clone(),
            Some(BirthdayEntry {
                name: "Jane".into(),
                date: "99-99".into(),
                year: None,
            }),
        )
        .is_err());
        edit_birthday(&dir, entry, None).unwrap();
        let file = load_yaml::<BirthdaysFile>(&dir, "birthdays.yml", &mut errors).unwrap();
        assert!(file.birthdays.is_empty());

        append_recurring(
            &dir,
            RecurringRule {
                schedule: "0 0 * * *".into(),
                description: String::new(),
                items: vec!["x".into()],
            },
        )
        .unwrap();
        assert!(edit_recurring(
            &dir,
            0,
            Some(RecurringRule {
                schedule: "bad".into(),
                description: String::new(),
                items: vec!["x".into()],
            }),
        )
        .is_err());
        edit_recurring(
            &dir,
            0,
            Some(RecurringRule {
                schedule: "0 0 * * 1".into(),
                description: "Mondays".into(),
                items: vec!["y".into()],
            }),
        )
        .unwrap();
        assert!(edit_recurring(&dir, 5, None).is_err());
        let listed = recurring_list(&dir);
        assert_eq!(listed.rules.len(), 1);
        assert_eq!(listed.rules[0].schedule, "0 0 * * 1");
        edit_recurring(&dir, 0, None).unwrap();
        assert!(recurring_list(&dir).rules.is_empty());
    }

    #[test]
    fn validate_config_content_catches_schema_cron_and_date_errors() {
        assert!(validate_config_content(
            "recurring.yml",
            "tasks:\n  - schedule: \"0 6 * * *\"\n    items: [\"a\"]\n"
        )
        .is_empty());
        assert_eq!(
            validate_config_content(
                "recurring.yml",
                "tasks:\n  - schedule: \"nope\"\n    items: [\"a\"]\n"
            )
            .len(),
            1
        );
        let broken = validate_config_content("recurring.yml", "tasks: [\n");
        assert_eq!(broken.len(), 1);
        assert!(broken[0].line.is_some());
        assert_eq!(
            validate_config_content(
                "scheduled.yml",
                "events:\n  - date: 2026-15-01\n    title: x\n"
            )
            .len(),
            1
        );
        assert_eq!(
            validate_config_content(
                "birthdays.yml",
                "birthdays:\n  - name: x\n    date: \"31-12\"\n"
            )
            .len(),
            1
        );
        assert!(validate_config_content("day-schedule.yml", "blocks: []\n").is_empty());
    }
}
