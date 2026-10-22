//! CRUD and validation for the task config YAML files. The files are
//! the source of truth; quick-add and inline edits splice the touched
//! item's lines only, so comments and blank lines elsewhere survive.
//! YAML files in subfolders of config/ merge into the same sections
//! (see `load_extras`), which makes drop-in task packs possible.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::NaiveDate;
use croner::Cron;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{IoContext, Result};
use crate::reminders::{DayReminder, ScheduleBlock};

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ConfigError {
    pub file: String,
    #[ts(type = "number | null")]
    pub line: Option<usize>,
    pub message: String,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RecurringFile {
    #[serde(default)]
    pub(crate) tasks: Vec<RecurringRule>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct RecurringRule {
    pub schedule: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub items: Vec<String>,
    /// Completion-rate alert threshold for this rule's items, percent;
    /// absent = `config.habit_rate_threshold`. Not part of the rule key,
    /// so setting it never regenerates or orphans the rule's history.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub threshold: Option<u32>,
}

fn check_threshold(rule: &RecurringRule) -> Result<()> {
    match rule.threshold {
        Some(t) if t > 100 => Err(crate::error::Error::State(format!(
            "rate threshold {t}% is out of range, expected 0-100"
        ))),
        _ => Ok(()),
    }
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct ScheduledFile {
    #[serde(default)]
    pub(crate) events: Vec<ScheduledEvent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct BirthdayEntry {
    pub name: String,
    /// MM-DD
    pub date: String,
    #[serde(default)]
    pub year: Option<i32>,
}

/// "MM-DD" -> (month, day), validated against a real calendar (a leap
/// year, so 02-29 passes but 02-30 or 04-31 do not).
pub(crate) fn parse_mmdd(date: &str) -> Option<(u32, u32)> {
    let (m, d) = date.split_once('-')?;
    let (m, d) = (m.parse().ok()?, d.parse().ok()?);
    NaiveDate::from_ymd_opt(2024, m, d).map(|_| (m, d))
}

/// The calendar occurrence of an MM-DD birthday in `year`; 02-29 falls
/// back to 02-28 in non-leap years.
pub(crate) fn birthday_occurrence(year: i32, month: u32, day: u32) -> Option<NaiveDate> {
    NaiveDate::from_ymd_opt(year, month, day).or_else(|| {
        if month == 2 && day == 29 {
            NaiveDate::from_ymd_opt(year, 2, 28)
        } else {
            None
        }
    })
}

/// Title of a generated birthday task. Single source of truth: the
/// engine's title-sync UPDATE and the calendar projection compare these
/// strings, so they must be byte-identical everywhere.
pub(crate) fn birthday_title(name: &str, birth_year: Option<i32>, occurrence_year: i32) -> String {
    match birth_year {
        Some(year) => format!("Birthday: {name} (turns {})", occurrence_year - year),
        None => format!("Birthday: {name}"),
    }
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

/// YAML files in subfolders of the config dir (recursive), sorted so
/// merge order is deterministic. The top-level files stay canonical.
pub(crate) fn extra_config_files(dir: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, root: bool, out: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, false, out);
            } else if !root
                && matches!(
                    path.extension().and_then(|e| e.to_str()),
                    Some("yml") | Some("yaml")
                )
            {
                out.push(path);
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, true, &mut out);
    out.sort();
    out
}

/// Loads every subfolder YAML whose top level carries `key`, so a file
/// with a `tasks:` section merges into recurring, `events:` into
/// scheduled, and so on - one file may feed several sections. Returns
/// (path relative to config/, parsed value).
pub(crate) fn load_extras<T: serde::de::DeserializeOwned>(
    dir: &Path,
    key: &str,
    errors: &mut Vec<ConfigError>,
) -> Vec<(String, T)> {
    let mut out = Vec::new();
    for path in extra_config_files(dir) {
        let name = path
            .strip_prefix(dir)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path.to_string_lossy().into_owned());
        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            // an unreadable pack silently vanishing from generation
            // would look like the user deleted its rules
            Err(e) => {
                errors.push(ConfigError {
                    file: name,
                    line: None,
                    message: format!("cannot read file: {e}"),
                });
                continue;
            }
        };
        let value: serde_yaml::Value = match serde_yaml::from_str(&raw) {
            Ok(value) => value,
            Err(e) => {
                errors.push(ConfigError {
                    file: name,
                    line: e.location().map(|l| l.line()),
                    message: e.to_string(),
                });
                continue;
            }
        };
        if value.get(key).is_none() {
            continue;
        }
        match serde_yaml::from_value::<T>(value) {
            Ok(parsed) => out.push((name, parsed)),
            Err(e) => errors.push(ConfigError {
                file: name,
                line: None,
                message: e.to_string(),
            }),
        }
    }
    out
}

/// Line spans of the `- ` items under the top-level `key:` line.
/// `items` are (start, end) line ranges (end exclusive); `insert_at` is
/// where an appended item goes. Returns None when the layout defeats
/// the scanner (e.g. a flow list on the key line) - callers then fall
/// back to a full parse-and-rewrite, which reformats.
struct SectionSpan {
    insert_at: usize,
    items: Vec<(usize, usize)>,
    indent: String,
}

fn scan_section(lines: &[&str], key: &str) -> Option<SectionSpan> {
    let key_prefix = format!("{key}:");
    let key_line = lines.iter().position(|line| {
        line.strip_prefix(&key_prefix)
            .map(|rest| rest.trim().is_empty() || rest.trim_start().starts_with('#'))
            .unwrap_or(false)
    })?;
    // section runs until the next top-level key (a line whose first
    // char is not whitespace, '-' or '#')
    let mut end = lines.len();
    for (i, line) in lines.iter().enumerate().skip(key_line + 1) {
        if let Some(first) = line.chars().next() {
            if !first.is_whitespace() && first != '-' && first != '#' {
                end = i;
                break;
            }
        }
    }
    let mut items: Vec<(usize, usize)> = Vec::new();
    let mut indent: Option<String> = None;
    for (i, line) in lines.iter().enumerate().take(end).skip(key_line + 1) {
        let this_indent = &line[..line.len() - line.trim_start().len()];
        if line.trim_start().starts_with("- ") || line.trim_start() == "-" {
            match &indent {
                None => {
                    indent = Some(this_indent.to_string());
                    items.push((i, end));
                }
                Some(indent) if this_indent == indent => {
                    if let Some(last) = items.last_mut() {
                        last.1 = i;
                    }
                    items.push((i, end));
                }
                // deeper "- " lines are nested list values of the item
                _ => {}
            }
        }
    }
    // blank and comment-only lines before a boundary belong to the file,
    // not to the item being spliced out
    for span in items.iter_mut() {
        while span.1 > span.0 + 1 {
            let line = lines[span.1 - 1].trim();
            if line.is_empty() || line.starts_with('#') {
                span.1 -= 1;
            } else {
                break;
            }
        }
    }
    let insert_at = items.last().map(|s| s.1).unwrap_or(key_line + 1);
    Some(SectionSpan {
        insert_at,
        items,
        indent: indent.unwrap_or_else(|| "  ".into()),
    })
}

/// Serializes one list item, indented to match the section.
fn to_item_block<T: serde::Serialize>(value: &T, indent: &str) -> Result<String> {
    let yaml = serde_yaml::to_string(&[value])?;
    let mut out = String::new();
    for line in yaml.lines() {
        if line.is_empty() {
            out.push('\n');
        } else {
            out.push_str(indent);
            out.push_str(line);
            out.push('\n');
        }
    }
    Ok(out)
}

/// Splices one list item in `file` under `key`: append (`at` None),
/// replace, or delete (replacement None). Only the touched lines
/// change; everything else, comments included, stays byte-identical.
/// The result is re-parsed with `check` before anything is written.
fn splice_item<T: serde::Serialize>(
    config_dir: &Path,
    file: &str,
    key: &str,
    at: Option<usize>,
    replacement: Option<&T>,
    check: impl Fn(&str) -> Option<String>,
) -> Result<()> {
    let path = config_dir.join(file);
    // Only a missing file starts empty. Anything else that stops the read
    // (a lock, bytes that are not UTF-8) must not be taken for "no rules
    // yet": the splice would write the new item over everything there.
    let mut raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e).at(&path),
    };
    if raw.trim().is_empty() {
        raw = format!("{key}:\n");
    }
    // normalize a bare `key: []` so items can be spliced under it
    let normalized: String;
    {
        let lines: Vec<&str> = raw.lines().collect();
        if scan_section(&lines, key).is_none() {
            let empty_flow = format!("{key}: []");
            if lines.iter().any(|l| l.trim_end() == empty_flow) {
                normalized = raw.replace(&empty_flow, &format!("{key}:"));
                raw = normalized;
            } else if !lines.iter().any(|l| l.starts_with(&format!("{key}:"))) {
                if !raw.ends_with('\n') {
                    raw.push('\n');
                }
                raw.push_str(&format!("{key}:\n"));
            }
        }
    }
    let lines: Vec<&str> = raw.lines().collect();
    let section = scan_section(&lines, key).ok_or_else(|| {
        crate::error::Error::State(format!(
            "cannot edit {file}: the {key} section uses a layout the app \
             cannot splice; edit the file in Notes instead"
        ))
    })?;
    let mut new_lines: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
    match at {
        None => {
            let replacement = replacement.ok_or_else(|| {
                crate::error::Error::State(format!("cannot edit {file}: nothing to append"))
            })?;
            let block = to_item_block(replacement, &section.indent)?;
            let insert: Vec<String> = block.lines().map(str::to_string).collect();
            new_lines.splice(section.insert_at..section.insert_at, insert);
        }
        Some(index) => {
            let span = *section.items.get(index).ok_or_else(|| {
                crate::error::Error::State(format!(
                    "item {} not found in {file} (edited externally?)",
                    index + 1
                ))
            })?;
            let insert: Vec<String> = match replacement {
                Some(value) => to_item_block(value, &section.indent)?
                    .lines()
                    .map(str::to_string)
                    .collect(),
                None => Vec::new(),
            };
            new_lines.splice(span.0..span.1, insert);
        }
    }
    let mut content = new_lines.join("\n");
    content.push('\n');
    if let Some(problem) = check(&content) {
        return Err(crate::error::Error::State(format!(
            "refusing to write {file}: {problem}"
        )));
    }
    crate::vault::write_atomic(&path, &content)?;
    Ok(())
}

