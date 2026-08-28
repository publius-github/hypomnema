//! Read-side views over the config files: what the Upcoming, Birthdays
//! and Recurring sections render. No generation happens here.

use std::path::Path;

use chrono::{DateTime, Datelike, Duration, Local, Months, NaiveDate};
use croner::Cron;
use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::config::AppConfig;
use crate::config_files::{
    load_yaml, parse_mmdd, BirthdaysFile, ConfigError, RecurringFile, RecurringRule,
    ScheduledEvent, ScheduledFile,
};
use crate::engine::{cadence_of, parse_item, scheduled_rule_key};
use crate::error::Result;

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct RecurringResult {
    pub rules: Vec<RecurringRule>,
    pub errors: Vec<ConfigError>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct UpcomingResult {
    pub events: Vec<ScheduledEvent>,
    pub errors: Vec<ConfigError>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct BirthdayView {
    pub name: String,
    pub date: String,
    pub year: Option<i32>,
    pub next_occurrence: String,
    #[ts(type = "number")]
    pub days_until: i64,
    pub turns: Option<i32>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
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

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct OutlookEvent {
    pub date: String,
    pub title: String,
    /// "daily" | "weekly" | "monthly" | "yearly" | "date" | "birthday"
    pub kind: String,
}

/// Calendar projection: occurrences that lie beyond the grid horizon
/// (so no task exists yet) but inside the per-cadence outlook window
/// from the config. Nothing is generated; this is a read-only preview.
pub fn calendar_outlook(
    config_dir: &Path,
    config: &AppConfig,
    from: NaiveDate,
    to: NaiveDate,
    now: DateTime<Local>,
) -> Vec<OutlookEvent> {
    let today = now.date_naive();
    // dates up to the horizon are materialized as real tasks and would
    // show twice; the projection starts right after it
    let horizon = today + Duration::days(i64::from(config.grid_columns.max(1)) - 1);
    let add_months = |months: u32| {
        today
            .checked_add_months(Months::new(months))
            .unwrap_or(today)
    };
    let mut events = Vec::new();
    let mut errors = Vec::new();

    if let Some(file) = load_yaml::<RecurringFile>(config_dir, "recurring.yml", &mut errors) {
        for rule in &file.tasks {
            let Ok(cron) = Cron::new(&rule.schedule).parse() else {
                continue;
            };
            let cadence = cadence_of(&cron, now);
            let cap = match cadence {
                "daily" => today + Duration::days(i64::from(config.calendar_daily_days)),
                "weekly" => today + Duration::days(i64::from(config.calendar_weekly_weeks) * 7),
                "monthly" => add_months(config.calendar_monthly_months),
                _ => add_months(config.calendar_yearly_years * 12),
            };
            let end = cap.min(to);
            let mut cursor = now;
            for _ in 0..500 {
                let Ok(firing) = cron.find_next_occurrence(&cursor, false) else {
                    break;
                };
                cursor = firing;
                let date = firing.date_naive();
                if date > end {
                    break;
                }
                if date <= horizon || date < from {
                    continue;
                }
                let date_str = date.format("%Y-%m-%d").to_string();
                for item in &rule.items {
                    let (_, title) = parse_item(item);
                    events.push(OutlookEvent {
                        date: date_str.clone(),
                        title,
                        kind: cadence.to_string(),
                    });
                }
            }
        }
    }

    let dates_cap = add_months(config.calendar_dates_years * 12);
    if let Some(file) = load_yaml::<ScheduledFile>(config_dir, "scheduled.yml", &mut errors) {
        for event in &file.events {
            let Ok(date) = NaiveDate::parse_from_str(&event.date, "%Y-%m-%d") else {
                continue;
            };
            if date > horizon && date >= from && date <= to.min(dates_cap) {
                let (_, title) = parse_item(&event.title);
                events.push(OutlookEvent {
                    date: event.date.clone(),
                    title,
                    kind: "date".into(),
                });
            }
        }
    }

    if let Some(file) = load_yaml::<BirthdaysFile>(config_dir, "birthdays.yml", &mut errors) {
        for entry in &file.birthdays {
            let Some((month, day)) = parse_mmdd(&entry.date) else {
                continue;
            };
            for year in today.year()..=to.year() {
                let occurrence = NaiveDate::from_ymd_opt(year, month, day).or_else(|| {
                    if month == 2 && day == 29 {
                        NaiveDate::from_ymd_opt(year, 2, 28)
                    } else {
                        None
                    }
                });
                let Some(occurrence) = occurrence else {
                    continue;
                };
                if occurrence > horizon && occurrence >= from && occurrence <= to.min(dates_cap) {
                    let title = match entry.year {
                        Some(birth_year) => {
                            format!("Birthday: {} (turns {})", entry.name, year - birth_year)
                        }
                        None => format!("Birthday: {}", entry.name),
                    };
                    events.push(OutlookEvent {
                        date: occurrence.format("%Y-%m-%d").to_string(),
                        title,
                        kind: "birthday".into(),
                    });
                }
            }
        }
    }

    events.sort_by(|a, b| a.date.cmp(&b.date).then(a.title.cmp(&b.title)));
    events
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::fs;

    #[test]
    fn outlook_projects_beyond_horizon_within_cadence_caps() {
        let dir = std::env::temp_dir().join("app-pkb-views-outlook");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 0 * * *\"\n    items:\n      - \"{Home} water\"\n  - schedule: \"0 0 * * 1\"\n    items:\n      - \"weekly review\"\n",
        )
        .unwrap();
        fs::write(
            dir.join("scheduled.yml"),
            "events:\n  - date: 2026-09-20\n    title: \"dentist\"\n  - date: 2028-01-01\n    title: \"too far\"\n",
        )
        .unwrap();
        fs::write(
            dir.join("birthdays.yml"),
            "birthdays:\n  - name: \"Jane\"\n    date: \"10-05\"\n",
        )
        .unwrap();
        let config = AppConfig {
            grid_columns: 7,
            calendar_daily_days: 10,
            calendar_weekly_weeks: 3,
            ..AppConfig::default()
        };
        // Friday 2026-08-28; grid horizon ends 2026-09-03
        let now = Local
            .from_local_datetime(
                &"2026-08-28T12:00:00"
                    .parse::<chrono::NaiveDateTime>()
                    .unwrap(),
            )
            .unwrap();
        let from = NaiveDate::from_ymd_opt(2026, 8, 1).unwrap();
        let to = NaiveDate::from_ymd_opt(2026, 12, 31).unwrap();
        let events = calendar_outlook(&dir, &config, from, to, now);

        // daily: only 09-04..09-07 (after horizon, within 10 days)
        let daily: Vec<&str> = events
            .iter()
            .filter(|e| e.kind == "daily")
            .map(|e| e.date.as_str())
            .collect();
        assert_eq!(
            daily,
            vec!["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"]
        );
        assert!(events.iter().all(|e| e.title != "{Home} water"));

        // weekly Mondays within 3 weeks: 09-07, 09-14 (09-18 is the cap)
        let weekly: Vec<&str> = events
            .iter()
            .filter(|e| e.kind == "weekly")
            .map(|e| e.date.as_str())
            .collect();
        assert_eq!(weekly, vec!["2026-09-07", "2026-09-14"]);

        // one-off date within a year shows; the 2028 one does not
        assert!(events
            .iter()
            .any(|e| e.kind == "date" && e.date == "2026-09-20"));
        assert!(!events.iter().any(|e| e.title == "too far"));

        // birthday projected at its next occurrence
        assert!(events
            .iter()
            .any(|e| e.kind == "birthday" && e.date == "2026-10-05"));
        let _ = fs::remove_dir_all(&dir);
    }
}
