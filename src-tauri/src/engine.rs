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
    load_extras, load_yaml, parse_mmdd, BirthdaysFile, ConfigError, RecurringFile, RecurringRule,
    ScheduledEvent, ScheduledFile,
};
use crate::error::Result;
use crate::{ids, tasks};

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
    /// Weekday marker of the generating cron ("SAT#1"); recurring only.
    dow_label: Option<String>,
}

/// Buckets a cron by how often it actually fires over the next year:
/// the day grid groups tasks by this, and the Calendar picks its
/// projection horizon from it. Firing counts, not field syntax, so
/// "0 9 * * 1-5" lands in daily and a quarterly rule in monthly. The
/// yearly firing-count thresholds per bucket come from the config
/// (Settings > Planner).
pub(crate) fn cadence_of(cron: &Cron, now: DateTime<Local>, config: &AppConfig) -> &'static str {
    let daily = config.cadence_daily_min_per_year.max(1);
    let weekly = config.cadence_weekly_min_per_year.max(1);
    let monthly = config.cadence_monthly_min_per_year.max(1);
    let end = now + Duration::days(365);
    let mut cursor = now;
    let mut count: u32 = 0;
    // counting past the daily threshold changes nothing; +7 tolerance
    // keeps the loop bounded for runaway schedules
    while count < daily.saturating_add(7) {
        match cron.find_next_occurrence(&cursor, false) {
            Ok(firing) if firing <= end => {
                cursor = firing;
                count += 1;
            }
            _ => break,
        }
    }
    if count >= daily {
        "daily"
    } else if count >= weekly {
        "weekly"
    } else if count >= monthly {
        "monthly"
    } else {
        "yearly"
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
    // Derived from the instance, not counted up: another device that
    // generates the same period mints the same row, and the snapshot
    // merge folds the two copies into one instead of keeping both.
    let id = ids::fresh(
        conn,
        ids::Table::Tasks,
        Some(&ids::generated_task_seed(&task.rule_key, &task.period_key)),
    )?;
    conn.execute(
        "INSERT INTO tasks (id, title, list_id, scheduled_date, time, sort_order,
                            created_at, origin, rule_key, period_key, cadence,
                            origin_date, dow_label, updated_at, updated_by)
         VALUES (?11, ?1, ?2, ?3, ?4,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks
                  WHERE scheduled_date = ?3),
                 ?5, ?6, ?7, ?8, ?9, ?3, ?10, ?12, ?13)",
        rusqlite::params![
            &task.title,
            list_id,
            &task.scheduled_date,
            task.time,
            now.with_timezone(&Utc).to_rfc3339(),
            task.origin,
            &task.rule_key,
            &task.period_key,
            task.cadence,
            &task.dow_label,
            id,
            ids::UNTOUCHED_AT,
            ids::UNTOUCHED_BY,
        ],
    )?;
    Ok(true)
}

/// A rule_runs row whose task vanished without a trace blocks its period
/// forever, leaving silent holes in the grid (dedup cleanups and older
/// app versions hard-deleted task rows while the ledger survived). For a
/// today-or-future period the ledger row is dropped so the task can be
/// regenerated - unless evidence says the absence is deliberate: an
/// archived tombstone of the same (rule_key, period_key) means a
/// delete-done sweep removed the instance, and any recurring task with the same title and
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

/// Loads recurring.yml plus the subfolder packs that merge into it.
/// Editors often save truncate-then-write, and sync clients can make
/// the file vanish for a moment; reconciling against a momentarily
/// empty/missing recurring.yml would wipe every future recurring task
/// and the rule_seen ledger. A file that is missing or holds only
/// comments/whitespace is therefore flagged transient: generation may
/// run, reconcile must not. An explicit `tasks: []` still counts as
/// intentionally empty. A broken root returns None so the last valid
/// state stays untouched.
fn load_recurring_sources(
    dir: &Path,
    errors: &mut Vec<ConfigError>,
) -> (bool, Option<Vec<(String, RecurringFile)>>) {
    let path = dir.join("recurring.yml");
    let mut root_transient = false;
    match std::fs::read_to_string(&path) {
        Ok(raw) => {
            root_transient = raw.lines().all(|line| {
                let trimmed = line.trim();
                trimmed.is_empty() || trimmed.starts_with('#')
            });
        }
        Err(_) if !path.exists() => root_transient = true,
        // exists but unreadable: fall through, load_yaml reports it
        Err(_) => {}
    }
    let root = if root_transient {
        RecurringFile::default()
    } else {
        match load_yaml::<RecurringFile>(dir, "recurring.yml", errors) {
            Some(file) => file,
            None => return (false, None),
        }
    };
    // subfolder YAML packs with a tasks: section merge in after the root
    let mut sources: Vec<(String, RecurringFile)> = vec![("recurring.yml".into(), root)];
    sources.extend(load_extras::<RecurringFile>(dir, "tasks", errors));
    (root_transient, Some(sources))
}

