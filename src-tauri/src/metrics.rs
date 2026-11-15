//! Tracker metrics: numbers followed over time (body weight, follower
//! counts, push-ups). What a metric is lives in `config/metrics.yml`,
//! hand-editable and synced like the other rule files; the values live in
//! the `measurements` table (db.rs migration 021) and travel as
//! `state/measurements.jsonl`. One value per metric per day: entering a
//! day again overwrites it, deleting it leaves a `NULL` tombstone so the
//! deletion survives a merge with a device that still has the value.
//!
//! A value belongs to the day it measures, not the day it was typed in:
//! a recurring task closed late records its value on its own day.

use std::collections::HashMap;
use std::path::Path;

use chrono::{Duration, NaiveDate};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::config_files::{load_yaml, splice_item, ConfigError};
use crate::error::{Error, Result};
use crate::views::TrendUnit;

pub const FILE: &str = "metrics.yml";

/// How a period's values fold into one number on the week and month
/// views: a body weight averages, a count of push-ups adds up, a
/// follower count is whatever it was last.
pub const ROLLUPS: &[&str] = &["avg", "sum", "last"];
/// Which way is progress; "none" for a metric with no good direction.
pub const DIRECTIONS: &[&str] = &["down", "up", "none"];

#[derive(Debug, Default, Deserialize)]
struct MetricsFile {
    #[serde(default)]
    metrics: Vec<MetricDef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct MetricDef {
    /// Stable key the values are stored under: renaming `name` keeps the
    /// history, changing `id` starts a new one.
    pub id: String,
    /// Display name; absent = the id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub unit: Option<String>,
    /// Digits after the decimal point when shown; absent = as entered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub decimals: Option<u8>,
    /// Target value, drawn as a line on the chart.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub goal: Option<f64>,
    /// One of `DIRECTIONS`; absent = "none".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "\"down\" | \"up\" | \"none\"")]
    pub better: Option<String>,
    /// One of `ROLLUPS`; absent = "avg".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "\"avg\" | \"sum\" | \"last\"")]
    pub rollup: Option<String>,
}

impl MetricDef {
    fn rollup(&self) -> &str {
        self.rollup.as_deref().unwrap_or("avg")
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// What is wrong with a definition, if anything.
fn problem(def: &MetricDef) -> Option<String> {
    if !valid_id(&def.id) {
        return Some(format!(
            "id '{}' must be lowercase letters, digits, '-' or '_'",
            def.id
        ));
    }
    if let Some(b) = def.better.as_deref().filter(|b| !DIRECTIONS.contains(b)) {
        return Some(format!(
            "better '{b}' must be one of: {}",
            DIRECTIONS.join(", ")
        ));
    }
    if let Some(r) = def.rollup.as_deref().filter(|r| !ROLLUPS.contains(r)) {
        return Some(format!(
            "rollup '{r}' must be one of: {}",
            ROLLUPS.join(", ")
        ));
    }
    if def.decimals.is_some_and(|d| d > 6) {
        return Some("decimals must be 0-6".into());
    }
    if def.goal.is_some_and(|g| !g.is_finite()) {
        return Some("goal must be a number".into());
    }
    None
}

/// Checks every definition: a broken one is reported and left out, a
/// second one under a taken id too, so the rest still work.
fn sift(defs: Vec<MetricDef>, file: &str, errors: &mut Vec<ConfigError>) -> Vec<MetricDef> {
    let mut kept: Vec<MetricDef> = Vec::new();
    for (index, def) in defs.into_iter().enumerate() {
        let message = problem(&def).or_else(|| {
            kept.iter()
                .any(|k| k.id == def.id)
                .then(|| format!("id '{}' is already used by an earlier metric", def.id))
        });
        match message {
            Some(message) => errors.push(ConfigError {
                file: file.into(),
                line: None,
                message: format!("metric {}: {message}", index + 1),
            }),
            None => kept.push(def),
        }
    }
    kept
}

/// The metrics defined in metrics.yml, in file order, with what is wrong
/// with the file. A file that does not parse yields no metrics (the
/// values stay stored and come back once it is fixed).
pub fn load(config_dir: &Path) -> (Vec<MetricDef>, Vec<ConfigError>) {
    let mut errors = Vec::new();
    let defs = load_yaml::<MetricsFile>(config_dir, FILE, &mut errors)
        .map(|file| file.metrics)
        .unwrap_or_default();
    let defs = sift(defs, FILE, &mut errors);
    (defs, errors)
}

/// Inline validation for the config editor.
pub fn validate(content: &str) -> Vec<ConfigError> {
    let mut errors = Vec::new();
    match serde_yaml::from_str::<MetricsFile>(content) {
        Ok(file) => {
            sift(file.metrics, FILE, &mut errors);
        }
        Err(e) => errors.push(ConfigError {
            file: FILE.into(),
            line: e.location().map(|l| l.line()),
            message: e.to_string(),
        }),
    }
    errors
}

fn check_file(content: &str) -> Option<String> {
    serde_yaml::from_str::<MetricsFile>(content)
        .err()
        .map(|e| e.to_string())
}

/// Appends a metric to metrics.yml (spliced in: comments survive).
pub fn add(config_dir: &Path, mut def: MetricDef) -> Result<()> {
    let tidy = |text: Option<String>| text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    def.id = def.id.trim().to_string();
    def.name = tidy(def.name);
    def.unit = tidy(def.unit);
    if let Some(message) = problem(&def) {
        return Err(Error::State(message));
    }
    let (existing, _) = load(config_dir);
    if existing.iter().any(|d| d.id == def.id) {
        return Err(Error::State(format!(
            "a metric with id '{}' already exists",
            def.id
        )));
    }
    splice_item(config_dir, FILE, "metrics", None, Some(&def), check_file)
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Measurement {
    pub metric: String,
    pub date: String,
    pub value: f64,
}

fn parse_date(date: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| Error::State(format!("invalid date: {date}")))
}

/// Records `value` for `metric` on `date`, replacing what that day held.
/// The metric need not be defined (yet): values are kept by id, so a
/// definition removed by mistake loses nothing.
pub fn set(conn: &Connection, metric: &str, date: &str, value: f64) -> Result<()> {
    if !valid_id(metric) {
        return Err(Error::State(format!("invalid metric id: {metric}")));
    }
    if !value.is_finite() {
        return Err(Error::State("the value must be a number".into()));
    }
    let date = parse_date(date)?.format("%Y-%m-%d").to_string();
    conn.execute(
        "INSERT INTO measurements (metric, date, value) VALUES (?1, ?2, ?3)
         ON CONFLICT(metric, date) DO UPDATE SET value = excluded.value",
        rusqlite::params![metric, date, value],
    )?;
    Ok(())
}

/// Deletes the day's value, as a tombstone (see the module docs).
/// Nothing to delete is not an error.
pub fn delete(conn: &Connection, metric: &str, date: &str) -> Result<()> {
    conn.execute(
        "UPDATE measurements SET value = NULL
         WHERE metric = ?1 AND date = ?2 AND value IS NOT NULL",
        rusqlite::params![metric, date],
    )?;
    Ok(())
}

fn rows(conn: &Connection, sql: &str, params: impl rusqlite::Params) -> Result<Vec<Measurement>> {
    let mut stmt = conn.prepare(sql)?;
    let out = stmt
        .query_map(params, |r| {
            Ok(Measurement {
                metric: r.get(0)?,
                date: r.get(1)?,
                value: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

/// Every value from `from` on, any metric, oldest first: what task
/// cards and editors look a day's value up in.
pub fn since(conn: &Connection, from: &str) -> Result<Vec<Measurement>> {
    rows(
        conn,
        "SELECT metric, date, value FROM measurements
         WHERE value IS NOT NULL AND date >= ?1
         ORDER BY date, metric",
        [from],
    )
}

/// The newest `limit` values of one metric, newest first.
pub fn recent(conn: &Connection, metric: &str, limit: u32) -> Result<Vec<Measurement>> {
    rows(
        conn,
        "SELECT metric, date, value FROM measurements
         WHERE metric = ?1 AND value IS NOT NULL
         ORDER BY date DESC LIMIT ?2",
        rusqlite::params![metric, limit.clamp(1, 1000)],
    )
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct MetricPoint {
    /// the day measured, or the first day of the week or month
    pub date: String,
    /// the day's value, or the period's rollup; null = nothing measured
    #[ts(type = "number | null")]
    pub value: Option<f64>,
    /// on the day view, the mean of the values over the seven days
    /// ending here (fewer when days are missing); null otherwise
    #[ts(type = "number | null")]
    pub avg: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct MetricSeries {
    pub metric: String,
    /// the range drawn, first and last day (both inclusive): the x axis
    pub start: String,
    pub end: String,
    /// the day view lists measured days only; the week and month views
    /// one point per period, null where nothing was measured
    pub points: Vec<MetricPoint>,
}

fn day(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

fn fold(rollup: &str, values: &[(NaiveDate, f64)]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    Some(match rollup {
        "sum" => values.iter().map(|(_, v)| v).sum(),
        "last" => values.iter().max_by_key(|(d, _)| *d).map(|(_, v)| *v)?,
        _ => values.iter().map(|(_, v)| v).sum::<f64>() / values.len() as f64,
    })
}

/// The metric over the last `count` days, weeks or months up to today.
pub fn series(
    conn: &Connection,
    def: &MetricDef,
    unit: TrendUnit,
    count: u32,
    today: NaiveDate,
) -> Result<MetricSeries> {
    let starts = unit.starts(today, count.clamp(1, 1100));
    let start = starts[0];
    // the day view's first average reaches six days before the range
    let from = if unit == TrendUnit::Day {
        start - Duration::days(6)
    } else {
        start
    };
    let values: Vec<(NaiveDate, f64)> = rows(
        conn,
        "SELECT metric, date, value FROM measurements
         WHERE metric = ?1 AND value IS NOT NULL AND date >= ?2 AND date <= ?3
         ORDER BY date",
        rusqlite::params![def.id, day(from), day(today)],
    )?
    .into_iter()
    .filter_map(|m| {
        NaiveDate::parse_from_str(&m.date, "%Y-%m-%d")
            .ok()
            .map(|d| (d, m.value))
    })
    .collect();

    let points = if unit == TrendUnit::Day {
        values
            .iter()
            .filter(|(d, _)| *d >= start)
            .map(|(d, v)| {
                let window: Vec<f64> = values
                    .iter()
                    .filter(|(w, _)| *w <= *d && *w > *d - Duration::days(7))
                    .map(|(_, v)| *v)
                    .collect();
                MetricPoint {
                    date: day(*d),
                    value: Some(*v),
                    avg: Some(window.iter().sum::<f64>() / window.len() as f64),
                }
            })
            .collect()
    } else {
        let mut buckets: HashMap<usize, Vec<(NaiveDate, f64)>> = HashMap::new();
        for (d, v) in &values {
            let slot = starts.partition_point(|s| s <= d);
            if slot > 0 {
                buckets.entry(slot - 1).or_default().push((*d, *v));
            }
        }
        starts
            .iter()
            .enumerate()
            .map(|(i, s)| MetricPoint {
                date: day(*s),
                value: buckets.get(&i).and_then(|vals| fold(def.rollup(), vals)),
                avg: None,
            })
            .collect()
    };
    let end = if unit == TrendUnit::Day {
        today
    } else {
        *starts.last().expect("count >= 1")
    };
    Ok(MetricSeries {
        metric: def.id.clone(),
        start: day(start),
        end: day(end),
        points,
    })
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct MetricView {
    pub def: MetricDef,
    /// the newest value, and the one before it (for the change shown
    /// next to it)
    pub latest: Option<Measurement>,
    pub previous: Option<Measurement>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct MetricsOverview {
    pub metrics: Vec<MetricView>,
    pub errors: Vec<ConfigError>,
}

pub fn overview(conn: &Connection, config_dir: &Path) -> Result<MetricsOverview> {
    let (defs, errors) = load(config_dir);
    let mut metrics = Vec::with_capacity(defs.len());
    for def in defs {
        let mut newest = recent(conn, &def.id, 2)?.into_iter();
        metrics.push(MetricView {
            latest: newest.next(),
            previous: newest.next(),
            def,
        });
    }
    Ok(MetricsOverview { metrics, errors })
}

/// The stored value of one metric on one day, if any.
#[cfg(test)]
fn value_on(conn: &Connection, metric: &str, date: &str) -> Option<f64> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        "SELECT value FROM measurements WHERE metric = ?1 AND date = ?2",
        [metric, date],
        |r| r.get::<_, Option<f64>>(0),
    )
    .optional()
    .ok()
    .flatten()
    .flatten()
}

#[cfg(test)]
mod tests;