fn check_recurring(content: &str) -> Option<String> {
    serde_yaml::from_str::<RecurringFile>(content)
        .err()
        .map(|e| e.to_string())
}

fn check_scheduled(content: &str) -> Option<String> {
    serde_yaml::from_str::<ScheduledFile>(content)
        .err()
        .map(|e| e.to_string())
}

fn check_birthdays(content: &str) -> Option<String> {
    serde_yaml::from_str::<BirthdaysFile>(content)
        .err()
        .map(|e| e.to_string())
}

pub fn append_recurring(config_dir: &Path, mut rule: RecurringRule) -> Result<()> {
    Cron::new(&rule.schedule).parse().map_err(|e| {
        crate::error::Error::State(format!("invalid cron '{}': {e}", rule.schedule))
    })?;
    rule.items.retain(|item| !item.trim().is_empty());
    if rule.items.is_empty() {
        return Err(crate::error::Error::State(
            "a recurring rule needs at least one item".into(),
        ));
    }
    check_threshold(&rule)?;
    splice_item(
        config_dir,
        "recurring.yml",
        "tasks",
        None,
        Some(&rule),
        check_recurring,
    )
}

/// Quick-add write-back (req. 21-22). Items are spliced in as text, so
/// the rest of the file - comments and blank lines included - is
/// preserved as-is.
pub fn append_scheduled(config_dir: &Path, event: ScheduledEvent) -> Result<()> {
    NaiveDate::parse_from_str(&event.date, "%Y-%m-%d")
        .map_err(|_| crate::error::Error::State(format!("invalid date: {}", event.date)))?;
    splice_item(
        config_dir,
        "scheduled.yml",
        "events",
        None,
        Some(&event),
        check_scheduled,
    )
}