/// Guard against runaway schedules ("* * * * *" would enumerate tens of
/// thousands of firings and insert a task for each).
const MAX_FIRINGS: usize = 2000;

enum FiringsProblem {
    /// more than `MAX_FIRINGS` firings inside the window
    Overflow,
    /// the cron library could not step past a firing
    Failed(String),
}

/// A rule's firings after `cursor` up to and including the `horizon` day.
/// On `Failed` the firings found before the error are still returned; on
/// `Overflow` they are not meant to be used.
fn firings_until(
    cron: &Cron,
    mut cursor: DateTime<Local>,
    horizon: NaiveDate,
) -> (Vec<DateTime<Local>>, Option<FiringsProblem>) {
    let mut firings = Vec::new();
    loop {
        match cron.find_next_occurrence(&cursor, false) {
            Ok(firing) if firing.date_naive() <= horizon => {
                if firings.len() >= MAX_FIRINGS {
                    return (firings, Some(FiringsProblem::Overflow));
                }
                cursor = firing;
                firings.push(firing);
            }
            Ok(_) => return (firings, None),
            Err(e) => return (firings, Some(FiringsProblem::Failed(e.to_string()))),
        }
    }
}

/// The local day the engine first saw a rule item, recorded now if this
/// is that day.
fn first_seen(conn: &Connection, rule_key: &str, today: NaiveDate) -> Result<String> {
    // Catch-up never reaches back past the day the engine first
    // saw the item: a rule added today must not open as overdue,
    // and later runs must not resurrect pre-sighting firings.
    // first_seen is consumed as a LOCAL date (substr below), so it
    // is stored as the plain local date - a UTC timestamp would
    // shift the sighting day around midnight.
    let newly_seen = conn.execute(
        "INSERT OR IGNORE INTO rule_seen (rule_key, first_seen) VALUES (?1, ?2)",
        (rule_key, today.format("%Y-%m-%d").to_string()),
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
            (rule_key, today.format("%Y-%m-%d").to_string()),
        )?;
    }
    Ok(conn.query_row(
        "SELECT substr(first_seen, 1, 10) FROM rule_seen WHERE rule_key = ?1",
        [rule_key],
        |row| row.get(0),
    )?)
}

