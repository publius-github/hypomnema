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
use crate::engine::{cadence_of, parse_item, recurring_rule_key, scheduled_rule_key};
use crate::error::Result;

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct RecurringRuleView {
    pub schedule: String,
    pub description: String,
    pub items: Vec<String>,
    /// the rule's own rate alert threshold, percent; None = the default
    /// from config.habit_rate_threshold
    pub threshold: Option<u32>,
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

/// Scheduled events still pending in the Upcoming list: entries whose
/// (rule, period) has not been materialized yet, plus materialized ones
/// whose task is still open - a passed date does not close the item,
/// only checking it done (or deleting it) does.
pub fn upcoming_events(
    conn: &Connection,
    config_dir: &Path,
    today: NaiveDate,
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
            let still_open = materialized
                && conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM tasks
                                   WHERE rule_key = ?1 AND period_key = ?2
                                     AND archived_at IS NULL AND parent_task_id IS NULL
                                     AND status NOT IN ('done', 'dropped'))",
                    (&rule_key, &event.date),
                    |row| row.get(0),
                )?;
            if !materialized || still_open {
                // shown and sorted as a zero-padded string like the
                // engine stores it; an unpadded YAML date stays readable
                let date = NaiveDate::parse_from_str(&event.date, "%Y-%m-%d")
                    .map(|d| d.format("%Y-%m-%d").to_string())
                    .unwrap_or(event.date);
                pending.push(UpcomingEventView {
                    date,
                    title: event.title,
                    time: event.time,
                    source: source.clone(),
                });
            }
        }
    }
    // Dated manual list tasks count as one-off events too: they show
    // here read-only (the task dialog is where they are edited) and
    // disappear once done, like a materialized event. Priority pins are
    // excluded - their today-date is an artifact of starring.
    let mut stmt = conn.prepare(
        "SELECT t.scheduled_date, t.title, t.time, l.name
         FROM tasks t JOIN lists l ON l.id = t.list_id
         WHERE t.origin = 'manual' AND t.archived_at IS NULL
           AND t.parent_task_id IS NULL AND t.status NOT IN ('done', 'dropped')
           AND t.priority = 0 AND t.scheduled_date >= ?1",
    )?;
    let list_tasks = stmt
        .query_map([today.format("%Y-%m-%d").to_string()], |row| {
            Ok(UpcomingEventView {
                date: row.get(0)?,
                title: row.get(1)?,
                time: row.get(2)?,
                source: format!("list \"{}\"", row.get::<_, String>(3)?),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    pending.extend(list_tasks);
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
/// the rule pins concrete weekdays ("0 9 * * SAT#1" -> "SAT#1",
/// "0 9 * * 1-5" -> "MON-FRI"). Wildcards and steps return None, and so
/// does a schedule that also restricts the day-of-month: cron ORs the
/// two fields, so such a rule fires on other weekdays too and a weekday
/// marker would lie.
pub(crate) fn weekday_label(schedule: &str) -> Option<String> {
    let fields: Vec<&str> = schedule.split_whitespace().collect();
    let field = *fields.last()?;
    let unrestricted = |f: &str| f == "*" || f == "?";
    let dom_unrestricted = if fields.len() >= 3 {
        unrestricted(fields[fields.len() - 3])
    } else {
        true
    };
    // a rule free on both day fields fires every day: the EVERYDAY
    // marker (display gated by config.cron_everyday_label)
    if unrestricted(field) {
        return dom_unrestricted.then(|| "EVERYDAY".to_string());
    }
    if field.contains('*') || field.is_empty() {
        return None;
    }
    if !dom_unrestricted {
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
    // "SAT#1" / "6#1": keep the crontab spelling with the '#'
    let (days, nth) = match field.split_once('#') {
        Some((days, nth)) => (days, Some(nth)),
        None => (field, None),
    };
    let mut label = map_days(days);
    if let Some(nth) = nth {
        label.push('#');
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
    let horizon = today + Duration::days(i64::from(config.horizon_days()) - 1);
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
            let cadence = cadence_of(&cron, now, config);
            // rules pinned to concrete weekdays carry a [SAT#1]-style
            // marker so a projected entry says which weekday rule it is
            let dow = if config.cron_weekday_labels {
                weekday_label(&rule.schedule)
                    .filter(|l| l != "EVERYDAY" || config.cron_everyday_label)
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
            // runaway guard: a multi-firings-per-day cron over the
            // widest 366-day window stays well under this
            for _ in 0..5000 {
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
                    date: date.format("%Y-%m-%d").to_string(),
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

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct HabitRate {
    pub rule_key: String,
    #[ts(type = "number")]
    pub done: u32,
    /// settled instances counted, the rate's denominator
    #[ts(type = "number")]
    pub total: u32,
    /// done share in whole percent, rounded down so a rate shown as 80%
    /// is never one that alerts at an 80% threshold
    #[ts(type = "number")]
    pub rate: u32,
    /// effective threshold: the rule's own, else the config default
    #[ts(type = "number")]
    pub threshold: u32,
    /// rate is below the threshold
    pub alert: bool,
}

/// Completion rate per recurring rule item (one `rule_key` each), over
/// its newest `habit_rate_window` settled instances. Settled means:
/// done or waiting (done on the user's side) counts as done; dropped
/// counts as not done; a daily instance still open after its day counts
/// as not done too, since dailies never carry over. An open instance of
/// any other cadence is still live work (it carries over as overdue),
/// so it waits until it is closed. Items with fewer than
/// `habit_rate_min_instances` settled instances get no rate.
pub fn habit_rates(
    conn: &Connection,
    config_dir: &Path,
    config: &AppConfig,
    today: NaiveDate,
) -> Result<Vec<HabitRate>> {
    let mut thresholds = std::collections::HashMap::new();
    let mut errors = Vec::new();
    let mut sources = vec![
        load_yaml::<RecurringFile>(config_dir, "recurring.yml", &mut errors).unwrap_or_default(),
    ];
    sources.extend(
        load_extras::<RecurringFile>(config_dir, "tasks", &mut errors)
            .into_iter()
            .map(|(_, file)| file),
    );
    for rule in sources.iter().flat_map(|file| &file.tasks) {
        if let Some(threshold) = rule.threshold {
            for item in &rule.items {
                thresholds.insert(recurring_rule_key(rule, item), threshold.min(100));
            }
        }
    }

    let today_str = today.format("%Y-%m-%d").to_string();
    let mut stmt = conn.prepare(
        "SELECT rule_key, status, cadence,
                COALESCE(origin_date, scheduled_date) AS day
         FROM tasks
         WHERE origin = 'recurring' AND rule_key IS NOT NULL
           AND archived_at IS NULL AND parent_task_id IS NULL
         ORDER BY rule_key, day DESC, id DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>("rule_key")?,
            row.get::<_, String>("status")?,
            row.get::<_, Option<String>>("cadence")?,
            row.get::<_, Option<String>>("day")?,
        ))
    })?;
    let window = config.habit_rate_window;
    let mut counts: Vec<(String, u32, u32)> = Vec::new();
    for row in rows {
        let (rule_key, status, cadence, day) = row?;
        let done = match status.as_str() {
            "done" | "waiting" => true,
            "dropped" => false,
            _ if cadence.as_deref() == Some("daily")
                && day.as_deref().is_some_and(|d| d < today_str.as_str()) =>
            {
                false
            }
            _ => continue,
        };
        if counts
            .last()
            .map(|(key, _, _)| key != &rule_key)
            .unwrap_or(true)
        {
            counts.push((rule_key, 0, 0));
        }
        let (_, hits, total) = counts.last_mut().expect("just pushed");
        if window > 0 && *total >= window {
            continue;
        }
        *total += 1;
        if done {
            *hits += 1;
        }
    }
    Ok(counts
        .into_iter()
        .filter(|(_, _, total)| *total >= config.habit_rate_min_instances.max(1))
        .map(|(rule_key, done, total)| {
            let threshold = thresholds
                .get(&rule_key)
                .copied()
                .unwrap_or(config.habit_rate_threshold);
            HabitRate {
                alert: done * 100 < threshold * total,
                rate: done * 100 / total,
                threshold,
                rule_key,
                done,
                total,
            }
        })
        .collect())
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
                threshold: rule.threshold,
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
        assert_eq!(weekday_label("0 9 * * SAT#1").as_deref(), Some("SAT#1"));
        assert_eq!(weekday_label("0 9 * * 6#1").as_deref(), Some("SAT#1"));
        assert_eq!(weekday_label("0 9 * * 1-5").as_deref(), Some("MON-FRI"));
        assert_eq!(weekday_label("0 9 * * mon,fri").as_deref(), Some("MON,FRI"));
        // both day fields free = fires every day
        assert_eq!(weekday_label("0 9 * * *").as_deref(), Some("EVERYDAY"));
        assert_eq!(weekday_label("0 9 * * ?").as_deref(), Some("EVERYDAY"));
        // day-of-month restricted: not an everyday rule, no marker
        assert_eq!(weekday_label("0 9 1 * ?"), None);
        assert_eq!(weekday_label("0 9 1 * *"), None);
        assert_eq!(weekday_label("0 9 * * */2"), None);
        // a restricted day-of-month ORs with the weekday in cron, so the
        // rule fires outside the named weekdays - no marker
        assert_eq!(weekday_label("0 9 30 * SAT#4"), None);
        assert_eq!(weekday_label("0 9 1-15 * MON"), None);
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
    fn habit_rates_count_settled_instances_against_thresholds() {
        let dir = std::env::temp_dir().join("app-pkb-views-habit-rates");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 0 * * 1\"\n    threshold: 50\n    items:\n      - \"review\"\n",
        )
        .unwrap();
        let weekly_key = recurring_rule_key(
            &crate::config_files::RecurringRule {
                schedule: "0 0 * * 1".into(),
                description: String::new(),
                items: vec![],
                threshold: None,
            },
            "review",
        );

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        let insert = |rule: &str, cadence: &str, date: &str, status: &str| {
            conn.execute(
                "INSERT INTO tasks (title, created_at, origin, cadence, rule_key,
                                    period_key, scheduled_date, origin_date, status)
                 VALUES ('t', 'x', 'recurring', ?1, ?2, ?3, ?3, ?3, ?4)",
                (cadence, rule, date, status),
            )
            .unwrap();
        };
        // weekly: 5 done, 3 dropped, one open overdue copy still live
        for (i, status) in [
            "done", "done", "done", "done", "done", "dropped", "dropped", "dropped",
        ]
        .iter()
        .enumerate()
        {
            insert(
                &weekly_key,
                "weekly",
                &format!("2026-07-{:02}", i + 1),
                status,
            );
        }
        insert(&weekly_key, "weekly", "2026-08-24", "todo");
        // daily: a missed past day counts, today's open one does not,
        // waiting counts as done
        insert("d", "daily", "2026-08-28", "done");
        insert("d", "daily", "2026-08-29", "todo");
        insert("d", "daily", "2026-08-30", "waiting");
        insert("d", "daily", "2026-08-31", "todo");
        // too few settled instances for a rate
        insert("few", "daily", "2026-08-30", "done");

        let today = NaiveDate::from_ymd_opt(2026, 8, 31).unwrap();
        let config = AppConfig {
            habit_rate_threshold: 80,
            habit_rate_window: 0,
            habit_rate_min_instances: 3,
            ..AppConfig::default()
        };
        let rates = habit_rates(&conn, &dir, &config, today).unwrap();
        assert_eq!(rates.len(), 2);
        let daily = rates.iter().find(|r| r.rule_key == "d").unwrap();
        assert_eq!((daily.done, daily.total, daily.rate), (2, 3, 66));
        assert_eq!(daily.threshold, 80);
        assert!(daily.alert);
        let weekly = rates.iter().find(|r| r.rule_key == weekly_key).unwrap();
        assert_eq!((weekly.done, weekly.total, weekly.rate), (5, 8, 62));
        // the rule's own threshold wins over the default
        assert_eq!(weekly.threshold, 50);
        assert!(!weekly.alert);

        // the window keeps only the newest settled instances
        let windowed = AppConfig {
            habit_rate_window: 3,
            ..config
        };
        let rates = habit_rates(&conn, &dir, &windowed, today).unwrap();
        let weekly = rates.iter().find(|r| r.rule_key == weekly_key).unwrap();
        assert_eq!((weekly.done, weekly.total), (0, 3));
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

    #[test]
    fn upcoming_lists_pending_and_open_events_plus_dated_list_tasks() {
        let dir = std::env::temp_dir().join("app-pkb-views-upcoming");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("scheduled.yml"),
            "events:\n  - date: 2026-9-8\n    title: \"unpadded\"\n  - date: 2026-09-10\n    title: \"done already\"\n  - date: 2026-09-12\n    title: \"still open\"\n    time: \"14:00\"\n",
        )
        .unwrap();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        let key = |date: &str, title: &str| {
            scheduled_rule_key(&crate::config_files::ScheduledEvent {
                date: date.into(),
                title: title.into(),
                time: None,
            })
        };
        let materialize = |date: &str, title: &str, status: &str| {
            let rule = key(date, title);
            conn.execute(
                "INSERT INTO rule_runs (rule_key, period_key, generated_at) VALUES (?1, ?2, 'x')",
                (&rule, date),
            )
            .unwrap();
            conn.execute(
                "INSERT INTO tasks (title, created_at, origin, rule_key, period_key,
                                    scheduled_date, status)
                 VALUES (?1, 'x', 'scheduled', ?2, ?3, ?3, ?4)",
                (title, &rule, date, status),
            )
            .unwrap();
        };
        materialize("2026-09-10", "done already", "done");
        materialize("2026-09-12", "still open", "todo");
        // dated manual list tasks show too, unless the date is a priority pin
        let list = crate::tasks::list_create(&conn, "Errands", None, false).unwrap();
        conn.execute(
            "INSERT INTO tasks (title, created_at, origin, list_id, scheduled_date, status, priority)
             VALUES ('post office', 'x', 'manual', ?1, '2026-09-09', 'todo', 0),
                    ('starred', 'x', 'manual', ?1, '2026-09-08', 'todo', 1),
                    ('yesterday', 'x', 'manual', ?1, '2026-09-07', 'todo', 0)",
            [list.id],
        )
        .unwrap();

        let today = NaiveDate::from_ymd_opt(2026, 9, 8).unwrap();
        let (events, errors) = upcoming_events(&conn, &dir, today).unwrap();
        assert!(errors.is_empty());
        let shown: Vec<(&str, &str)> = events
            .iter()
            .map(|e| (e.date.as_str(), e.title.as_str()))
            .collect();
        assert_eq!(
            shown,
            vec![
                ("2026-09-08", "unpadded"),
                ("2026-09-09", "post office"),
                ("2026-09-12", "still open"),
            ]
        );
        assert_eq!(events[1].source, "list \"Errands\"");
        assert_eq!(events[2].time.as_deref(), Some("14:00"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn birthdays_roll_to_next_year_and_report_bad_dates() {
        let dir = std::env::temp_dir().join("app-pkb-views-birthdays");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("birthdays.yml"),
            "birthdays:\n  - name: \"Past\"\n    date: \"01-15\"\n    year: 1990\n  - name: \"Today\"\n    date: \"09-08\"\n  - name: \"Leap\"\n    date: \"02-29\"\n  - name: \"Broken\"\n    date: \"13-40\"\n",
        )
        .unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 9, 8).unwrap();
        let result = birthdays_list(&dir, today);
        let by_name = |name: &str| result.birthdays.iter().find(|b| b.name == name).unwrap();
        // a date already passed this year is next year's occurrence
        assert_eq!(by_name("Past").next_occurrence, "2027-01-15");
        assert_eq!(by_name("Past").turns, Some(37));
        // today counts as upcoming, with zero days to go
        assert_eq!(by_name("Today").next_occurrence, "2026-09-08");
        assert_eq!(by_name("Today").days_until, 0);
        assert_eq!(by_name("Today").turns, None);
        // 02-29 falls back to 02-28 in a non-leap year
        assert_eq!(by_name("Leap").next_occurrence, "2027-02-28");
        // sorted by next occurrence
        let order: Vec<&str> = result.birthdays.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(order, vec!["Today", "Past", "Leap"]);
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].message.contains("Broken"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn recurring_list_keeps_broken_rules_and_names_their_error() {
        let dir = std::env::temp_dir().join("app-pkb-views-recurring-list");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 9 * * 1\"\n    description: \"weekly\"\n    items: [\"review\"]\n  - schedule: \"not cron\"\n    description: \"broken\"\n    items: [\"x\"]\n",
        )
        .unwrap();
        fs::create_dir_all(dir.join("packs")).unwrap();
        fs::write(
            dir.join("packs/home.yml"),
            "tasks:\n  - schedule: \"0 8 * * *\"\n    items: [\"{Home} water\"]\n",
        )
        .unwrap();
        let result = recurring_list(&dir);
        assert_eq!(result.rules.len(), 3);
        assert_eq!(result.rules[1].description, "broken");
        assert_eq!(result.rules[2].source, "packs/home.yml");
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].file, "recurring.yml");
        assert!(result.errors[0].message.contains("rule 2 ('broken')"));
        let _ = fs::remove_dir_all(&dir);
    }
}