pub fn append_birthday(config_dir: &Path, entry: BirthdayEntry) -> Result<()> {
    if parse_mmdd(&entry.date).is_none() {
        return Err(crate::error::Error::State(format!(
            "invalid birthday date '{}', expected MM-DD",
            entry.date
        )));
    }
    splice_item(
        config_dir,
        "birthdays.yml",
        "birthdays",
        None,
        Some(&entry),
        check_birthdays,
    )
}

/// Loads a file an edit is about to splice into; a file that does not
/// parse is refused rather than spliced blind.
fn load_for_edit<T: serde::de::DeserializeOwned + Default>(
    config_dir: &Path,
    file: &str,
) -> Result<T> {
    let mut errors = Vec::new();
    load_yaml::<T>(config_dir, file, &mut errors).ok_or_else(|| {
        crate::error::Error::State(format!(
            "{file} is invalid, fix it before editing it here: {}",
            errors.first().map(|e| e.message.as_str()).unwrap_or("")
        ))
    })
}

/// An index edit lands only on the item the editor was opened on: the
/// file can change under an open editor (a sync pass, an edit in Notes),
/// and a bare index would then overwrite or delete a different item.
fn ensure_unchanged<T: PartialEq>(
    items: &[T],
    index: usize,
    original: &T,
    file: &str,
) -> Result<()> {
    if items.get(index) == Some(original) {
        return Ok(());
    }
    Err(crate::error::Error::State(format!(
        "{file} changed since this item was opened (item {} is no longer the one being edited); \
         nothing was written - reopen it and try again",
        index + 1
    )))
}

