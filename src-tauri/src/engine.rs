//! The generation engine: one pass materializes recurring, scheduled
//! and birthday tasks (deduped through the rule_runs ledger), then
//! applies overdue carry-over and retention pruning.

use std::path::Path;

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone, Utc};
use croner::Cron;
use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::config::AppConfig;
use crate::config_files::{
    load_yaml, parse_mmdd, BirthdaysFile, ConfigError, RecurringFile, RecurringRule,
    ScheduledEvent, ScheduledFile,
};
use crate::error::Result;
use crate::tasks;

#[derive(Debug, Default, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct EngineOutcome {
    #[ts(type = "number")]
    pub generated: usize,
    #[ts(type = "number")]
    pub carried_over: usize,
    #[ts(type = "number")]
    pub pruned: usize,
    #[ts(type = "number")]
    pub removed: usize,
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

/// Rule keys persist in rule_runs/rule_seen; the derivations below are
/// the single source of truth for them.
pub(crate) fn recurring_rule_key(rule: &RecurringRule, item: &str) -> String {
    fnv1a64(&format!("{}|{}|{}", rule.schedule, rule.description, item))
}

pub(crate) fn scheduled_rule_key(event: &ScheduledEvent) -> String {
    fnv1a64(&format!("scheduled|{}|{}", event.date, event.title))
}

struct GeneratedTask<'a> {
    rule_key: String,
    period_key: String,
    title: String,
    list_name: Option<String>,
    scheduled_date: String,
    time: Option<&'a str>,
    origin: &'static str,
    cadence: Option<&'static str>,
}

/// Buckets a cron by how often it actually fires over the next year:
/// the day grid groups tasks by this, and the Calendar picks its
/// projection horizon from it. Firing counts, not field syntax, so
/// "0 9 * * 1-5" lands in daily and a quarterly rule in monthly.
pub(crate) fn cadence_of(cron: &Cron, now: DateTime<Local>) -> &'static str {
    let end = now + Duration::days(365);
    let mut cursor = now;
    let mut count: u32 = 0;
    while count < 190 {
        match cron.find_next_occurrence(&cursor, false) {
            Ok(firing) if firing <= end => {
                cursor = firing;
                count += 1;
            }
            _ => break,
        }
    }
    match count {
        183.. => "daily", // every 1-2 days
        37.. => "weekly", // up to ~10 days apart
        4.. => "monthly", // up to a quarter apart
        _ => "yearly",
    }
}

/// Inserts a generated task if its (rule_key, period_key) was never
/// generated before. Existing task rows are never touched (req. 19).
fn insert_generated(conn: &Connection, task: &GeneratedTask, now: DateTime<Local>) -> Result<bool> {
    let inserted = conn.execute(
        "INSERT OR IGNORE INTO rule_runs (rule_key, period_key, generated_at)
         VALUES (?1, ?2, ?3)",
        (
            &task.rule_key,
            &task.period_key,
            now.with_timezone(&Utc).to_rfc3339(),
        ),
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
                            created_at, origin, rule_key, period_key, cadence)
         VALUES (?1, ?2, ?3, ?4,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks
                  WHERE scheduled_date = ?3),
                 ?5, ?6, ?7, ?8, ?9)",
        (
            &task.title,
            list_id,
            &task.scheduled_date,
            task.time,
            now.with_timezone(&Utc).to_rfc3339(),
            task.origin,
            &task.rule_key,
            &task.period_key,
            task.cadence,
        ),
    )?;
    Ok(true)
}

/// A rule_runs row whose task vanished without a trace blocks its period
/// forever, leaving silent holes in the grid (dedup cleanups and older
/// app versions hard-deleted task rows while the ledger survived). For a
/// today-or-future period the ledger row is dropped so the task can be
/// regenerated - unless evidence says the absence is deliberate: an
/// archived tombstone of the same (rule_key, period_key) means the user
/// deleted the instance, and any recurring task with the same title and
/// date (live or archived, e.g. a copy completed under the rule's
/// previous identity) means the period is already represented.
fn repair_orphaned_period(conn: &Connection, task: &GeneratedTask) -> Result<bool> {
    let has_row: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM tasks WHERE rule_key = ?1 AND period_key = ?2)",
        (&task.rule_key, &task.period_key),
        |row| row.get(0),
    )?;
    if has_row {
        return Ok(false);
    }
    let has_twin: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM tasks
                       WHERE origin = 'recurring' AND title = ?1 AND scheduled_date = ?2)",
        (&task.title, &task.scheduled_date),
        |row| row.get(0),
    )?;
    if has_twin {
        return Ok(false);
    }
    conn.execute(
        "DELETE FROM rule_runs WHERE rule_key = ?1 AND period_key = ?2",
        (&task.rule_key, &task.period_key),
    )?;
    Ok(true)
}

