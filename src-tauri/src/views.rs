//! Read-side views over the config files: what the Upcoming, Birthdays
//! and Recurring sections render. No generation happens here.

use std::path::Path;

use chrono::{Datelike, NaiveDate};
use croner::Cron;
use rusqlite::Connection;
use serde::Serialize;

use crate::config_files::{
    load_yaml, parse_mmdd, BirthdaysFile, ConfigError, RecurringFile, RecurringRule,
    ScheduledEvent, ScheduledFile,
};
use crate::engine::scheduled_rule_key;
use crate::error::Result;

#[derive(Debug, Serialize)]
pub struct RecurringResult {
    pub rules: Vec<RecurringRule>,
    pub errors: Vec<ConfigError>,
}

#[derive(Debug, Serialize)]
pub struct UpcomingResult {
    pub events: Vec<ScheduledEvent>,
    pub errors: Vec<ConfigError>,
}

#[derive(Debug, Serialize)]
pub struct BirthdayView {
    pub name: String,
    pub date: String,
    pub year: Option<i32>,
    pub next_occurrence: String,
    pub days_until: i64,
    pub turns: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct BirthdaysResult {
    pub birthdays: Vec<BirthdayView>,
    pub errors: Vec<ConfigError>,
}

/// Future scheduled events still waiting in the Upcoming list: entries
/// whose (rule, period) has not been materialized yet.
pub fn upcoming_events(
    conn: &Connection,
    config_dir: &Path,
) -> Result<(Vec<ScheduledEvent>, Vec<ConfigError>)> {
    let mut errors = Vec::new();
    let Some(file) = load_yaml::<ScheduledFile>(config_dir, "scheduled.yml", &mut errors) else {
        return Ok((vec![], errors));
    };
    let mut pending = Vec::new();
    for event in file.events {
        let rule_key = scheduled_rule_key(&event);
        let materialized: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM rule_runs WHERE rule_key = ?1 AND period_key = ?2)",
            (&rule_key, &event.date),
            |row| row.get(0),
        )?;
        if !materialized {
            pending.push(event);
        }
    }
    pending.sort_by(|a, b| a.date.cmp(&b.date));
    Ok((pending, errors))
}

fn next_birthday_occurrence(month: u32, day: u32, today: NaiveDate) -> Option<NaiveDate> {
    for year in [today.year(), today.year() + 1] {
        let occurrence = NaiveDate::from_ymd_opt(year, month, day).or_else(|| {
            if month == 2 && day == 29 {
                NaiveDate::from_ymd_opt(year, 2, 28)
            } else {
                None
            }
        })?;
        if occurrence >= today {
            return Some(occurrence);
        }
    }
    None
}

/// All birthday entries with their next occurrence, sorted by it.
pub fn birthdays_list(config_dir: &Path, today: NaiveDate) -> BirthdaysResult {
    let mut errors = Vec::new();
    let file =
        load_yaml::<BirthdaysFile>(config_dir, "birthdays.yml", &mut errors).unwrap_or_default();
    let mut birthdays = Vec::new();
    for entry in file.birthdays {
        let occurrence =
            parse_mmdd(&entry.date).and_then(|(m, d)| next_birthday_occurrence(m, d, today));
        let Some(occurrence) = occurrence else {
            errors.push(ConfigError {
                file: "birthdays.yml".into(),
                line: None,
                message: format!("entry '{}': invalid date '{}'", entry.name, entry.date),
            });
            continue;
        };
        birthdays.push(BirthdayView {
            turns: entry.year.map(|y| occurrence.year() - y),
            next_occurrence: occurrence.format("%Y-%m-%d").to_string(),
            days_until: (occurrence - today).num_days(),
            name: entry.name,
            date: entry.date,
            year: entry.year,
        });
    }
    birthdays.sort_by(|a, b| a.next_occurrence.cmp(&b.next_occurrence));
    BirthdaysResult { birthdays, errors }
}

/// All recurring rules with cron validation errors surfaced, so the
/// Recurring view shows broken rules next to working ones.
pub fn recurring_list(config_dir: &Path) -> RecurringResult {
    let mut errors = Vec::new();
    let file =
        load_yaml::<RecurringFile>(config_dir, "recurring.yml", &mut errors).unwrap_or_default();
    for (index, rule) in file.tasks.iter().enumerate() {
        if let Err(e) = Cron::new(&rule.schedule).parse() {
            errors.push(ConfigError {
                file: "recurring.yml".into(),
                line: None,
                message: format!(
                    "rule {} ('{}'): invalid cron '{}': {e}",
                    index + 1,
                    rule.description,
                    rule.schedule
                ),
            });
        }
    }
    RecurringResult {
        rules: file.tasks,
        errors,
    }
}