/// Replaces (or, with `None`, removes) the rule at `index` in file
/// order, provided it is still `original`; the Recurring view lists
/// rules unfiltered, so the index is file order.
pub fn edit_recurring(
    config_dir: &Path,
    index: usize,
    original: &RecurringRule,
    replacement: Option<RecurringRule>,
) -> Result<()> {
    let file = load_for_edit::<RecurringFile>(config_dir, "recurring.yml")?;
    ensure_unchanged(&file.tasks, index, original, "recurring.yml")?;
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
            check_threshold(&rule)?;
            splice_item(
                config_dir,
                "recurring.yml",
                "tasks",
                Some(index),
                Some(&rule),
                check_recurring,
            )
        }
        None => splice_item::<RecurringRule>(
            config_dir,
            "recurring.yml",
            "tasks",
            Some(index),
            None,
            check_recurring,
        ),
    }
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
    let file =
        load_yaml::<ScheduledFile>(config_dir, "scheduled.yml", &mut errors).ok_or_else(|| {
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
            splice_item(
                config_dir,
                "scheduled.yml",
                "events",
                Some(pos),
                Some(&event),
                check_scheduled,
            )
        }
        None => splice_item::<ScheduledEvent>(
            config_dir,
            "scheduled.yml",
            "events",
            Some(pos),
            None,
            check_scheduled,
        ),
    }
}

pub fn edit_birthday(
    config_dir: &Path,
    original: BirthdayEntry,
    replacement: Option<BirthdayEntry>,
) -> Result<()> {
    let mut errors = Vec::new();
    let file =
        load_yaml::<BirthdaysFile>(config_dir, "birthdays.yml", &mut errors).ok_or_else(|| {
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
            splice_item(
                config_dir,
                "birthdays.yml",
                "birthdays",
                Some(pos),
                Some(&entry),
                check_birthdays,
            )
        }
        None => splice_item::<BirthdayEntry>(
            config_dir,
            "birthdays.yml",
            "birthdays",
            Some(pos),
            None,
            check_birthdays,
        ),
    }
}

fn check_weekly_focus(content: &str) -> Option<String> {
    serde_yaml::from_str::<crate::reminders::WeeklyFocusFile>(content)
        .err()
        .map(|e| e.to_string())
}

fn check_day_reminders(content: &str) -> Option<String> {
    serde_yaml::from_str::<crate::reminders::DayRemindersFile>(content)
        .err()
        .map(|e| e.to_string())
}

fn check_day_schedule(content: &str) -> Option<String> {
    serde_yaml::from_str::<crate::reminders::DayScheduleFile>(content)
        .err()
        .map(|e| e.to_string())
}

fn validate_reminder(entry: &DayReminder) -> Result<()> {
    if !crate::reminders::DAY_TYPES.contains(&entry.day_type.as_str()) {
        return Err(crate::error::Error::State(format!(
            "unknown day type '{}', expected one of {}",
            entry.day_type,
            crate::reminders::DAY_TYPES.join(", ")
        )));
    }
    if entry.text.trim().is_empty() {
        return Err(crate::error::Error::State(
            "a reminder needs some text".into(),
        ));
    }
    Ok(())
}

/// Validates a block and zero-pads its times: the day-schedule model
/// compares "HH:MM" strings lexicographically, so a "9:00" written into
/// the file would sort after 23:00 and never read as the current block.
fn validate_block(block: &mut ScheduleBlock) -> Result<()> {
    let pad = |value: &str| {
        chrono::NaiveTime::parse_from_str(value, "%H:%M").map(|t| t.format("%H:%M").to_string())
    };
    let (Ok(from), Ok(to)) = (pad(&block.from), pad(&block.to)) else {
        return Err(crate::error::Error::State(format!(
            "invalid block times '{}'-'{}', expected HH:MM",
            block.from, block.to
        )));
    };
    if block.label.trim().is_empty() {
        return Err(crate::error::Error::State(
            "a schedule block needs a label".into(),
        ));
    }
    block.from = from;
    block.to = to;
    Ok(())
}