/// Enumerates firings for every rule item inside the catch-up window
/// and materializes the missing instances through the rule_runs ledger.
fn generate_recurring(
    conn: &Connection,
    sources: &[(String, RecurringFile)],
    config: &AppConfig,
    horizon: NaiveDate,
    now: DateTime<Local>,
    outcome: &mut EngineOutcome,
) -> Result<()> {
    let rules: Vec<(&str, usize, &RecurringRule)> = sources
        .iter()
        .flat_map(|(source, file)| {
            file.tasks
                .iter()
                .enumerate()
                .map(move |(index, rule)| (source.as_str(), index, rule))
        })
        .collect();
    let today = now.date_naive();
    let exact_start = now - Duration::days(i64::from(config.catchup_days));
    let window_start = if config.cron_ignore_time {
        // day granularity: a firing counts by its date alone, as if the
        // cron fired at 23:59 - "0 0 * * 1" a day ago is still one
        // missed Monday, no matter what time the engine runs
        let start_day = today - Duration::days(i64::from(config.catchup_days));
        day_start(&Local, start_day)
            .map(|start| start - Duration::seconds(1))
            .unwrap_or(exact_start)
    } else {
        exact_start
    };
    for (source, index, rule) in &rules {
        let (source, index, rule) = (*source, *index, *rule);
        let cron = match Cron::new(&rule.schedule).parse() {
            Ok(cron) => cron,
            Err(e) => {
                outcome.errors.push(ConfigError {
                    file: source.into(),
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
        let cadence = cadence_of(&cron, now, config);
        // dailies discard every pre-today firing anyway (see
        // `latest_missed`), so an hourly rule must not trip the guard
        // on a long catch-up window it never uses
        let cursor = if cadence == "daily" {
            window_start.max(
                day_start(&Local, today)
                    .map(|t| t - Duration::seconds(1))
                    .unwrap_or(window_start),
            )
        } else {
            window_start
        };
        let (firings, problem) = firings_until(&cron, cursor, horizon);
        if let Some(problem) = &problem {
            let message = match problem {
                // An enumeration error is not "no more occurrences": say
                // so, or the rule silently under-generates.
                FiringsProblem::Failed(e) => format!(
                    "rule {} ('{}'): cron '{}' enumeration failed: {e}",
                    index + 1,
                    rule.description,
                    rule.schedule
                ),
                FiringsProblem::Overflow => format!(
                    "rule {} ('{}'): cron '{}' fires more than {MAX_FIRINGS} times \
                     inside the catch-up window; rule skipped",
                    index + 1,
                    rule.description,
                    rule.schedule
                ),
            };
            outcome.errors.push(ConfigError {
                file: source.into(),
                line: None,
                message,
            });
        }
        // a failed enumeration still generates what it found before the
        // error; a runaway schedule generates nothing
        if matches!(problem, Some(FiringsProblem::Overflow)) {
            continue;
        }
        // rules pinned to concrete weekdays carry a [SAT#1]-style marker
        // shown before the task title
        let dow_label = crate::views::weekday_label(&rule.schedule);
        // A missed daily is not overdue work - today has its own
        // instance anyway - so daily-cadence rules skip catch-up.
        let latest_missed = if cadence == "daily" {
            None
        } else {
            firings.iter().rfind(|f| f.date_naive() < today).copied()
        };
        let current = || firings.iter().filter(|f| f.date_naive() >= today).copied();
        for item in &rule.items {
            let rule_key = recurring_rule_key(rule, item);
            // keep already-generated tasks in the right grid group when
            // the app updates or the rule's schedule changes cadence
            conn.execute(
                "UPDATE tasks SET cadence = ?1
                 WHERE rule_key = ?2 AND (cadence IS NULL OR cadence != ?1)",
                (cadence, &rule_key),
            )?;
            // same idea for the weekday marker: existing instances
            // (incl. pre-migration ones) follow the rule's current cron
            conn.execute(
                "UPDATE tasks SET dow_label = ?1
                 WHERE rule_key = ?2 AND dow_label IS NOT ?1",
                (&dow_label, &rule_key),
            )?;
            let first_seen = first_seen(conn, &rule_key, today)?;
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
                    dow_label: dow_label.clone(),
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

    Ok(())
}

/// Reconciles the DB with the config: a rule or item removed from
/// recurring.yml takes its instances with it - future ones, today's
/// still-open ones (incl. overdue carry-overs), and the pre-today
/// history that would otherwise keep cluttering the Calendar - the
/// config is the source of truth for what recurring work exists.
/// Only a copy already acted on TODAY (done, dropped or waiting)
/// survives, so editing a rule (which re-identifies it) never makes a
/// just-checked-off task vanish from the day column. A broken file never reaches this
/// point, so the last valid state is preserved.
fn reconcile_recurring(
    conn: &Connection,
    sources: &[(String, RecurringFile)],
    today: NaiveDate,
    outcome: &mut EngineOutcome,
) -> Result<()> {
    let active: std::collections::HashSet<String> = sources
        .iter()
        .flat_map(|(_, file)| file.tasks.iter())
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
        // subtasks the user hung on doomed instances go first, or they
        // would linger as orphan rows
        conn.execute(
            "DELETE FROM tasks
             WHERE parent_task_id IN
                   (SELECT id FROM tasks
                    WHERE origin = 'recurring' AND rule_key = ?1
                      AND (COALESCE(scheduled_date, '') != ?2
                           OR status NOT IN ('done', 'dropped', 'waiting')))",
            (key, &today_str),
        )?;
        outcome.removed += conn.execute(
            "DELETE FROM tasks
             WHERE origin = 'recurring' AND rule_key = ?1
               AND (COALESCE(scheduled_date, '') != ?2
                    OR status NOT IN ('done', 'dropped', 'waiting'))",
            (key, &today_str),
        )?;
        // Editing a rule re-identifies it: the new key regenerated
        // today's firing above while the old key kept the completed
        // copy - a firing already done under the old identity must not
        // come back as a fresh todo under the new one.
        conn.execute(
            "DELETE FROM tasks
             WHERE origin = 'recurring' AND status = 'todo' AND archived_at IS NULL
               AND rule_key != ?1
               AND EXISTS (SELECT 1 FROM tasks old
                           WHERE old.origin = 'recurring'
                             AND old.rule_key = ?1
                             AND old.status IN ('done', 'dropped', 'waiting')
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

/// One recurring pass: load sources, generate instances, reconcile.
fn run_recurring(
    conn: &Connection,
    dir: &Path,
    config: &AppConfig,
    horizon: NaiveDate,
    now: DateTime<Local>,
    outcome: &mut EngineOutcome,
) -> Result<()> {
    let (root_transient, sources) = load_recurring_sources(dir, &mut outcome.errors);
    let Some(sources) = sources else {
        return Ok(());
    };
    generate_recurring(conn, &sources, config, horizon, now, outcome)?;
    if root_transient {
        // reconciling against a momentarily empty/missing root file
        // would wipe its rules' future tasks and rule_seen entries
        return Ok(());
    }
    reconcile_recurring(conn, &sources, now.date_naive(), outcome)
}

fn run_scheduled(
    conn: &Connection,
    dir: &Path,
    horizon: NaiveDate,
    now: DateTime<Local>,
    outcome: &mut EngineOutcome,
) -> Result<()> {
    let Some(root) = load_yaml::<ScheduledFile>(dir, "scheduled.yml", &mut outcome.errors) else {
        return Ok(());
    };
    let mut sources: Vec<(String, ScheduledFile)> = vec![("scheduled.yml".into(), root)];
    sources.extend(load_extras::<ScheduledFile>(
        dir,
        "events",
        &mut outcome.errors,
    ));
    let events: Vec<(&str, usize, &ScheduledEvent)> = sources
        .iter()
        .flat_map(|(source, file)| {
            file.events
                .iter()
                .enumerate()
                .map(move |(index, event)| (source.as_str(), index, event))
        })
        .collect();
    for (source, index, event) in events {
        let Ok(date) = NaiveDate::parse_from_str(&event.date, "%Y-%m-%d") else {
            outcome.errors.push(ConfigError {
                file: source.into(),
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
        // chrono accepts `2026-9-8` and `9:30`; the task model compares
        // these strings lexicographically, so store them zero-padded or
        // the instance falls out of every window and never carries over
        let time = match event.time.as_deref() {
            Some(raw) => match chrono::NaiveTime::parse_from_str(raw, "%H:%M") {
                Ok(t) => Some(t.format("%H:%M").to_string()),
                Err(_) => {
                    outcome.errors.push(ConfigError {
                        file: source.into(),
                        line: None,
                        message: format!(
                            "event {} ('{}'): invalid time '{}', expected HH:MM",
                            index + 1,
                            event.title,
                            raw
                        ),
                    });
                    continue;
                }
            },
            None => None,
        };
        let (list, title) = parse_item(&event.title);
        let generated = GeneratedTask {
            rule_key: scheduled_rule_key(event),
            period_key: event.date.clone(),
            title,
            list_name: list,
            scheduled_date: date.format("%Y-%m-%d").to_string(),
            time: time.as_deref(),
            origin: "scheduled",
            cadence: None,
            dow_label: None,
        };
        if insert_generated(conn, &generated, now)? {
            outcome.generated += 1;
        } else {
            // the rule key leaves `time` out on purpose so a moved
            // appointment updates the instance that exists; that only
            // holds if the new time actually reaches it
            conn.execute(
                "UPDATE tasks SET time = ?1
                 WHERE rule_key = ?2 AND period_key = ?3
                   AND status NOT IN ('done', 'dropped') AND archived_at IS NULL
                   AND time IS NOT ?1",
                (&generated.time, &generated.rule_key, &generated.period_key),
            )?;
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
    let Some(root) = load_yaml::<BirthdaysFile>(dir, "birthdays.yml", &mut outcome.errors) else {
        return Ok(());
    };
    let mut sources: Vec<(String, BirthdaysFile)> = vec![("birthdays.yml".into(), root)];
    sources.extend(load_extras::<BirthdaysFile>(
        dir,
        "birthdays",
        &mut outcome.errors,
    ));
    let today = now.date_naive();
    let window_start = today - Duration::days(i64::from(catchup_days));
    let entries: Vec<(&str, usize, &crate::config_files::BirthdayEntry)> = sources
        .iter()
        .flat_map(|(source, file)| {
            file.birthdays
                .iter()
                .enumerate()
                .map(move |(index, entry)| (source.as_str(), index, entry))
        })
        .collect();
    for (source, index, entry) in entries {
        let Some((month, day)) = parse_mmdd(&entry.date) else {
            outcome.errors.push(ConfigError {
                file: source.into(),
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
        // both ends may sit in another year than today.
        for year in window_start.year()..=horizon.year() {
            let occurrence = crate::config_files::birthday_occurrence(year, month, day);
            let Some(occurrence) = occurrence else {
                outcome.errors.push(ConfigError {
                    file: source.into(),
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
            let title = crate::config_files::birthday_title(&entry.name, entry.year, year);
            let generated = GeneratedTask {
                rule_key: fnv1a64(&format!("birthday|{}|{}", entry.name, entry.date)),
                period_key: year.to_string(),
                title,
                list_name: Some("Birthdays".into()),
                scheduled_date: occurrence.format("%Y-%m-%d").to_string(),
                time: None,
                origin: "birthday",
                cadence: Some("yearly"),
                dow_label: None,
            };
            if insert_generated(conn, &generated, now)? {
                outcome.generated += 1;
            } else {
                // a year added to (or fixed on) an existing entry must
                // reach the already-generated instance: without this the
                // "(turns N)" part never appears on it
                conn.execute(
                    "UPDATE tasks SET title = ?1
                     WHERE rule_key = ?2 AND period_key = ?3
                       AND status NOT IN ('done', 'dropped') AND archived_at IS NULL
                       AND title != ?1",
                    (&generated.title, &generated.rule_key, &generated.period_key),
                )?;
            }
        }
    }
    Ok(())
}

/// Safety nets against duplicate generated instances: (a) the same
/// (rule, period) materialized twice - older app versions could do it,
/// and so could two devices generating the same period under their own
/// counted-up ids before a sync merged both rows in; (b) an ancient row
/// without a rule key sitting next to a keyed instance of the same title
/// and day.
fn dedupe_instances(conn: &Connection) -> Result<usize> {
    let mut deduped = collapse_instance_twins(conn)?;
    deduped += conn.execute(
        "DELETE FROM tasks
         WHERE origin = 'recurring' AND status = 'todo'
           AND archived_at IS NULL AND parent_task_id IS NULL
           AND rule_key IS NULL
           AND EXISTS (SELECT 1 FROM tasks keyed
                       WHERE keyed.id != tasks.id
                         AND keyed.origin = 'recurring'
                         AND keyed.rule_key IS NOT NULL
                         AND keyed.archived_at IS NULL
                         AND keyed.title = tasks.title
                         AND COALESCE(keyed.scheduled_date, '')
                             = COALESCE(tasks.scheduled_date, ''))",
        [],
    )?;
    Ok(deduped)
}

/// One row per (rule, period). The copy kept is the one someone acted
/// on (done or dropped before waiting, waiting before postponed,
/// postponed before untouched), then the smallest id. The choice depends on the
/// rows alone, so two devices collapsing the same pair independently keep
/// the same copy and the next merge agrees with both. Subtasks of a
/// dropped copy move to the kept one rather than cascading away.
fn collapse_instance_twins(conn: &Connection) -> Result<usize> {
    const RANK: &str = "CASE status WHEN 'done' THEN 0 WHEN 'dropped' THEN 0
                        WHEN 'waiting' THEN 1 WHEN 'postponed' THEN 2 ELSE 3 END";
    let pairs: Vec<(i64, i64)> = {
        let mut stmt = conn.prepare(&format!(
            "SELECT t.id,
                    (SELECT k.id FROM tasks k
                     WHERE k.rule_key = t.rule_key AND k.period_key = t.period_key
                       AND k.archived_at IS NULL AND k.parent_task_id IS NULL
                     ORDER BY {k_rank}, k.id LIMIT 1)
             FROM tasks t
             WHERE t.rule_key IS NOT NULL AND t.period_key IS NOT NULL
               AND t.archived_at IS NULL AND t.parent_task_id IS NULL",
            k_rank = RANK.replace("status", "k.status"),
        ))?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .filter(|(id, keep)| id != keep)
            .collect()
    };
    for (loser, keep) in &pairs {
        conn.execute(
            "UPDATE tasks SET parent_task_id = ?2 WHERE parent_task_id = ?1",
            (loser, keep),
        )?;
        conn.execute("DELETE FROM tasks WHERE id = ?1", [loser])?;
    }
    Ok(pairs.len())
}

/// Moves every open pre-today task to today. With priority_overdue off,
/// priority tasks ride along without the overdue mark (priority already
/// says "do this now"); with it on they are marked like any other task.
/// Dailies are exempt entirely.
fn move_overdue_to_today(
    conn: &Connection,
    today_str: &str,
    priority_overdue: bool,
) -> Result<usize> {
    Ok(conn.execute(
        "UPDATE tasks SET scheduled_date = ?1,
                overdue = CASE WHEN priority = 1 AND ?2 = 0 THEN 0 ELSE 1 END
         WHERE status NOT IN ('done', 'dropped')
           AND archived_at IS NULL
           AND parent_task_id IS NULL
           AND scheduled_date IS NOT NULL
           AND scheduled_date < ?1
           AND (cadence IS NULL OR cadence != 'daily')",
        (today_str, priority_overdue as i64),
    )?)
}

/// One rule = at most one open overdue copy on today. Several missed
/// firings carried over across different runs, or a missed firing
/// whose next firing has already arrived, would otherwise sit next
/// to each other as duplicates. The copy kept is today's own firing
/// (overdue = 0) when it exists, otherwise the newest overdue copy.
/// A waiting copy is never the one deleted: the user's part of it is
/// done, and what it still waits on is not today's firing.
fn collapse_carried_copies(conn: &Connection, today_str: &str) -> Result<usize> {
    Ok(conn.execute(
        "DELETE FROM tasks
         WHERE origin = 'recurring' AND status NOT IN ('done', 'dropped', 'waiting')
           AND archived_at IS NULL
           AND parent_task_id IS NULL
           AND rule_key IS NOT NULL
           AND (cadence IS NULL OR cadence != 'daily')
           AND scheduled_date = ?1 AND overdue = 1
           AND EXISTS (SELECT 1 FROM tasks live
                       WHERE live.id != tasks.id
                         AND live.rule_key = tasks.rule_key
                         AND live.archived_at IS NULL
                         AND live.scheduled_date = ?1
                         AND (live.overdue = 0
                              OR (live.status NOT IN ('done', 'dropped')
                                  AND (live.created_at, live.id)
                                      > (tasks.created_at, tasks.id))))",
        [today_str],
    )?)
}

/// Dailies carried over by earlier app versions drop the overdue mark
/// (with priority_overdue off, starred tasks do too); a daily moved off
/// its firing day (older versions carried them over too) goes back home.
fn rehome_dailies(conn: &Connection, priority_overdue: bool) -> Result<()> {
    conn.execute(
        "UPDATE tasks SET overdue = 0
         WHERE overdue = 1 AND (cadence = 'daily' OR (priority = 1 AND ?1 = 0))",
        [priority_overdue as i64],
    )?;
    conn.execute(
        "UPDATE tasks SET scheduled_date = origin_date
         WHERE origin = 'recurring' AND cadence = 'daily'
           AND status NOT IN ('done', 'dropped') AND archived_at IS NULL
           AND origin_date IS NOT NULL
           AND scheduled_date != origin_date",
        [],
    )?;
    Ok(())
}

/// Overdue carry-over (req. 7, 8): every open task (not done or
/// dropped - postponed and waiting ride along) scheduled before today
/// moves to today and keeps an overdue mark until completed.
/// Daily-cadence tasks are exempt: a daily is never overdue, today has
/// its own instance - a missed one just stays unchecked in its day.
/// Returns (carried_over, deduped).
fn carry_over(
    conn: &Connection,
    today: NaiveDate,
    priority_overdue: bool,
) -> Result<(usize, usize)> {
    let today_str = today.format("%Y-%m-%d").to_string();
    let mut deduped = dedupe_instances(conn)?;
    let moved = move_overdue_to_today(conn, &today_str, priority_overdue)?;
    deduped += collapse_carried_copies(conn, &today_str)?;
    rehome_dailies(conn, priority_overdue)?;
    Ok((moved, deduped))
}

/// The first instant of a local calendar day. Midnight itself where it
/// exists (the earlier one if the clocks fall back over it); where a DST
/// jump skips midnight (Santiago, Beirut, Havana) the day starts at the
/// first minute after the gap, not at "no answer".
pub(crate) fn day_start<Tz: TimeZone>(tz: &Tz, day: NaiveDate) -> Option<DateTime<Tz>> {
    let midnight = day.and_hms_opt(0, 0, 0)?;
    // no real gap is longer than a few hours
    (0..=4 * 60).find_map(|minute| {
        tz.from_local_datetime(&(midnight + Duration::minutes(minute)))
            .earliest()
    })
}

/// With clear_done_list_tasks on, done backlog tasks of the list
/// columns (manual, list-bound, unscheduled or priority-pinned) are
/// removed once their completion day has passed: the list is a working
/// queue, not history. Subtasks cascade with the parent row.
///
/// A task checked off ahead of time on a future day column keeps that
/// day: it stays there, done, until its own day is behind us, and goes
/// on the rollover after that - ticking Friday's task on Monday must
/// not empty Friday's column on Tuesday.
///
/// Checklist lists are exempt entirely: a checked item there is state
/// the user keeps (grocery lists), not a finished queue entry.
fn clear_done_list_tasks(conn: &Connection, now: DateTime<Local>) -> Result<usize> {
    let today = now.date_naive();
    let today_start = day_start(&Local, today).unwrap_or(now);
    // completed_at is stored as UTC RFC3339, comparable lexicographically
    let cutoff = today_start.with_timezone(&Utc).to_rfc3339();
    let today_str = today.format("%Y-%m-%d").to_string();
    Ok(conn.execute(
        "DELETE FROM tasks
         WHERE origin = 'manual' AND status IN ('done', 'dropped')
           AND parent_task_id IS NULL
           AND list_id IS NOT NULL
           AND list_id NOT IN (SELECT id FROM lists WHERE kind = 'checklist')
           AND (scheduled_date IS NULL OR priority = 1)
           AND (scheduled_date IS NULL OR scheduled_date < ?2)
           AND completed_at IS NOT NULL
           AND completed_at < ?1",
        (cutoff, today_str),
    )?)
}

/// Retention pruning (req. 9): with retention_days > 0, done tasks
/// completed more than N days ago are deleted (subtasks cascade).
/// A task ticked off far ahead of its day is exempt until that day is
/// behind us - retention prunes history, and a future day is not one.
/// Checklist lists are exempt: a checked item there is kept state, not
/// history.
fn prune(conn: &Connection, retention_days: u32, now: DateTime<Local>) -> Result<usize> {
    if retention_days == 0 {
        return Ok(0);
    }
    // completed_at is stored in UTC; the cutoff must be UTC too, since
    // RFC3339 strings with mixed offsets do not order chronologically.
    let cutoff = (now.with_timezone(&Utc) - Duration::days(i64::from(retention_days))).to_rfc3339();
    let today_str = now.date_naive().format("%Y-%m-%d").to_string();
    let pruned = conn.execute(
        "DELETE FROM tasks
         WHERE status IN ('done', 'dropped')
           AND parent_task_id IS NULL
           AND completed_at IS NOT NULL
           AND completed_at < ?1
           AND (scheduled_date IS NULL OR scheduled_date < ?2)
           AND (list_id IS NULL
                OR list_id NOT IN (SELECT id FROM lists WHERE kind = 'checklist'))",
        (cutoff, today_str),
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
    let horizon = today + Duration::days(i64::from(config.horizon_days()) - 1);

    // One transaction for the whole pass: a crash between the ledger
    // insert and the task insert would otherwise mark a period as
    // generated without ever creating its task - unrecoverable, since
    // dedup then refuses to regenerate it. IMMEDIATE takes the write
    // lock up front: the watcher thread runs passes on its own
    // connection, and a DEFERRED transaction that reads first would die
    // with SQLITE_BUSY_SNAPSHOT instead of waiting out busy_timeout.
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
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
    let (carried_over, deduped) = carry_over(conn, today, config.priority_overdue)?;
    outcome.carried_over = carried_over;
    outcome.removed += deduped;
    outcome.pruned = prune(conn, config.retention_days, now)?;
    if config.clear_done_list_tasks {
        outcome.pruned += clear_done_list_tasks(conn, now)?;
    }
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
    let mut seen_errors = std::collections::HashSet::new();
    outcome
        .errors
        .retain(|e| seen_errors.insert((e.file.clone(), e.line, e.message.clone())));
    Ok(outcome)
}

#[cfg(test)]
mod tests;
