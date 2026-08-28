use std::path::Path;

use chrono::{Datelike, NaiveDate, Weekday};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::config_files::{load_yaml, ConfigError};
use crate::error::Result;

#[derive(Debug, Default, Deserialize)]
struct WeeklyFocusFile {
    #[serde(default)]
    rotation: Option<String>,
    #[serde(default)]
    phrases: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct DayRemindersFile {
    #[serde(default)]
    reminders: Vec<DayReminder>,
}

#[derive(Debug, Deserialize)]
struct DayReminder {
    day_type: String,
    text: String,
}

#[derive(Debug, Default, Deserialize)]
struct DayScheduleFile {
    #[serde(default)]
    blocks: Vec<ScheduleBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleBlock {
    pub from: String,
    pub to: String,
    pub label: String,
}

#[derive(Debug, Serialize)]
pub struct DayContext {
    pub date: String,
    pub reminders: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DashboardContext {
    pub focus: Option<String>,
    pub days: Vec<DayContext>,
    pub blocks: Vec<ScheduleBlock>,
    pub errors: Vec<ConfigError>,
}

/// day_type matching (req. 13): workday | weekend | mon..sun.
fn matches_day_type(day_type: &str, date: NaiveDate) -> bool {
    let weekday = date.weekday();
    match day_type.to_lowercase().as_str() {
        "workday" => !matches!(weekday, Weekday::Sat | Weekday::Sun),
        "weekend" => matches!(weekday, Weekday::Sat | Weekday::Sun),
        "mon" | "monday" => weekday == Weekday::Mon,
        "tue" | "tuesday" => weekday == Weekday::Tue,
        "wed" | "wednesday" => weekday == Weekday::Wed,
        "thu" | "thursday" => weekday == Weekday::Thu,
        "fri" | "friday" => weekday == Weekday::Fri,
        "sat" | "saturday" => weekday == Weekday::Sat,
        "sun" | "sunday" => weekday == Weekday::Sun,
        _ => false,
    }
}

/// Cycle rotation (req. 11-12): each ISO week gets the next phrase after
/// the most recently assigned week; the assignment is persisted so the
/// phrase never changes mid-week, even if the list is edited.
fn focus_for_week(
    conn: &Connection,
    iso_year: i32,
    iso_week: u32,
    phrase_count: usize,
) -> Result<Option<usize>> {
    if phrase_count == 0 {
        return Ok(None);
    }
    let existing: Option<i64> = conn
        .query_row(
            "SELECT phrase_index FROM weekly_focus_state
             WHERE iso_year = ?1 AND iso_week = ?2",
            (iso_year, iso_week),
            |row| row.get(0),
        )
        .optional()?;
    if let Some(index) = existing {
        return Ok(Some((index as usize) % phrase_count));
    }
    let last: Option<i64> = conn
        .query_row(
            "SELECT phrase_index FROM weekly_focus_state
             ORDER BY iso_year DESC, iso_week DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let index = match last {
        Some(last) => ((last as usize) + 1) % phrase_count,
        None => 0,
    };
    conn.execute(
        "INSERT INTO weekly_focus_state (iso_year, iso_week, phrase_index)
         VALUES (?1, ?2, ?3)",
        (iso_year, iso_week, index as i64),
    )?;
    Ok(Some(index))
}

pub fn dashboard_context(
    conn: &Connection,
    config_dir: &Path,
    dates: &[String],
) -> Result<DashboardContext> {
    let mut errors = Vec::new();

    let focus_file = load_yaml::<WeeklyFocusFile>(config_dir, "weekly-focus.yml", &mut errors)
        .unwrap_or_default();
    let reminders_file =
        load_yaml::<DayRemindersFile>(config_dir, "day-reminders.yml", &mut errors)
            .unwrap_or_default();
    let schedule_file = load_yaml::<DayScheduleFile>(config_dir, "day-schedule.yml", &mut errors)
        .unwrap_or_default();

    if let Some(rotation) = &focus_file.rotation {
        if rotation != "cycle" {
            errors.push(ConfigError {
                file: "weekly-focus.yml".into(),
                line: None,
                message: format!("unsupported rotation '{rotation}', only 'cycle' is supported"),
            });
        }
    }

    let mut focus = None;
    let mut days = Vec::new();
    for (i, date_str) in dates.iter().enumerate() {
        let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") else {
            continue;
        };
        if i == 0 {
            let week = date.iso_week();
            focus = focus_for_week(conn, week.year(), week.week(), focus_file.phrases.len())?
                .map(|index| focus_file.phrases[index].clone());
        }
        days.push(DayContext {
            date: date_str.clone(),
            reminders: reminders_file
                .reminders
                .iter()
                .filter(|r| matches_day_type(&r.day_type, date))
                .map(|r| r.text.clone())
                .collect(),
        });
    }

    Ok(DashboardContext {
        focus,
        days,
        blocks: schedule_file.blocks,
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::fs;
    use std::path::PathBuf;

    fn setup(name: &str) -> (Connection, PathBuf) {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let dir = std::env::temp_dir().join(format!("app-pkb-reminders-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        (conn, dir)
    }

    #[test]
    fn day_type_matching() {
        let monday = NaiveDate::from_ymd_opt(2026, 8, 24).unwrap();
        let saturday = NaiveDate::from_ymd_opt(2026, 8, 29).unwrap();
        assert!(matches_day_type("workday", monday));
        assert!(!matches_day_type("workday", saturday));
        assert!(matches_day_type("weekend", saturday));
        assert!(matches_day_type("mon", monday));
        assert!(matches_day_type("Saturday", saturday));
        assert!(!matches_day_type("nonsense", monday));
    }

    #[test]
    fn focus_rotates_per_iso_week_and_is_stable_within_week() {
        let (conn, dir) = setup("focus");
        fs::write(
            dir.join("weekly-focus.yml"),
            "rotation: cycle\nphrases:\n  - \"A\"\n  - \"B\"\n",
        )
        .unwrap();

        // week 35 of 2026 assigned first phrase, repeatedly
        let ctx1 = dashboard_context(&conn, &dir, &["2026-08-24".to_string()]).unwrap();
        assert_eq!(ctx1.focus.as_deref(), Some("A"));
        let ctx1b = dashboard_context(&conn, &dir, &["2026-08-26".to_string()]).unwrap();
        assert_eq!(ctx1b.focus.as_deref(), Some("A"));

        // next ISO week cycles to the next phrase, then wraps
        let ctx2 = dashboard_context(&conn, &dir, &["2026-08-31".to_string()]).unwrap();
        assert_eq!(ctx2.focus.as_deref(), Some("B"));
        let ctx3 = dashboard_context(&conn, &dir, &["2026-09-07".to_string()]).unwrap();
        assert_eq!(ctx3.focus.as_deref(), Some("A"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reminders_and_blocks_delivered_per_day() {
        let (conn, dir) = setup("ctx");
        fs::write(
            dir.join("day-reminders.yml"),
            "reminders:\n  - day_type: workday\n    text: \"Plan first hour\"\n  - day_type: sat\n    text: \"Rest\"\n",
        )
        .unwrap();
        fs::write(
            dir.join("day-schedule.yml"),
            "blocks:\n  - from: \"09:00\"\n    to: \"12:30\"\n    label: \"Deep work\"\n",
        )
        .unwrap();

        let ctx = dashboard_context(
            &conn,
            &dir,
            &["2026-08-28".to_string(), "2026-08-29".to_string()],
        )
        .unwrap();
        assert_eq!(ctx.days[0].reminders, vec!["Plan first hour"]); // Friday
        assert_eq!(ctx.days[1].reminders, vec!["Rest"]); // Saturday
        assert_eq!(ctx.blocks.len(), 1);
        assert!(ctx.errors.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