/// The three reminder files have no packs, so the Reminders section
/// lists their items in file order and edits them by index.
pub fn append_focus_phrase(config_dir: &Path, phrase: String) -> Result<()> {
    let phrase = phrase.trim().to_string();
    if phrase.is_empty() {
        return Err(crate::error::Error::State("the phrase is empty".into()));
    }
    splice_item(
        config_dir,
        "weekly-focus.yml",
        "phrases",
        None,
        Some(&phrase),
        check_weekly_focus,
    )
}

pub fn edit_focus_phrase(
    config_dir: &Path,
    index: usize,
    original: &str,
    replacement: Option<String>,
) -> Result<()> {
    let file = load_for_edit::<crate::reminders::WeeklyFocusFile>(config_dir, "weekly-focus.yml")?;
    ensure_unchanged(
        &file.phrases,
        index,
        &original.to_string(),
        "weekly-focus.yml",
    )?;
    match replacement {
        Some(phrase) => {
            let phrase = phrase.trim().to_string();
            if phrase.is_empty() {
                return Err(crate::error::Error::State("the phrase is empty".into()));
            }
            splice_item(
                config_dir,
                "weekly-focus.yml",
                "phrases",
                Some(index),
                Some(&phrase),
                check_weekly_focus,
            )
        }
        None => splice_item::<String>(
            config_dir,
            "weekly-focus.yml",
            "phrases",
            Some(index),
            None,
            check_weekly_focus,
        ),
    }
}

pub fn append_day_reminder(config_dir: &Path, entry: DayReminder) -> Result<()> {
    validate_reminder(&entry)?;
    splice_item(
        config_dir,
        "day-reminders.yml",
        "reminders",
        None,
        Some(&entry),
        check_day_reminders,
    )
}

pub fn edit_day_reminder(
    config_dir: &Path,
    index: usize,
    original: &DayReminder,
    replacement: Option<DayReminder>,
) -> Result<()> {
    let file =
        load_for_edit::<crate::reminders::DayRemindersFile>(config_dir, "day-reminders.yml")?;
    ensure_unchanged(&file.reminders, index, original, "day-reminders.yml")?;
    match replacement {
        Some(entry) => {
            validate_reminder(&entry)?;
            splice_item(
                config_dir,
                "day-reminders.yml",
                "reminders",
                Some(index),
                Some(&entry),
                check_day_reminders,
            )
        }
        None => splice_item::<DayReminder>(
            config_dir,
            "day-reminders.yml",
            "reminders",
            Some(index),
            None,
            check_day_reminders,
        ),
    }
}

pub fn append_schedule_block(config_dir: &Path, mut block: ScheduleBlock) -> Result<()> {
    validate_block(&mut block)?;
    splice_item(
        config_dir,
        "day-schedule.yml",
        "blocks",
        None,
        Some(&block),
        check_day_schedule,
    )
}