fn run_recurring(
    conn: &Connection,
    dir: &Path,
    config: &AppConfig,
    horizon: NaiveDate,
    now: DateTime<Local>,
    outcome: &mut EngineOutcome,
) -> Result<()> {
    // Editors often save truncate-then-write, and sync clients can make
    // the file vanish for a moment; reconciling against a momentarily
    // empty/missing recurring.yml would wipe every future recurring task
    // and the rule_seen ledger. A file that is missing or holds only
    // comments/whitespace is treated as a transient state: generate
    // nothing, reconcile nothing. An explicit `tasks: []` still counts
    // as intentionally empty and reconciles.
    let path = dir.join("recurring.yml");
    match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let effectively_empty = raw.lines().all(|line| {
                let trimmed = line.trim();
                trimmed.is_empty() || trimmed.starts_with('#')
            });
            if effectively_empty {
                return Ok(());
            }
        }
        Err(_) if !path.exists() => return Ok(()),
        // exists but unreadable: fall through, load_yaml reports it
        Err(_) => {}
    }
    let Some(file) = load_yaml::<RecurringFile>(dir, "recurring.yml", &mut outcome.errors) else {
        return Ok(());
    };
    let today = now.date_naive();
    let exact_start = now - Duration::days(i64::from(config.catchup_days));
    let window_start = if config.cron_ignore_time {
        // day granularity: a firing counts by its date alone, as if the
        // cron fired at 23:59 - "0 0 * * 1" a day ago is still one
        // missed Monday, no matter what time the engine runs
        let start_day = today - Duration::days(i64::from(config.catchup_days));
        start_day
            .and_hms_opt(0, 0, 0)
            .and_then(|naive| Local.from_local_datetime(&naive).earliest())
            .map(|start| start - Duration::seconds(1))
            .unwrap_or(exact_start)
    } else {
        exact_start
    };
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
        // Firings inside [now - catchup, grid horizon]: future ones fill
        // the coming grid days ahead of time; missed ones (before today)
        // collapse into the single latest firing, which carry-over then
        // moves to today with the overdue mark - a gap of N days must
        // produce one overdue task per item, not N duplicates.
        // Guard against runaway schedules ("* * * * *" would enumerate
        // tens of thousands of firings and insert a task for each).
        const MAX_FIRINGS: usize = 2000;
        let mut firings = Vec::new();
        let mut cursor = window_start;
        let mut overflow = false;
        loop {
            match cron.find_next_occurrence(&cursor, false) {
                Ok(firing) if firing.date_naive() <= horizon => {
                    if firings.len() >= MAX_FIRINGS {
                        overflow = true;
                        break;
                    }
                    cursor = firing;
                    firings.push(firing);
                }
                Ok(_) => break,
                // An enumeration error is not "no more occurrences": say
                // so, or the rule silently under-generates.
                Err(e) => {
                    outcome.errors.push(ConfigError {
                        file: "recurring.yml".into(),
                        line: None,
                        message: format!(
                            "rule {} ('{}'): cron '{}' enumeration failed: {e}",
                            index + 1,
                            rule.description,
                            rule.schedule
                        ),
                    });
                    break;
                }
            }
        }
        if overflow {
            outcome.errors.push(ConfigError {
                file: "recurring.yml".into(),
                line: None,
                message: format!(
                    "rule {} ('{}'): cron '{}' fires more than {MAX_FIRINGS} times \
                     inside the catch-up window; rule skipped",
                    index + 1,
                    rule.description,
                    rule.schedule
                ),
            });
            continue;
        }
        let latest_missed = firings.iter().rfind(|f| f.date_naive() < today).copied();
        let current = || firings.iter().filter(|f| f.date_naive() >= today).copied();
        let cadence = cadence_of(&cron, now);
        for item in &rule.items {
            let rule_key = recurring_rule_key(rule, item);
            // keep already-generated tasks in the right grid group when
            // the app updates or the rule's schedule changes cadence
            conn.execute(
                "UPDATE tasks SET cadence = ?1
                 WHERE rule_key = ?2 AND (cadence IS NULL OR cadence != ?1)",
                (cadence, &rule_key),
            )?;
            // Catch-up never reaches back past the day the engine first
            // saw the item: a rule added today must not open as overdue,
            // and later runs must not resurrect pre-sighting firings.
            // first_seen is consumed as a LOCAL date (substr below), so it
            // is stored as the plain local date - a UTC timestamp would
            // shift the sighting day around midnight.
            let newly_seen = conn.execute(
                "INSERT OR IGNORE INTO rule_seen (rule_key, first_seen) VALUES (?1, ?2)",
                (&rule_key, today.format("%Y-%m-%d").to_string()),
            )? == 1;
            if newly_seen {
                // A first-seen rule starts with a clean ledger from today
                // on. Removing a rule deletes its future tasks but leaves
                // their rule_runs rows; re-adding the same rule text would
                // otherwise skip those periods forever (e.g. today's
                // instance never reappearing). Rows whose task still
                // exists stay - reconcile keeps today's live instance.
                conn.execute(
                    "DELETE FROM rule_runs
                     WHERE rule_key = ?1
                       AND substr(period_key, 1, 10) >= ?2
                       AND NOT EXISTS (SELECT 1 FROM tasks
                                       WHERE tasks.rule_key = rule_runs.rule_key
                                         AND tasks.period_key = rule_runs.period_key)",
                    (&rule_key, today.format("%Y-%m-%d").to_string()),
                )?;
            }
            let first_seen: String = conn.query_row(
                "SELECT substr(first_seen, 1, 10) FROM rule_seen WHERE rule_key = ?1",
                [&rule_key],
                |row| row.get(0),
            )?;
            let selected = latest_missed
                .into_iter()
                .filter(|f| f.format("%Y-%m-%d").to_string() >= first_seen)
                .chain(current());
            for firing in selected {
                let (list, title) = parse_item(item);
                let generated = GeneratedTask {
                    rule_key: rule_key.clone(),
                    period_key: firing.format("%Y-%m-%dT%H:%M").to_string(),
                    title,
                    list_name: list,
                    scheduled_date: firing.format("%Y-%m-%d").to_string(),
                    time: None,
                    origin: "recurring",
                    cadence: Some(cadence),
                };
                let inserted = insert_generated(conn, &generated, now)?
                    || (firing.date_naive() >= today
                        && repair_orphaned_period(conn, &generated)?
                        && insert_generated(conn, &generated, now)?);
                if inserted {
                    outcome.generated += 1;
                }
            }
        }
    }

    // Reconcile with the config: a rule or item removed from
    // recurring.yml takes its not-yet-reached instances with it.
    // Today's and past instances (incl. overdue carry-overs) stay,
    // and a broken file never reaches this point, so the last valid
    // state is preserved.
    let active: std::collections::HashSet<String> = file
        .tasks
        .iter()
        .flat_map(|rule| rule.items.iter().map(|item| recurring_rule_key(rule, item)))
        .collect();
    let today_str = today.format("%Y-%m-%d").to_string();
    let existing: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT rule_key FROM tasks
             WHERE origin = 'recurring' AND rule_key IS NOT NULL AND archived_at IS NULL",
        )?;
        let keys = stmt.query_map([], |row| row.get(0))?;
        keys.collect::<std::result::Result<_, _>>()?
    };
    for key in existing.iter().filter(|key| !active.contains(*key)) {
        outcome.removed += conn.execute(
            "DELETE FROM tasks
             WHERE origin = 'recurring' AND rule_key = ?1 AND scheduled_date > ?2",
            (key, &today_str),
        )?;
        // Editing a rule re-identifies it: the new key regenerated
        // today's firing above while this old key still owns a copy of
        // it - without the two steps below the user sees the task twice
        // after a rename. (a) An untouched todo copy of the removed key
        // yields to a same-title-same-day copy from another key;
        outcome.removed += conn.execute(
            "DELETE FROM tasks
             WHERE origin = 'recurring' AND rule_key = ?1 AND status = 'todo'
               AND archived_at IS NULL
               AND EXISTS (SELECT 1 FROM tasks live
                           WHERE live.origin = 'recurring'
                             AND live.id != tasks.id
                             AND live.rule_key != ?1
                             AND live.archived_at IS NULL
                             AND live.title = tasks.title
                             AND live.scheduled_date = tasks.scheduled_date)",
            [key],
        )?;
        // (b) a firing already completed under the old identity must not
        // come back as a fresh todo under the new one.
        conn.execute(
            "DELETE FROM tasks
             WHERE origin = 'recurring' AND status = 'todo' AND archived_at IS NULL
               AND rule_key != ?1
               AND EXISTS (SELECT 1 FROM tasks old
                           WHERE old.origin = 'recurring'
                             AND old.rule_key = ?1
                             AND old.status = 'done'
                             AND old.archived_at IS NULL
                             AND old.title = tasks.title
                             AND old.scheduled_date = tasks.scheduled_date)",
            [key],
        )?;
    }
    // Forget removed rules entirely, so re-adding the same rule later
    // counts as new (no retroactive overdue from the removal gap).
    let seen: Vec<String> = {
        let mut stmt = conn.prepare("SELECT rule_key FROM rule_seen")?;
        let keys = stmt.query_map([], |row| row.get(0))?;
        keys.collect::<std::result::Result<_, _>>()?
    };
    for key in seen.iter().filter(|key| !active.contains(*key)) {
        conn.execute("DELETE FROM rule_seen WHERE rule_key = ?1", [key])?;
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
            rule_key: scheduled_rule_key(event),
            period_key: event.date.clone(),
            title,
            list_name: list,
            scheduled_date: event.date.clone(),
            time: event.time.as_deref(),
            origin: "scheduled",
            cadence: None,
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
        let Some((month, day)) = parse_mmdd(&entry.date) else {
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
                cadence: Some("yearly"),
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
    // completed_at is stored in UTC; the cutoff must be UTC too, since
    // RFC3339 strings with mixed offsets do not order chronologically.
    let cutoff = (now.with_timezone(&Utc) - Duration::days(i64::from(retention_days))).to_rfc3339();
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

    // One transaction for the whole pass: a crash between the ledger
    // insert and the task insert would otherwise mark a period as
    // generated without ever creating its task - unrecoverable, since
    // dedup then refuses to regenerate it.
    let tx = conn.unchecked_transaction()?;
    // birthdays generated before the cadence column existed
    conn.execute(
        "UPDATE tasks SET cadence = 'yearly' WHERE origin = 'birthday' AND cadence IS NULL",
        [],
    )?;
    run_recurring(conn, config_dir, config, horizon, now, &mut outcome)?;
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
    // Soft-deleted tasks past their undo window are purged for good.
    // Generated tasks are the exception: their archived row doubles as a
    // tombstone telling repair_orphaned_period "the user deleted this
    // instance, do not regenerate it", so it must outlive the period -
    // it is kept until its scheduled date has passed.
    conn.execute(
        "DELETE FROM tasks
         WHERE archived_at IS NOT NULL AND archived_at < ?1
           AND (rule_key IS NULL OR scheduled_date IS NULL OR scheduled_date < ?2)",
        (
            (now.with_timezone(&Utc) - Duration::days(1)).to_rfc3339(),
            today.format("%Y-%m-%d").to_string(),
        ),
    )?;
    // Recurring ledger rows older than the catch-up window can never
    // influence generation again; drop them so rule_runs stays bounded.
    // Only recurring period keys (YYYY-MM-DDTHH:MM, 16 chars) qualify -
    // scheduled/birthday keys use other formats and stay.
    let ledger_cutoff = (today - Duration::days(i64::from(config.catchup_days)))
        .format("%Y-%m-%d")
        .to_string();
    conn.execute(
        "DELETE FROM rule_runs
         WHERE length(period_key) = 16 AND substr(period_key, 1, 10) < ?1",
        [&ledger_cutoff],
    )?;
    tx.commit()?;
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config_files::{append_birthday, append_recurring, append_scheduled, BirthdayEntry};
    use crate::db;
    use crate::views::{birthdays_list, recurring_list, upcoming_events};
    use std::fs;
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
    fn cadence_buckets_by_firing_frequency() {
        let now = at("2026-08-28", "12:00:00");
        let of = |cron: &str| cadence_of(&Cron::new(cron).parse().unwrap(), now);
        assert_eq!(of("0 0 * * *"), "daily");
        assert_eq!(of("0 9 * * 1-5"), "daily");
        assert_eq!(of("0 0 * * 1"), "weekly");
        assert_eq!(of("0 0 * * 2,5"), "weekly");
        assert_eq!(of("0 0 1 * *"), "monthly");
        assert_eq!(of("0 0 1 1,4,7,10 *"), "monthly");
        assert_eq!(of("0 0 15 6 *"), "yearly");
    }

    #[test]
    fn generated_tasks_carry_cadence_and_backfill_updates_it() {
        let (conn, dir) = setup("cadence");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 0 * * *\"\n    items:\n      - \"water\"\n",
        )
        .unwrap();
        let cfg = config(1, 3, 0);
        let now = at("2026-08-28", "12:00:00");
        run(&conn, &dir, &cfg, now).unwrap();
        let cadence: String = conn
            .query_row("SELECT DISTINCT cadence FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cadence, "daily");

        // pre-cadence rows (NULL) pick up the rule's bucket on the next run
        conn.execute("UPDATE tasks SET cadence = NULL", []).unwrap();
        run(&conn, &dir, &cfg, now).unwrap();
        let backfilled: String = conn
            .query_row("SELECT DISTINCT cadence FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(backfilled, "daily");
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
        let cfg = config(3, 7, 0);

        // first sighting of the rule: today + 6 grid days, no catch-up
        let outcome = run(&conn, &dir, &cfg, at("2026-08-25", "12:00:00")).unwrap();
        assert_eq!(outcome.generated, 7);
        assert!(outcome.errors.is_empty());

        // second run: nothing new (restart scenario)
        let outcome2 = run(&conn, &dir, &cfg, at("2026-08-25", "12:00:00")).unwrap();
        assert_eq!(outcome2.generated, 0);
        assert_eq!(count_tasks(&conn), 7);

        // three days later: only the new grid days generate, and the
        // past instances carry over to today as overdue
        let outcome3 = run(&conn, &dir, &cfg, at("2026-08-28", "12:00:00")).unwrap();
        assert_eq!(outcome3.generated, 3);
        assert_eq!(outcome3.carried_over, 3);
        let overdue: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE overdue = 1 AND scheduled_date = '2026-08-28'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(overdue, 3);
    }

    #[test]
    fn new_rule_starts_today_without_overdue() {
        let (conn, dir) = setup("new-rule");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"fresh\"\n",
        )
        .unwrap();
        // a 30-day catch-up window must not matter for a rule added today
        let outcome = run(&conn, &dir, &config(30, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
        assert_eq!(outcome.generated, 7);
        let overdue: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks WHERE overdue = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(overdue, 0);
    }

    #[test]
    fn runaway_cron_is_skipped_with_an_error() {
        let (conn, dir) = setup("runaway");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"* * * * *\"\n    description: Spam\n    items:\n      - \"noise\"\n",
        )
        .unwrap();
        let outcome = run(&conn, &dir, &config(30, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
        assert_eq!(outcome.generated, 0);
        assert_eq!(count_tasks(&conn), 0);
        assert_eq!(outcome.errors.len(), 1);
        assert!(outcome.errors[0].message.contains("fires more than"));
    }

    #[test]
    fn old_recurring_ledger_rows_are_pruned() {
        let (conn, dir) = setup("ledger-prune");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"daily\"\n",
        )
        .unwrap();
        let cfg = config(3, 3, 0);
        run(&conn, &dir, &cfg, at("2026-08-01", "12:00:00")).unwrap();
        // a month later: rows whose period predates the catch-up window
        // are gone, recent ones stay, and nothing regenerates for the
        // pruned periods (they are outside the enumeration window anyway)
        run(&conn, &dir, &cfg, at("2026-08-28", "12:00:00")).unwrap();
        let stale: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM rule_runs WHERE substr(period_key, 1, 10) < '2026-08-25'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stale, 0);
        let recent: i64 = conn
            .query_row("SELECT COUNT(*) FROM rule_runs", [], |r| r.get(0))
            .unwrap();
        assert!(recent > 0);
    }

    #[test]
    fn readded_rule_regenerates_periods_freed_by_removal() {
        let (conn, dir) = setup("readd");
        let rule_yaml = "tasks:\n  - schedule: \"0 6 * * *\"\n    description: Daily\n    items:\n      - \"water\"\n";
        fs::write(dir.join("recurring.yml"), rule_yaml).unwrap();
        let cfg = config(3, 3, 0);

        let first = run(&conn, &dir, &cfg, at("2026-08-25", "12:00:00")).unwrap();
        assert_eq!(first.generated, 3);

        // rule removed: the future instances go, their ledger rows stay
        fs::write(dir.join("recurring.yml"), "tasks: []\n").unwrap();
        let removed = run(&conn, &dir, &cfg, at("2026-08-25", "13:00:00")).unwrap();
        assert_eq!(removed.removed, 2);
        conn.execute("UPDATE tasks SET status = 'done'", [])
            .unwrap();

        // next day the same rule text comes back: it counts as new and
        // must fill the grid again, today's instance included
        fs::write(dir.join("recurring.yml"), rule_yaml).unwrap();
        let readded = run(&conn, &dir, &cfg, at("2026-08-26", "12:00:00")).unwrap();
        assert_eq!(readded.generated, 3);
        let today_tasks: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks
                 WHERE scheduled_date = '2026-08-26' AND status = 'todo'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(today_tasks, 1);
        let overdue: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks WHERE overdue = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(overdue, 0);
    }

    #[test]
    fn edited_rule_does_not_duplicate_todays_task() {
        let (conn, dir) = setup("edited-rule");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    description: Old\n    items:\n      - \"water\"\n",
        )
        .unwrap();
        let cfg = config(3, 7, 0);
        let now = at("2026-08-28", "12:00:00");
        run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(count_tasks(&conn), 7);

        // a cosmetic rename changes the rule key; the regenerated window
        // must replace, not duplicate, the old identity's instances
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    description: New\n    items:\n      - \"water\"\n",
        )
        .unwrap();
        run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(count_tasks(&conn), 7);
        let today_copies: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE scheduled_date = '2026-08-28'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(today_copies, 1);

        // a firing completed under the old identity stays done after the
        // next rename instead of reappearing as a fresh todo
        conn.execute(
            "UPDATE tasks SET status = 'done' WHERE scheduled_date = '2026-08-28'",
            [],
        )
        .unwrap();
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    description: Newer\n    items:\n      - \"water\"\n",
        )
        .unwrap();
        run(&conn, &dir, &cfg, now).unwrap();
        let today: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT status FROM tasks WHERE scheduled_date = '2026-08-28'")
                .unwrap();
            let rows = stmt.query_map([], |r| r.get(0)).unwrap();
            rows.collect::<std::result::Result<_, _>>().unwrap()
        };
        assert_eq!(today, vec!["done".to_string()]);
    }

    #[test]
    fn momentarily_empty_or_missing_file_does_not_reconcile() {
        let (conn, dir) = setup("truncated");
        let rule_yaml = "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"water\"\n";
        fs::write(dir.join("recurring.yml"), rule_yaml).unwrap();
        let cfg = config(3, 3, 0);
        let now = at("2026-08-25", "12:00:00");
        run(&conn, &dir, &cfg, now).unwrap();
        let before = count_tasks(&conn);

        // truncate-then-write save caught mid-flight: nothing removed
        fs::write(dir.join("recurring.yml"), "").unwrap();
        let outcome = run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(outcome.removed, 0);
        assert_eq!(count_tasks(&conn), before);

        // comments-only (the fresh-vault sample) and a missing file are
        // equally transient
        fs::write(dir.join("recurring.yml"), "# rules go here\n").unwrap();
        assert_eq!(run(&conn, &dir, &cfg, now).unwrap().removed, 0);
        fs::remove_file(dir.join("recurring.yml")).unwrap();
        assert_eq!(run(&conn, &dir, &cfg, now).unwrap().removed, 0);
        assert_eq!(count_tasks(&conn), before);

        // an explicit empty list is intentional and still reconciles
        fs::write(dir.join("recurring.yml"), "tasks: []\n").unwrap();
        let explicit = run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(explicit.removed, 2);
    }

    #[test]
    fn long_catchup_gap_collapses_to_one_overdue_task() {
        let (conn, dir) = setup("gap");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 9 * * 1-5\"\n    description: Weekdays\n    items:\n      - \"standup\"\n",
        )
        .unwrap();
        // the rule is first seen on Monday 08-10 (weekdays 08-10..08-14)
        let seeded = run(&conn, &dir, &config(1, 7, 0), at("2026-08-10", "12:00:00")).unwrap();
        assert_eq!(seeded.generated, 5);

        // two idle weeks later (Friday 08-28) with a 30-day catch-up:
        // the missed weekdays collapse into one firing (08-27), plus
        // today and the future grid weekdays; weekends get nothing
        let outcome = run(&conn, &dir, &config(30, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
        assert_eq!(outcome.generated, 6);
        assert_eq!(count_tasks(&conn), 11);

        let weekend: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE scheduled_date IN ('2026-08-29', '2026-08-30')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(weekend, 0);

        let monday: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE scheduled_date = '2026-08-31'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(monday, 1);
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
        let ids: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT id FROM tasks").unwrap();
            let rows = stmt.query_map([], |r| r.get(0)).unwrap();
            rows.collect::<std::result::Result<_, _>>().unwrap()
        };
        for id in ids {
            crate::tasks::task_delete(&conn, id).unwrap();
        }

        // tombstones (archived rows) keep every deleted instance dead,
        // even after the purge pass, as long as its date is current
        let outcome = run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(outcome.generated, 0);
        let live: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE archived_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(live, 0);

        // simulate the undo window passing: generated tombstones with a
        // current date survive the purge and still block regeneration
        conn.execute(
            "UPDATE tasks SET archived_at = '2026-08-20T00:00:00+00:00'",
            [],
        )
        .unwrap();
        let outcome = run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(outcome.generated, 0);
        let tombstones: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tombstones, 7);

        // once a tombstone's date is in the past it purges for good
        let later = at("2026-09-05", "12:00:00");
        run(&conn, &dir, &cfg, later).unwrap();
        let old_tombstones: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks
                 WHERE archived_at IS NOT NULL AND scheduled_date < '2026-09-05'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(old_tombstones, 0);
    }

    #[test]
    fn orphaned_ledger_rows_regenerate_current_periods() {
        let (conn, dir) = setup("orphaned-ledger");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"{Home} water\"\n",
        )
        .unwrap();
        let cfg = config(3, 7, 0);
        run(&conn, &dir, &cfg, at("2026-08-25", "12:00:00")).unwrap();

        // older versions could hard-delete task rows while their
        // rule_runs rows survived (dedup cleanups, clear-done): the
        // period looked "generated" forever and the grid stayed empty
        conn.execute("DELETE FROM tasks", []).unwrap();
        let outcome = run(&conn, &dir, &cfg, at("2026-08-28", "12:00:00")).unwrap();

        // every day from today to the horizon is repaired; periods
        // already in the past stay gone
        assert_eq!(outcome.generated, 7);
        for day in 28..=31 {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM tasks WHERE scheduled_date = ?1",
                    [format!("2026-08-{day}")],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "missing task on 2026-08-{day}");
        }
        let past: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE scheduled_date < '2026-08-28'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(past, 0);

        // a completed copy under another identity still counts as
        // "period represented": no todo resurrects next to it
        conn.execute(
            "UPDATE tasks SET rule_key = 'old-identity', status = 'done'
             WHERE scheduled_date = '2026-08-28'",
            [],
        )
        .unwrap();
        let again = run(&conn, &dir, &cfg, at("2026-08-28", "13:00:00")).unwrap();
        assert_eq!(again.generated, 0);
    }

    #[test]
    fn clear_done_does_not_resurrect_todays_tasks() {
        let (conn, dir) = setup("clear-done");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"daily\"\n",
        )
        .unwrap();
        let cfg = config(1, 7, 0);
        let now = at("2026-08-28", "12:00:00");
        run(&conn, &dir, &cfg, now).unwrap();
        conn.execute(
            "UPDATE tasks SET status = 'done' WHERE scheduled_date = '2026-08-28'",
            [],
        )
        .unwrap();

        assert_eq!(crate::tasks::tasks_delete_done(&conn).unwrap(), 1);
        let outcome = run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(outcome.generated, 0);
        let today_live: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks
                 WHERE scheduled_date = '2026-08-28' AND archived_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(today_live, 0);
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
        // the new item 'b' is unseen, so it starts from today: 7
        // firings (today + 6 grid days); 'a' stays deduped
        assert_eq!(outcome.generated, 7);
        assert_eq!(count_tasks(&conn), 14);
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
    fn cron_ignore_time_counts_missed_firings_by_date() {
        // seen rule, gap since 08-20, engine runs 08-28 12:00 with a
        // 1-day catch-up: the missed 08-27 00:00 firing counts with day
        // granularity but falls outside the exact [08-27 12:00] window
        let recurring = "tasks:\n  - schedule: \"0 0 * * *\"\n    items:\n      - \"x\"\n";

        let (conn, dir) = setup("ignore-time-on");
        fs::write(dir.join("recurring.yml"), recurring).unwrap();
        run(&conn, &dir, &config(1, 7, 0), at("2026-08-20", "12:00:00")).unwrap();
        let outcome = run(&conn, &dir, &config(1, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
        assert_eq!(outcome.generated, 8);

        let (conn, dir) = setup("ignore-time-off");
        fs::write(dir.join("recurring.yml"), recurring).unwrap();
        let cfg = AppConfig {
            cron_ignore_time: false,
            ..config(1, 7, 0)
        };
        run(&conn, &dir, &cfg, at("2026-08-20", "12:00:00")).unwrap();
        let outcome = run(&conn, &dir, &cfg, at("2026-08-28", "12:00:00")).unwrap();
        assert_eq!(outcome.generated, 7);
    }

    #[test]
    fn removed_rule_takes_future_instances_but_keeps_today() {
        let (conn, dir) = setup("reconcile");
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"a\"\n      - \"b\"\n",
        )
        .unwrap();
        let now = at("2026-08-28", "12:00:00");
        let cfg = config(1, 7, 0);
        run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(count_tasks(&conn), 14);

        // drop item 'b': its future instances go; today's copy stays
        fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"a\"\n",
        )
        .unwrap();
        let outcome = run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(outcome.removed, 6);
        let b_left: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks WHERE title = 'b'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(b_left, 1);
        let b_future: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE title = 'b' AND scheduled_date > '2026-08-28'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(b_future, 0);

        // a broken file must not wipe anything
        let before = count_tasks(&conn);
        fs::write(dir.join("recurring.yml"), "tasks: [\n").unwrap();
        let outcome = run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(outcome.removed, 0);
        assert_eq!(count_tasks(&conn), before);
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
        // deliberate: a postponed task whose new date has also passed is
        // treated like any open task - carried to today, marked overdue
        conn.execute_batch(
            "INSERT INTO tasks (id, title, scheduled_date, status, created_at)
             VALUES (1, 'old todo', '2026-08-20', 'todo', ''),
                    (2, 'old done', '2026-08-20', 'done', ''),
                    (3, 'future', '2026-09-05', 'todo', ''),
                    (4, 'old postponed', '2026-08-21', 'postponed', '');",
        )
        .unwrap();
        let outcome = run(&conn, &dir, &config(1, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
        assert_eq!(outcome.carried_over, 2);
        let postponed: (String, i64) = conn
            .query_row(
                "SELECT scheduled_date, overdue FROM tasks WHERE id = 4",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(postponed, ("2026-08-28".into(), 1));

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
        // freshly added rule: today + 6 future grid days, no catch-up
        assert_eq!(outcome.generated, 7);
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

        // first sighting on 08-05: no catch-up (08-01 predates the
        // rule) and the next firing (09-01) is beyond the grid horizon
        let first = run(&conn, &dir, &cfg, at("2026-08-05", "09:00:00")).unwrap();
        assert_eq!(first.generated, 0);
        // 09-03: the 09-01 firing was missed after the sighting and
        // materializes once; a re-run generates nothing new
        let outcome = run(&conn, &dir, &cfg, at("2026-09-03", "09:00:00")).unwrap();
        assert_eq!(outcome.generated, 1);
        let again = run(&conn, &dir, &cfg, at("2026-09-03", "09:00:00")).unwrap();
        assert_eq!(again.generated, 0);
        assert_eq!(count_tasks(&conn), 1);
    }
}
