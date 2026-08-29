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
    load_extras, load_yaml, parse_mmdd, BirthdaysFile, ConfigError, RecurringFile, ScheduledFile,
};
use crate::engine::{cadence_of, parse_item, scheduled_rule_key};
use crate::error::Result;

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct RecurringRuleView {
    pub schedule: String,
    pub description: String,
    pub items: Vec<String>,
    /// file the rule lives in, relative to config/; only rules from the
    /// root recurring.yml are editable through the UI
    pub source: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct RecurringResult {
    pub rules: Vec<RecurringRuleView>,
    pub errors: Vec<ConfigError>,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct UpcomingEventView {
    pub date: String,
    pub title: String,
    pub time: Option<String>,
    pub source: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct UpcomingResult {
    pub events: Vec<UpcomingEventView>,
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
    pub source: String,
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
) -> Result<(Vec<UpcomingEventView>, Vec<ConfigError>)> {
    let mut errors = Vec::new();
    let Some(root) = load_yaml::<ScheduledFile>(config_dir, "scheduled.yml", &mut errors) else {
        return Ok((vec![], errors));
    };
    let mut sources: Vec<(String, ScheduledFile)> = vec![("scheduled.yml".into(), root)];
    sources.extend(load_extras::<ScheduledFile>(
        config_dir,
        "events",
        &mut errors,
    ));
    let mut pending = Vec::new();
    for (source, file) in sources {
        for event in file.events {
            let rule_key = scheduled_rule_key(&event);
            let materialized: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM rule_runs WHERE rule_key = ?1 AND period_key = ?2)",
                (&rule_key, &event.date),
                |row| row.get(0),
            )?;
            if !materialized {
                pending.push(UpcomingEventView {
                    date: event.date,
                    title: event.title,
                    time: event.time,
                    source: source.clone(),
                });
            }
        }
    }
    pending.sort_by(|a, b| a.date.cmp(&b.date));
    Ok((pending, errors))
}

fn next_birthday_occurrence(month: u32, day: u32, today: NaiveDate) -> Option<NaiveDate> {
    for year in [today.year(), today.year() + 1] {
        let occurrence = crate::config_files::birthday_occurrence(year, month, day)?;
        if occurrence >= today {
            return Some(occurrence);
        }
    }
    None
}

/// All birthday entries with their next occurrence, sorted by it.
pub fn birthdays_list(config_dir: &Path, today: NaiveDate) -> BirthdaysResult {
    let mut errors = Vec::new();
    let root =
        load_yaml::<BirthdaysFile>(config_dir, "birthdays.yml", &mut errors).unwrap_or_default();
    let mut sources: Vec<(String, BirthdaysFile)> = vec![("birthdays.yml".into(), root)];
    sources.extend(load_extras::<BirthdaysFile>(
        config_dir,
        "birthdays",
        &mut errors,
    ));
    let mut birthdays = Vec::new();
    for (source, file) in sources {
        for entry in file.birthdays {
            let occurrence =
                parse_mmdd(&entry.date).and_then(|(m, d)| next_birthday_occurrence(m, d, today));
            let Some(occurrence) = occurrence else {
                errors.push(ConfigError {
                    file: source.clone(),
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
                source: source.clone(),
            });
        }
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

/// A display label for the day-of-week field of a cron schedule, when
/// the rule pins concrete weekdays ("0 9 * * SAT#1" -> "SAT1",
/// "0 9 * * 1-5" -> "MON-FRI"). Wildcards and steps return None.
pub(crate) fn weekday_label(schedule: &str) -> Option<String> {
    let field = schedule.split_whitespace().last()?;
    if field.contains('*') || field == "?" || field.is_empty() {
        return None;
    }
    fn map_days(part: &str) -> String {
        const NAMES: [&str; 8] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
        let mut out = String::new();
        for token in part.split_inclusive([',', '-', '/']) {
            let (name, sep) = match token.char_indices().last() {
                Some((i, c)) if matches!(c, ',' | '-' | '/') => (&token[..i], Some(c)),
                _ => (token, None),
            };
            match name.parse::<usize>() {
                Ok(n) if n < NAMES.len() => out.push_str(NAMES[n]),
                _ => out.push_str(&name.to_uppercase()),
            }
            if let Some(c) = sep {
                out.push(c);
            }
        }
        out
    }
    // "SAT#1" / "6#1": the nth-occurrence number stays a number
    let (days, nth) = match field.split_once('#') {
        Some((days, nth)) => (days, Some(nth)),
        None => (field, None),
    };
    let mut label = map_days(days);
    if let Some(nth) = nth {
        label.push_str(nth);
    }
    Some(label)
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
    // Deliberately not returned: every load error possible here is also
    // raised by the engine pass (same files, same loaders) and reaches
    // the UI through the config-errors banner; the projection just
    // skips what it cannot read.
    let mut errors = Vec::new();

    let mut recurring: Vec<(String, RecurringFile)> = Vec::new();
    if let Some(root) = load_yaml::<RecurringFile>(config_dir, "recurring.yml", &mut errors) {
        recurring.push(("recurring.yml".into(), root));
    }
    recurring.extend(load_extras::<RecurringFile>(
        config_dir,
        "tasks",
        &mut errors,
    ));
    {
        for rule in recurring.iter().flat_map(|(_, f)| f.tasks.iter()) {
            let Ok(cron) = Cron::new(&rule.schedule).parse() else {
                continue;
            };
            let cadence = cadence_of(&cron, now);
            // rules pinned to concrete weekdays carry a [SAT1]-style
            // marker so a projected entry says which weekday rule it is
            let dow = if config.cron_weekday_labels {
                weekday_label(&rule.schedule)
            } else {
                None
            };
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
                    let title = match &dow {
                        Some(label) => format!("[{label}] {title}"),
                        None => title,
                    };
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
    let mut scheduled: Vec<(String, ScheduledFile)> = Vec::new();
    if let Some(root) = load_yaml::<ScheduledFile>(config_dir, "scheduled.yml", &mut errors) {
        scheduled.push(("scheduled.yml".into(), root));
    }
    scheduled.extend(load_extras::<ScheduledFile>(
        config_dir,
        "events",
        &mut errors,
    ));
    {
        for event in scheduled.iter().flat_map(|(_, f)| f.events.iter()) {
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

    let mut bdays: Vec<(String, BirthdaysFile)> = Vec::new();
    if let Some(root) = load_yaml::<BirthdaysFile>(config_dir, "birthdays.yml", &mut errors) {
        bdays.push(("birthdays.yml".into(), root));
    }
    bdays.extend(load_extras::<BirthdaysFile>(
        config_dir,
        "birthdays",
        &mut errors,
    ));
    {
        for entry in bdays.iter().flat_map(|(_, f)| f.birthdays.iter()) {
            let Some((month, day)) = parse_mmdd(&entry.date) else {
                continue;
            };
            for year in today.year()..=to.year() {
                let occurrence = crate::config_files::birthday_occurrence(year, month, day);
                let Some(occurrence) = occurrence else {
                    continue;
                };
                if occurrence > horizon && occurrence >= from && occurrence <= to.min(dates_cap) {
                    let title = crate::config_files::birthday_title(&entry.name, entry.year, year);
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

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct DailyStreak {
    pub title: String,
    #[ts(type = "number")]
    pub streak: u32,
    pub done_today: bool,
}

/// Current done-streak per daily recurring rule: consecutive done
/// instances counted from the newest backwards. Instances, not calendar
/// days, so a MON-FRI daily is not broken by the weekend. Today's
/// still-open instance neither counts nor breaks the streak. Retention
/// pruning caps how far back a streak can reach.
pub fn daily_streaks(conn: &Connection, today: NaiveDate) -> Result<Vec<DailyStreak>> {
    let today_str = today.format("%Y-%m-%d").to_string();
    let mut stmt = conn.prepare(
        "SELECT rule_key, title, scheduled_date, status FROM tasks
         WHERE origin = 'recurring' AND cadence = 'daily'
           AND archived_at IS NULL AND parent_task_id IS NULL
           AND rule_key IS NOT NULL AND scheduled_date IS NOT NULL
           AND scheduled_date <= ?1
         ORDER BY rule_key, scheduled_date DESC",
    )?;
    let rows = stmt.query_map([&today_str], |row| {
        Ok((
            row.get::<_, String>("rule_key")?,
            row.get::<_, String>("title")?,
            row.get::<_, String>("scheduled_date")?,
            row.get::<_, String>("status")?,
        ))
    })?;
    let mut out: Vec<DailyStreak> = Vec::new();
    // (rule_key, accumulator, streak already broken)
    let mut current: Option<(String, DailyStreak, bool)> = None;
    for row in rows {
        let (rule, title, date, status) = row?;
        if current
            .as_ref()
            .map(|(key, _, _)| key != &rule)
            .unwrap_or(true)
        {
            if let Some((_, streak, _)) = current.take() {
                out.push(streak);
            }
            // the newest instance carries the current config title
            current = Some((
                rule,
                DailyStreak {
                    title,
                    streak: 0,
                    done_today: false,
                },
                false,
            ));
        }
        let (_, acc, broken) = current.as_mut().expect("just set");
        let done = status == "done";
        if date == today_str {
            acc.done_today = done;
            if done {
                acc.streak += 1;
            }
            continue;
        }
        if *broken {
            continue;
        }
        if done {
            acc.streak += 1;
        } else {
            *broken = true;
        }
    }
    if let Some((_, streak, _)) = current.take() {
        out.push(streak);
    }
    out.sort_by(|a, b| b.streak.cmp(&a.streak).then(a.title.cmp(&b.title)));
    Ok(out)
}

/// All recurring rules with cron validation errors surfaced, so the
/// Recurring view shows broken rules next to working ones.
pub fn recurring_list(config_dir: &Path) -> RecurringResult {
    let mut errors = Vec::new();
    let root =
        load_yaml::<RecurringFile>(config_dir, "recurring.yml", &mut errors).unwrap_or_default();
    let mut sources: Vec<(String, RecurringFile)> = vec![("recurring.yml".into(), root)];
    sources.extend(load_extras::<RecurringFile>(
        config_dir,
        "tasks",
        &mut errors,
    ));
    let mut rules = Vec::new();
    for (source, file) in sources {
        for (index, rule) in file.tasks.into_iter().enumerate() {
            if let Err(e) = Cron::new(&rule.schedule).parse() {
                errors.push(ConfigError {
                    file: source.clone(),
                    line: None,
                    message: format!(
                        "rule {} ('{}'): invalid cron '{}': {e}",
                        index + 1,
                        rule.description,
                        rule.schedule
                    ),
                });
            }
            rules.push(RecurringRuleView {
                schedule: rule.schedule,
                description: rule.description,
                items: rule.items,
                source: source.clone(),
            });
        }
    }
    RecurringResult { rules, errors }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::fs;

    #[test]
    fn weekday_label_only_for_concrete_days() {
        assert_eq!(weekday_label("0 9 * * SAT#1").as_deref(), Some("SAT1"));
        assert_eq!(weekday_label("0 9 * * 6#1").as_deref(), Some("SAT1"));
        assert_eq!(weekday_label("0 9 * * 1-5").as_deref(), Some("MON-FRI"));
        assert_eq!(weekday_label("0 9 * * mon,fri").as_deref(), Some("MON,FRI"));
        assert_eq!(weekday_label("0 9 * * *"), None);
        assert_eq!(weekday_label("0 9 1 * ?"), None);
        assert_eq!(weekday_label("0 9 * * */2"), None);
    }

    #[test]
    fn daily_streaks_count_consecutive_done_instances() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        let insert = |rule: &str, title: &str, date: &str, status: &str| {
            conn.execute(
                "INSERT INTO tasks (title, created_at, origin, cadence, rule_key,
                                    period_key, scheduled_date, status)
                 VALUES (?1, 'x', 'recurring', 'daily', ?2, ?3, ?3, ?4)",
                (title, rule, date, status),
            )
            .unwrap();
        };
        // MON-FRI style rule: no weekend instances, streak spans the gap
        insert("r1", "water plants", "2026-08-28", "done"); // Fri
        insert("r1", "water plants", "2026-08-27", "done");
        insert("r1", "water plants", "2026-08-26", "todo"); // breaks here
        insert("r1", "water plants", "2026-08-25", "done");
        // second rule: today open (does not break), yesterday done
        insert("r2", "journal", "2026-08-31", "todo"); // today
        insert("r2", "journal", "2026-08-30", "done");

        let today = NaiveDate::from_ymd_opt(2026, 8, 31).unwrap();
        let streaks = daily_streaks(&conn, today).unwrap();
        assert_eq!(streaks.len(), 2);
        assert_eq!(streaks[0].title, "water plants");
        assert_eq!(streaks[0].streak, 2);
        assert!(!streaks[0].done_today);
        assert_eq!(streaks[1].title, "journal");
        assert_eq!(streaks[1].streak, 1);
        assert!(!streaks[1].done_today);
    }

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
