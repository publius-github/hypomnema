use std::fs;
use std::path::Path;

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate};
use croner::Cron;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::config::AppConfig;
use crate::error::Result;
use crate::tasks;

#[derive(Debug, Clone, Serialize)]
pub struct ConfigError {
    pub file: String,
    pub line: Option<usize>,
    pub message: String,
}

#[derive(Debug, Default, Serialize)]
pub struct EngineOutcome {
    pub generated: usize,
    pub carried_over: usize,
    pub pruned: usize,
    pub errors: Vec<ConfigError>,
}

#[derive(Debug, Default, Deserialize)]
struct RecurringFile {
    #[serde(default)]
    tasks: Vec<RecurringRule>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecurringRule {
    pub schedule: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub items: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct RecurringResult {
    pub rules: Vec<RecurringRule>,
    pub errors: Vec<ConfigError>,
}

#[derive(Debug, Default, Deserialize)]
struct ScheduledFile {
    #[serde(default)]
    events: Vec<ScheduledEvent>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScheduledEvent {
    pub date: String,
    pub title: String,
    #[serde(default)]
    pub time: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UpcomingResult {
    pub events: Vec<ScheduledEvent>,
    pub errors: Vec<ConfigError>,
}

#[derive(Debug, Default, Deserialize)]
struct BirthdaysFile {
    #[serde(default)]
    birthdays: Vec<BirthdayEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BirthdayEntry {
    pub name: String,
    /// MM-DD
    pub date: String,
    #[serde(default)]
    pub year: Option<i32>,
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

/// Stable 64-bit FNV-1a; rule keys persist in the DB, so the hash must
/// not depend on the Rust version or platform.
fn fnv1a64(input: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

/// `{List Name} task text` -> (Some("List Name"), "task text").
pub fn parse_item(raw: &str) -> (Option<String>, String) {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix('{') {
        if let Some(close) = rest.find('}') {
            let list = rest[..close].trim();
            let title = rest[close + 1..].trim();
            if !list.is_empty() && !title.is_empty() {
                return (Some(list.to_string()), title.to_string());
            }
        }
    }
    (None, trimmed.to_string())
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

struct GeneratedTask<'a> {
    rule_key: String,
    period_key: String,
    title: String,
    list_name: Option<String>,
    scheduled_date: String,
    time: Option<&'a str>,
    origin: &'static str,
}

/// Inserts a generated task if its (rule_key, period_key) was never
/// generated before. Existing task rows are never touched (req. 19).
fn insert_generated(conn: &Connection, task: &GeneratedTask, now: DateTime<Local>) -> Result<bool> {
    let inserted = conn.execute(
        "INSERT OR IGNORE INTO rule_runs (rule_key, period_key, generated_at)
         VALUES (?1, ?2, ?3)",
        (&task.rule_key, &task.period_key, now.to_rfc3339()),
    )?;
    if inserted == 0 {
        return Ok(false);
    }
    let list_id = match &task.list_name {
        Some(name) => Some(tasks::list_ensure(conn, name)?.id),
        None => None,
    };
    conn.execute(
        "INSERT INTO tasks (title, list_id, scheduled_date, time, sort_order,
                            created_at, origin, rule_key, period_key)
         VALUES (?1, ?2, ?3, ?4,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks
                  WHERE scheduled_date = ?3),
                 ?5, ?6, ?7, ?8)",
        (
            &task.title,
            list_id,
            &task.scheduled_date,
            task.time,
            now.to_rfc3339(),
            task.origin,
            &task.rule_key,
            &task.period_key,
        ),
    )?;
    Ok(true)
}

fn run_recurring(
    conn: &Connection,
    dir: &Path,
    catchup_days: u32,
    now: DateTime<Local>,
    outcome: &mut EngineOutcome,
) -> Result<()> {
    let Some(file) = load_yaml::<RecurringFile>(dir, "recurring.yml", &mut outcome.errors) else {
        return Ok(());
    };
    let window_start = now - Duration::days(i64::from(catchup_days));
    for (index, rule) in file.tasks.iter().enumerate() {
        let cron = match Cron::new(&rule.schedule).parse() {
            Ok(cron) => cron,
            Err(e) => {
                outcome.errors.push(ConfigError {
                    file: "recurring.yml".into(),
                    line: None,
                    message: format!(
                        "rule {} ('{}'): invalid cron '{}': {e}",
                        index + 1,
                        rule.description,
                        rule.schedule
                    ),
                });
                continue;
            }
        };
        let mut cursor = window_start;
        loop {
            let firing = match cron.find_next_occurrence(&cursor, false) {
                Ok(firing) if firing <= now => firing,
                _ => break,
            };
            let period_key = firing.format("%Y-%m-%dT%H:%M").to_string();
            for item in &rule.items {
                let (list, title) = parse_item(item);
                let generated = GeneratedTask {
                    rule_key: fnv1a64(&format!("{}|{}|{}", rule.schedule, rule.description, item)),
                    period_key: period_key.clone(),
                    title,
                    list_name: list,
                    scheduled_date: firing.format("%Y-%m-%d").to_string(),
                    time: None,
                    origin: "recurring",
                };
                if insert_generated(conn, &generated, now)? {
                    outcome.generated += 1;
                }
            }
            cursor = firing;
        }
    }
    Ok(())
}

fn run_scheduled(
    conn: &Connection,
    dir: &Path,
    horizon: NaiveDate,
    now: DateTime<Local>,
    outcome: &mut EngineOutcome,
) -> Result<()> {
    let Some(file) = load_yaml::<ScheduledFile>(dir, "scheduled.yml", &mut outcome.errors) else {
        return Ok(());
    };
    for (index, event) in file.events.iter().enumerate() {
        let Ok(date) = NaiveDate::parse_from_str(&event.date, "%Y-%m-%d") else {
            outcome.errors.push(ConfigError {
                file: "scheduled.yml".into(),
                line: None,
                message: format!(
                    "event {} ('{}'): invalid date '{}', expected YYYY-MM-DD",
                    index + 1,
                    event.title,
                    event.date
                ),
            });
            continue;
        };
        // Materialize once the date enters the grid window; past dates
        // materialize too and are then handled by carry-over.
        if date > horizon {
            continue;
        }
        let (list, title) = parse_item(&event.title);
        let generated = GeneratedTask {
            rule_key: fnv1a64(&format!("scheduled|{}|{}", event.date, event.title)),
            period_key: event.date.clone(),
            title,
            list_name: list,
            scheduled_date: event.date.clone(),
            time: event.time.as_deref(),
            origin: "scheduled",
        };
        if insert_generated(conn, &generated, now)? {
            outcome.generated += 1;
        }
    }
    Ok(())
}

fn run_birthdays(
    conn: &Connection,
    dir: &Path,
    catchup_days: u32,
    horizon: NaiveDate,
    now: DateTime<Local>,
    outcome: &mut EngineOutcome,
) -> Result<()> {
    let Some(file) = load_yaml::<BirthdaysFile>(dir, "birthdays.yml", &mut outcome.errors) else {
        return Ok(());
    };
    let today = now.date_naive();
    let window_start = today - Duration::days(i64::from(catchup_days));
    for (index, entry) in file.birthdays.iter().enumerate() {
        let parsed = entry
            .date
            .split_once('-')
            .and_then(|(m, d)| Some((m.parse::<u32>().ok()?, d.parse::<u32>().ok()?)));
        let Some((month, day)) = parsed else {
            outcome.errors.push(ConfigError {
                file: "birthdays.yml".into(),
                line: None,
                message: format!(
                    "entry {} ('{}'): invalid date '{}', expected MM-DD",
                    index + 1,
                    entry.name,
                    entry.date
                ),
            });
            continue;
        };
        // The occurrence that falls inside [today - catchup, horizon];
        // check this year and the next (window may span New Year).
        for year in [today.year(), today.year() + 1] {
            // 02-29 falls back to 02-28 in non-leap years
            let occurrence = NaiveDate::from_ymd_opt(year, month, day).or_else(|| {
                if month == 2 && day == 29 {
                    NaiveDate::from_ymd_opt(year, 2, 28)
                } else {
                    None
                }
            });
            let Some(occurrence) = occurrence else {
                outcome.errors.push(ConfigError {
                    file: "birthdays.yml".into(),
                    line: None,
                    message: format!(
                        "entry {} ('{}'): invalid date '{}'",
                        index + 1,
                        entry.name,
                        entry.date
                    ),
                });
                break;
            };
            if occurrence < window_start || occurrence > horizon {
                continue;
            }
            let title = match entry.year {
                Some(birth_year) => {
                    format!("Birthday: {} (turns {})", entry.name, year - birth_year)
                }
                None => format!("Birthday: {}", entry.name),
            };
            let generated = GeneratedTask {
                rule_key: fnv1a64(&format!("birthday|{}|{}", entry.name, entry.date)),
                period_key: year.to_string(),
                title,
                list_name: Some("Birthdays".into()),
                scheduled_date: occurrence.format("%Y-%m-%d").to_string(),
                time: None,
                origin: "birthday",
            };
            if insert_generated(conn, &generated, now)? {
                outcome.generated += 1;
            }
        }
    }
    Ok(())
}

/// Overdue carry-over (req. 7, 8): every non-done task scheduled before
/// today moves to today and keeps an overdue mark until completed.
fn carry_over(conn: &Connection, today: NaiveDate) -> Result<usize> {
    let moved = conn.execute(
        "UPDATE tasks SET scheduled_date = ?1, overdue = 1
         WHERE status != 'done'
           AND archived_at IS NULL
           AND parent_task_id IS NULL
           AND scheduled_date IS NOT NULL
           AND scheduled_date < ?1",
        [today.format("%Y-%m-%d").to_string()],
    )?;
    Ok(moved)
}

/// Retention pruning (req. 9): with retention_days > 0, done tasks
/// completed more than N days ago are deleted (subtasks cascade).
fn prune(conn: &Connection, retention_days: u32, now: DateTime<Local>) -> Result<usize> {
    if retention_days == 0 {
        return Ok(0);
    }
    let cutoff = (now - Duration::days(i64::from(retention_days))).to_rfc3339();
    let pruned = conn.execute(
        "DELETE FROM tasks
         WHERE status = 'done'
           AND parent_task_id IS NULL
           AND completed_at IS NOT NULL
           AND completed_at < ?1",
        [cutoff],
    )?;
    Ok(pruned)
}

/// One full engine pass: generation from all YAML sources, then overdue
/// carry-over, then retention pruning. Runs at startup, on day rollover,
/// and on config change. Broken files only produce errors; the tasks
/// generated from the last valid state stay untouched.
pub fn run(
    conn: &Connection,
    config_dir: &Path,
    config: &AppConfig,
    now: DateTime<Local>,
) -> Result<EngineOutcome> {
    let mut outcome = EngineOutcome::default();
    let today = now.date_naive();
    let horizon = today + Duration::days(i64::from(config.grid_columns.max(1)) - 1);

    run_recurring(conn, config_dir, config.catchup_days, now, &mut outcome)?;
    run_scheduled(conn, config_dir, horizon, now, &mut outcome)?;
    run_birthdays(
        conn,
        config_dir,
        config.catchup_days,
        horizon,
        now,
        &mut outcome,
    )?;
    outcome.carried_over = carry_over(conn, today)?;
    outcome.pruned = prune(conn, config.retention_days, now)?;
    Ok(outcome)
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
        let rule_key = fnv1a64(&format!("scheduled|{}|{}", event.date, event.title));
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
        let parsed = entry
            .date
            .split_once('-')
            .and_then(|(m, d)| Some((m.parse::<u32>().ok()?, d.parse::<u32>().ok()?)));
        let occurrence = parsed.and_then(|(m, d)| next_birthday_occurrence(m, d, today));
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
    fs::write(config_dir.join("recurring.yml"), yaml)?;
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
    fs::write(config_dir.join("scheduled.yml"), yaml)?;
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
    let valid = entry
        .date
        .split_once('-')
        .and_then(|(m, d)| Some((m.parse::<u32>().ok()?, d.parse::<u32>().ok()?)))
        .map(|(m, d)| (1..=12).contains(&m) && (1..=31).contains(&d))
        .unwrap_or(false);
    if !valid {
        return Err(crate::error::Error::State(format!(
            "invalid birthday date '{}', expected MM-DD",
            entry.date
        )));
    }
    file.birthdays.push(entry);
    let yaml = serde_yaml::to_string(&BdayFileOut {
        birthdays: file.birthdays,
    })?;
    fs::write(config_dir.join("birthdays.yml"), yaml)?;
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
                    let valid = entry
                        .date
                        .split_once('-')
                        .and_then(|(m, d)| Some((m.parse::<u32>().ok()?, d.parse::<u32>().ok()?)))
                        .map(|(m, d)| (1..=12).contains(&m) && (1..=31).contains(&d))
                        .unwrap_or(false);
                    if !valid {
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
    use crate::db;
    use chrono::TimeZone;
    use std::path::PathBuf;

    fn setup(name: &str) -> (Connection, PathBuf) {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let dir = std::env::temp_dir().join(format!("app-pkb-engine-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        (conn, dir)
    }

    fn at(date: &str, time: &str) -> DateTime<Local> {
        Local
            .from_local_datetime(
                &format!("{date}T{time}")
                    .parse::<chrono::NaiveDateTime>()
                    .unwrap(),
            )
            .unwrap()
    }

    fn config(catchup: u32, columns: u32, retention: u32) -> AppConfig {
        AppConfig {
            catchup_days: catchup,
            grid_columns: columns,
            retention_days: retention,
            ..AppConfig::default()
        }
    }

    fn count_tasks(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn parse_item_extracts_list_prefix() {
        assert_eq!(
            parse_item("{05 Finance} pay bills"),
            (Some("05 Finance".into()), "pay bills".into())
        );
        assert_eq!(parse_item("no prefix"), (None, "no prefix".into()));
        assert_eq!(parse_item("{} empty"), (None, "{} empty".into()));
    }

    #[test]
    fn daily_cron_generates_catchup_instances_once() {
        let (conn, dir) = setup("daily");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    description: Daily\n    items:\n      - \"{Home} water plants\"\n",
        )
        .unwrap();
        let now = at("2026-08-28", "12:00:00");
        let cfg = config(3, 7, 0);

        let outcome = run(&conn, &dir, &cfg, now).unwrap();
        // firings: 08-26 06:00, 08-27 06:00, 08-28 06:00 (08-25 06:00 is
        // before now - 3d = 08-25 12:00)
        assert_eq!(outcome.generated, 3);
        assert!(outcome.errors.is_empty());

        // second run: nothing new (restart scenario)
        let outcome2 = run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(outcome2.generated, 0);
        assert_eq!(count_tasks(&conn), 3);

        // past instances carried over to today with the overdue mark
        let overdue: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE overdue = 1 AND scheduled_date = '2026-08-28'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(overdue, 2);
    }

    #[test]
    fn deleted_instance_is_not_regenerated() {
        let (conn, dir) = setup("deleted");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"task\"\n",
        )
        .unwrap();
        let now = at("2026-08-28", "12:00:00");
        let cfg = config(1, 7, 0);

        run(&conn, &dir, &cfg, now).unwrap();
        conn.execute("DELETE FROM tasks", []).unwrap();

        let outcome = run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(outcome.generated, 0);
        assert_eq!(count_tasks(&conn), 0);
    }

    #[test]
    fn user_edits_survive_regeneration() {
        let (conn, dir) = setup("edits");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"original\"\n",
        )
        .unwrap();
        let now = at("2026-08-28", "12:00:00");
        let cfg = config(1, 7, 0);

        run(&conn, &dir, &cfg, now).unwrap();
        conn.execute("UPDATE tasks SET title = 'edited', status = 'done'", [])
            .unwrap();

        run(&conn, &dir, &cfg, now).unwrap();
        let title: String = conn
            .query_row("SELECT title FROM tasks LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "edited");
    }

    #[test]
    fn config_edit_applies_new_rules_without_touching_existing() {
        let (conn, dir) = setup("config-edit");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"a\"\n",
        )
        .unwrap();
        let now = at("2026-08-28", "12:00:00");
        let cfg = config(1, 7, 0);
        run(&conn, &dir, &cfg, now).unwrap();

        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"a\"\n      - \"b\"\n",
        )
        .unwrap();
        let outcome = run(&conn, &dir, &cfg, now).unwrap();
        // one firing (08-28 06:00) inside the 1-day window; only the new
        // item 'b' generates, 'a' stays deduped
        assert_eq!(outcome.generated, 1);
        assert_eq!(count_tasks(&conn), 2);
    }

    #[test]
    fn broken_yaml_reports_line_and_keeps_tasks() {
        let (conn, dir) = setup("broken");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"a\"\n",
        )
        .unwrap();
        let now = at("2026-08-28", "12:00:00");
        let cfg = config(1, 7, 0);
        run(&conn, &dir, &cfg, now).unwrap();
        let before = count_tasks(&conn);

        fs::write(dir.join("recurring.yml"), "tasks:\n  - schedule: [\n").unwrap();
        let outcome = run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(outcome.errors.len(), 1);
        assert_eq!(outcome.errors[0].file, "recurring.yml");
        assert!(outcome.errors[0].line.is_some());
        assert_eq!(count_tasks(&conn), before);
    }

    #[test]
    fn invalid_cron_reported_other_rules_still_run() {
        let (conn, dir) = setup("badcron");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"not a cron\"\n    items:\n      - \"x\"\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"y\"\n",
        )
        .unwrap();
        let outcome = run(&conn, &dir, &config(1, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
        assert_eq!(outcome.errors.len(), 1);
        assert!(outcome.generated > 0);
    }

    #[test]
    fn scheduled_event_materializes_inside_window_only() {
        let (conn, dir) = setup("scheduled");
        fs::write(
            dir.join("scheduled.yml"),
            "events:\n  - date: 2026-08-30\n    title: \"{02 Personal} dentist\"\n    time: \"10:30\"\n  - date: 2026-12-01\n    title: \"far away\"\n",
        )
        .unwrap();
        let now = at("2026-08-28", "12:00:00");
        let cfg = config(7, 7, 0);

        let outcome = run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(outcome.generated, 1);
        let (time, origin): (String, String) = conn
            .query_row(
                "SELECT time, origin FROM tasks WHERE title = 'dentist'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(time, "10:30");
        assert_eq!(origin, "scheduled");

        // the far event stays in the Upcoming list
        let (pending, _) = upcoming_events(&conn, &dir).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].date, "2026-12-01");

        // deleting the materialized task does not resurrect it
        conn.execute("DELETE FROM tasks", []).unwrap();
        let outcome2 = run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(outcome2.generated, 0);
    }

    #[test]
    fn birthday_generates_once_per_year_with_age() {
        let (conn, dir) = setup("birthday");
        fs::write(
            dir.join("birthdays.yml"),
            "birthdays:\n  - name: \"John Smith\"\n    date: \"08-30\"\n    year: 1985\n",
        )
        .unwrap();
        let now = at("2026-08-28", "12:00:00");
        let cfg = config(7, 7, 0);

        let outcome = run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(outcome.generated, 1);
        let title: String = conn
            .query_row("SELECT title FROM tasks LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Birthday: John Smith (turns 41)");

        let list: String = conn
            .query_row(
                "SELECT l.name FROM tasks t JOIN lists l ON l.id = t.list_id",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(list, "Birthdays");

        assert_eq!(run(&conn, &dir, &cfg, now).unwrap().generated, 0);
    }

    #[test]
    fn birthday_outside_window_not_generated() {
        let (conn, dir) = setup("birthday-out");
        fs::write(
            dir.join("birthdays.yml"),
            "birthdays:\n  - name: \"Jane\"\n    date: \"01-15\"\n",
        )
        .unwrap();
        let outcome = run(&conn, &dir, &config(7, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
        assert_eq!(outcome.generated, 0);
    }

    #[test]
    fn carry_over_moves_only_undone_parent_tasks() {
        let (conn, dir) = setup("carry");
        conn.execute_batch(
            "INSERT INTO tasks (id, title, scheduled_date, status, created_at)
             VALUES (1, 'old todo', '2026-08-20', 'todo', ''),
                    (2, 'old done', '2026-08-20', 'done', ''),
                    (3, 'future', '2026-09-05', 'todo', '');",
        )
        .unwrap();
        let outcome = run(&conn, &dir, &config(1, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
        assert_eq!(outcome.carried_over, 1);

        let (date, overdue): (String, i64) = conn
            .query_row(
                "SELECT scheduled_date, overdue FROM tasks WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(date, "2026-08-28");
        assert_eq!(overdue, 1);

        let done_date: String = conn
            .query_row("SELECT scheduled_date FROM tasks WHERE id = 2", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(done_date, "2026-08-20");
    }

    #[test]
    fn retention_prunes_old_done_tasks() {
        let (conn, dir) = setup("prune");
        conn.execute_batch(
            "INSERT INTO tasks (id, title, status, completed_at, created_at)
             VALUES (1, 'old', 'done', '2026-07-01T00:00:00+00:00', ''),
                    (2, 'recent', 'done', '2026-08-27T00:00:00+00:00', ''),
                    (3, 'open', 'todo', NULL, '');",
        )
        .unwrap();
        let outcome = run(&conn, &dir, &config(1, 7, 30), at("2026-08-28", "12:00:00")).unwrap();
        assert_eq!(outcome.pruned, 1);
        assert_eq!(count_tasks(&conn), 2);
    }

    #[test]
    fn retention_zero_keeps_everything() {
        let (conn, dir) = setup("prune-zero");
        conn.execute_batch(
            "INSERT INTO tasks (id, title, status, completed_at, created_at)
             VALUES (1, 'old', 'done', '2020-01-01T00:00:00+00:00', '');",
        )
        .unwrap();
        let outcome = run(&conn, &dir, &config(1, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
        assert_eq!(outcome.pruned, 0);
        assert_eq!(count_tasks(&conn), 1);
    }

    #[test]
    fn quick_add_writes_back_and_materializes_next_run() {
        let (conn, dir) = setup("quickadd");
        append_scheduled(
            &dir,
            ScheduledEvent {
                date: "2026-08-29".into(),
                title: "{02 Personal} dentist".into(),
                time: Some("10:30".into()),
            },
        )
        .unwrap();
        append_birthday(
            &dir,
            BirthdayEntry {
                name: "Jane".into(),
                date: "08-30".into(),
                year: Some(2000),
            },
        )
        .unwrap();
        assert!(append_birthday(
            &dir,
            BirthdayEntry {
                name: "Bad".into(),
                date: "13-99".into(),
                year: None,
            },
        )
        .is_err());

        let outcome = run(&conn, &dir, &config(7, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
        assert_eq!(outcome.generated, 2);
        assert!(outcome.errors.is_empty());

        let list = birthdays_list(&dir, at("2026-08-28", "12:00:00").date_naive());
        assert_eq!(list.birthdays.len(), 1);
        assert_eq!(list.birthdays[0].days_until, 2);
        assert_eq!(list.birthdays[0].turns, Some(26));
    }

    #[test]
    fn recurring_quick_add_validates_and_lists() {
        let (conn, dir) = setup("recurring-add");
        append_recurring(
            &dir,
            RecurringRule {
                schedule: "0 6 * * *".into(),
                description: "Daily".into(),
                items: vec!["{Home} water plants".into(), "  ".into()],
            },
        )
        .unwrap();
        assert!(append_recurring(
            &dir,
            RecurringRule {
                schedule: "not a cron".into(),
                description: String::new(),
                items: vec!["x".into()],
            },
        )
        .is_err());
        assert!(append_recurring(
            &dir,
            RecurringRule {
                schedule: "0 6 * * *".into(),
                description: String::new(),
                items: vec![],
            },
        )
        .is_err());

        let listed = recurring_list(&dir);
        assert_eq!(listed.rules.len(), 1);
        assert_eq!(listed.rules[0].items, vec!["{Home} water plants"]);
        assert!(listed.errors.is_empty());

        let outcome = run(&conn, &dir, &config(1, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
        assert_eq!(outcome.generated, 1);
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

    #[test]
    fn monthly_cron_period_key_is_stable() {
        let (conn, dir) = setup("monthly");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 0 1 * *\"\n    description: Monthly\n    items:\n      - \"{05 Finance} pay bills\"\n",
        )
        .unwrap();
        let cfg = config(40, 7, 0);

        // run on the 5th (window covers 07-01 and 08-01 firings), then
        // again on the 20th: same periods, nothing new
        let first = run(&conn, &dir, &cfg, at("2026-08-05", "09:00:00")).unwrap();
        assert_eq!(first.generated, 2);
        let outcome = run(&conn, &dir, &cfg, at("2026-08-20", "09:00:00")).unwrap();
        assert_eq!(outcome.generated, 0);
        assert_eq!(count_tasks(&conn), 2);
    }
}