pub fn edit_schedule_block(
    config_dir: &Path,
    index: usize,
    original: &ScheduleBlock,
    replacement: Option<ScheduleBlock>,
) -> Result<()> {
    // the Reminders view shows the blocks zero-padded, so compare the
    // file's blocks the way the view saw them
    let file = load_for_edit::<crate::reminders::DayScheduleFile>(config_dir, "day-schedule.yml")?;
    let blocks = crate::reminders::normalized_blocks(file);
    ensure_unchanged(&blocks, index, original, "day-schedule.yml")?;
    match replacement {
        Some(mut block) => {
            validate_block(&mut block)?;
            splice_item(
                config_dir,
                "day-schedule.yml",
                "blocks",
                Some(index),
                Some(&block),
                check_day_schedule,
            )
        }
        None => splice_item::<ScheduleBlock>(
            config_dir,
            "day-schedule.yml",
            "blocks",
            Some(index),
            None,
            check_day_schedule,
        ),
    }
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
    if content.trim().is_empty() || file.ends_with(".md") {
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
        "day-reminders.yml" => {
            match serde_yaml::from_str::<crate::reminders::DayRemindersFile>(content) {
                Ok(parsed) => {
                    for (index, entry) in parsed.reminders.iter().enumerate() {
                        if let Err(e) = validate_reminder(entry) {
                            errors.push(ConfigError {
                                file: file.into(),
                                line: None,
                                message: format!("reminder {}: {e}", index + 1),
                            });
                        }
                    }
                }
                Err(e) => push_yaml_error(e),
            }
        }
        "day-schedule.yml" => {
            match serde_yaml::from_str::<crate::reminders::DayScheduleFile>(content) {
                Ok(mut parsed) => {
                    for (index, block) in parsed.blocks.iter_mut().enumerate() {
                        // the padding validate_block applies is thrown
                        // away here: this path only reports, it never
                        // rewrites the file the user is editing
                        if let Err(e) = validate_block(block) {
                            errors.push(ConfigError {
                                file: file.into(),
                                line: None,
                                message: format!("block {}: {e}", index + 1),
                            });
                        }
                    }
                }
                Err(e) => push_yaml_error(e),
            }
        }
        "weekly-focus.yml" => {
            match serde_yaml::from_str::<crate::reminders::WeeklyFocusFile>(content) {
                Ok(parsed) => {
                    if let Some(rotation) = &parsed.rotation {
                        if rotation != "cycle" {
                            errors.push(ConfigError {
                                file: file.into(),
                                line: None,
                                message: format!(
                                    "unsupported rotation '{rotation}', only 'cycle' is supported"
                                ),
                            });
                        }
                    }
                }
                Err(e) => push_yaml_error(e),
            }
        }
        "app.yml" => match serde_yaml::from_str::<Option<serde_yaml::Mapping>>(content) {
            Ok(map) => {
                let map = map.unwrap_or_default();
                for key in map.keys() {
                    let name = key.as_str().unwrap_or("?");
                    if let Some(part) = crate::config::SyncedPart::ALL
                        .into_iter()
                        .find(|part| part.keys().contains(&name))
                    {
                        errors.push(ConfigError {
                            file: file.into(),
                            line: None,
                            message: format!(
                                "'{name}' is shared by your devices: it belongs in {}",
                                part.file()
                            ),
                        });
                    }
                }
                if let Err(e) = serde_yaml::from_value::<crate::config::AppConfig>(
                    serde_yaml::Value::Mapping(map),
                ) {
                    errors.push(ConfigError {
                        file: file.into(),
                        line: None,
                        message: e.to_string(),
                    });
                }
            }
            Err(e) => push_yaml_error(e),
        },
        "colors.yml" | "shared.yml" => {
            match serde_yaml::from_str::<Option<serde_yaml::Mapping>>(content) {
                Ok(map) => {
                    let part = crate::config::SyncedPart::from_file(file)
                        .unwrap_or(crate::config::SyncedPart::Colors);
                    let map = match part {
                        // the flat pre-theme layout still loads (as the dark set)
                        crate::config::SyncedPart::Colors => {
                            crate::config::nest_flat_colors(&map.unwrap_or_default())
                        }
                        crate::config::SyncedPart::Shared => map.unwrap_or_default(),
                    };
                    for key in map.keys() {
                        let name = key.as_str().unwrap_or("?");
                        if !part.keys().contains(&name) {
                            errors.push(ConfigError {
                                file: file.into(),
                                line: None,
                                message: format!("'{name}' does not belong in {file}"),
                            });
                        }
                    }
                    if part == crate::config::SyncedPart::Colors {
                        let color_keys = crate::config::ThemeColors::keys();
                        for theme in ["dark", "light"] {
                            let Some(set) = map.get(theme).and_then(|v| v.as_mapping()) else {
                                continue;
                            };
                            for key in set.keys() {
                                let name = key.as_str().unwrap_or("?");
                                if !color_keys.iter().any(|k| k == name) {
                                    errors.push(ConfigError {
                                        file: file.into(),
                                        line: None,
                                        message: format!("'{theme}.{name}' is not a color key"),
                                    });
                                }
                            }
                        }
                    }
                    // a wrong type (a list for a color, text for a number)
                    // would otherwise drop the whole file back to defaults
                    if let Err(e) = crate::config::AppConfig::default().with_part(part, &map) {
                        errors.push(ConfigError {
                            file: file.into(),
                            line: None,
                            message: e.to_string(),
                        });
                    }
                }
                Err(e) => push_yaml_error(e),
            }
        }
        _ => {
            if let Err(e) = serde_yaml::from_str::<serde_yaml::Value>(content) {
                push_yaml_error(e);
            }
        }
    }
    errors
}

#[cfg(test)]
mod tests;
