use std::fs;
use std::path::{Path, PathBuf};

use chrono::NaiveDate;
use serde::Serialize;

use crate::error::{Error, Result};

pub(crate) const DEFAULT_TEMPLATE: &str = "\
# {{date}}

## What I did today

## What was hard

## What I am grateful for

## Focus for tomorrow
";

#[derive(Debug, Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct JournalEntry {
    pub date: String,
    pub content: String,
}

#[derive(Debug, Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct JournalSearchHit {
    pub date: String,
    #[ts(type = "number")]
    pub line: usize,
    pub preview: String,
}

const SEARCH_MAX_HITS: usize = 50;
const SEARCH_MAX_FILE_BYTES: u64 = 1_000_000;

fn validate_date(date: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| Error::State(format!("invalid journal date: {date}")))
}

/// chrono accepts non-padded input ("2026-8-5"), which would create a
/// second file next to "2026-08-05.md" and sort wrong; normalize.
fn normalize_date(date: &str) -> Result<String> {
    Ok(validate_date(date)?.format("%Y-%m-%d").to_string())
}

pub(crate) fn entry_path(vault: &Path, date: &str) -> Result<PathBuf> {
    let parsed = validate_date(date)?;
    Ok(vault
        .join("journal")
        .join(parsed.format("%Y").to_string())
        .join(format!("{}.md", parsed.format("%Y-%m-%d"))))
}

/// The template lives in <configs>/templates/ so it shows up under the
/// Config group in Notes; older locations (config/journal-template.md
/// and journal/templates/daily.md) are moved over on first access, and
/// a vault that never had a template gets the default written out so
/// there is a file to edit.
fn template_path(vault: &Path) -> PathBuf {
    let config_dir = crate::vault::config_dir(vault);
    let new = config_dir.join("templates").join("journal.md");
    let legacy = [
        config_dir.join("journal-template.md"),
        vault.join("journal").join("templates").join("daily.md"),
    ];
    if !new.exists() {
        let _ = fs::create_dir_all(config_dir.join("templates"));
        for old in legacy {
            if !old.exists() {
                continue;
            }
            if fs::rename(&old, &new).is_err() {
                if let Ok(content) = fs::read_to_string(&old) {
                    if crate::vault::write_atomic(&new, &content).is_ok() {
                        let _ = fs::remove_file(&old);
                    }
                }
            }
            break;
        }
        if !new.exists() {
            let _ = fs::write(&new, DEFAULT_TEMPLATE);
        }
    }
    new
}

/// Runs the template migration (see template_path) at vault open, so
/// the old journal/templates/daily.md moves to config/ even when the
/// template itself is never opened in this session.
pub fn ensure_template_location(vault: &Path) {
    let _ = template_path(vault);
}

/// Opens the entry for the date. A missing entry is served from the
/// template ({{date}} substituted) WITHOUT creating the file: merely
/// looking at a day must not litter the journal with untouched entries.
/// The file appears on the first actual edit (save_entry).
pub fn open_entry(vault: &Path, date: &str) -> Result<JournalEntry> {
    let date = normalize_date(date)?;
    let path = entry_path(vault, &date)?;
    if path.exists() {
        return Ok(JournalEntry {
            content: fs::read_to_string(&path)?,
            date,
        });
    }
    let content = read_template(vault)?.replace("{{date}}", &date);
    Ok(JournalEntry { date, content })
}

#[cfg(test)]
pub fn save_entry(vault: &Path, date: &str, content: &str) -> Result<()> {
    save_entry_from(vault, date, content, None).map(|_| ())
}

/// `save_entry` for an editor whose text started out as `base`: what
/// changed on disk since then is merged in, not overwritten
/// (`text_merge::reconcile_save`). The result's `text` is what is now
/// on disk.
pub fn save_entry_from(
    vault: &Path,
    date: &str,
    content: &str,
    base: Option<&str>,
) -> Result<crate::text_merge::Reconciled> {
    let path = entry_path(vault, date)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let on_disk = fs::read_to_string(&path).ok();
    let day = chrono::Local::now().format("%Y-%m-%d").to_string();
    let saved = crate::text_merge::reconcile_save(&path, on_disk.as_deref(), base, content, &day)?;
    // Journal text is primary user data: a crash mid-autosave must not
    // truncate the entry, same guarantee the YAML configs already have.
    if on_disk.as_deref() != Some(saved.text.as_str()) {
        crate::vault::write_atomic(&path, &saved.text)?;
    }
    Ok(saved)
}

/// All existing entry dates, newest first.
pub fn list_entries(vault: &Path) -> Result<Vec<String>> {
    let journal_dir = vault.join("journal");
    let mut dates = Vec::new();
    if !journal_dir.exists() {
        return Ok(dates);
    }
    for year_entry in fs::read_dir(&journal_dir)? {
        let year_entry = year_entry?;
        if !year_entry.file_type()?.is_dir() || year_entry.file_name() == "templates" {
            continue;
        }
        let year_name = year_entry.file_name().to_string_lossy().into_owned();
        for file in fs::read_dir(year_entry.path())? {
            let file = file?;
            let name = file.file_name().to_string_lossy().into_owned();
            if let Some(date) = name.strip_suffix(".md") {
                // `entry_path` re-derives <year>/<YYYY-MM-DD>.md from the
                // date, so a file that is not exactly there would list
                // but open as an empty template
                let Ok(parsed) = validate_date(date) else {
                    continue;
                };
                if parsed.format("%Y-%m-%d").to_string() == date
                    && parsed.format("%Y").to_string() == year_name
                {
                    dates.push(date.to_string());
                }
            }
        }
    }
    dates.sort_by(|a, b| b.cmp(a));
    Ok(dates)
}

/// Case-insensitive content search over all entries, newest first, one
/// hit (the first matching line) per entry.
pub fn search_entries(vault: &Path, query: &str) -> Result<Vec<JournalSearchHit>> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(vec![]);
    }
    let mut hits = Vec::new();
    for date in list_entries(vault)? {
        let path = entry_path(vault, &date)?;
        if fs::metadata(&path).map(|m| m.len()).unwrap_or(u64::MAX) > SEARCH_MAX_FILE_BYTES {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        for (i, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&query) {
                hits.push(JournalSearchHit {
                    date: date.clone(),
                    line: i + 1,
                    preview: line.trim().chars().take(120).collect(),
                });
                break;
            }
        }
        if hits.len() >= SEARCH_MAX_HITS {
            break;
        }
    }
    Ok(hits)
}

#[derive(Debug, Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct JournalBacklinkHit {
    pub date: String,
    #[ts(type = "number")]
    pub line: usize,
    pub preview: String,
    /// True for a [[wiki link]] hit, false for a plain-text mention.
    pub is_link: bool,
}

/// Journal entries whose text points at a note: per entry a [[wiki
/// link]] beats a plain mention, the same rules kb::backlinks applies
/// to notes. Newest entries first, same caps as the note scan. The
/// entry named like the note itself is skipped - with the KB rooted at
/// the vault a journal entry is a note, and its own template date would
/// always self-match.
pub fn backlinks(vault: &Path, stem: &str, full_name: &str) -> Result<Vec<JournalBacklinkHit>> {
    let stem = stem.trim().to_lowercase();
    let full_name = full_name.trim().to_lowercase();
    let mut hits = Vec::new();
    if stem.is_empty() {
        return Ok(hits);
    }
    for date in list_entries(vault)? {
        if date.to_lowercase() == stem {
            continue;
        }
        let path = entry_path(vault, &date)?;
        if fs::metadata(&path).map(|m| m.len()).unwrap_or(u64::MAX)
            > crate::kb::SEARCH_MAX_FILE_BYTES
        {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let mut link_hit: Option<JournalBacklinkHit> = None;
        let mut mention_hit: Option<JournalBacklinkHit> = None;
        for (i, line) in content.lines().enumerate() {
            let hit = |line: &str, is_link: bool| JournalBacklinkHit {
                date: date.clone(),
                line: i + 1,
                preview: line.trim().chars().take(120).collect(),
                is_link,
            };
            if crate::kb::wiki_targets(line)
                .iter()
                .any(|t| *t == stem || *t == full_name)
            {
                link_hit = Some(hit(line, true));
                break;
            }
            if mention_hit.is_none()
                && stem.chars().count() >= crate::kb::MENTION_MIN_CHARS
                && line.to_lowercase().contains(&stem)
            {
                mention_hit = Some(hit(line, false));
            }
        }
        if let Some(hit) = link_hit.or(mention_hit) {
            hits.push(hit);
        }
        if hits.len() >= crate::kb::SEARCH_MAX_HITS {
            break;
        }
    }
    Ok(hits)
}

/// A missing template falls back to the built-in default; any other
/// read failure (permissions, a sync client holding the file) is a real
/// error - swallowing it here would show an empty template that a
/// subsequent save then writes over the actual file.
pub fn read_template(vault: &Path) -> Result<String> {
    match fs::read_to_string(template_path(vault)) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(DEFAULT_TEMPLATE.into()),
        Err(e) => Err(Error::State(format!("cannot read journal template: {e}"))),
    }
}

// The template is edited through the Notes config editor these days;
// this writer remains as a test fixture helper.
#[cfg(test)]
pub fn save_template(vault: &Path, content: &str) -> Result<()> {
    let path = template_path(vault);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    crate::vault::write_atomic(&path, content)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("app-pkb-journal-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("journal").join("templates")).unwrap();
        fs::create_dir_all(dir.join("config")).unwrap();
        dir
    }

    #[test]
    fn backlinks_split_links_and_mentions_and_skip_the_self_entry() {
        let vault = vault("backlinks");
        save_entry(&vault, "2026-09-01", "met [[Alpha Project]] team\n").unwrap();
        save_entry(&vault, "2026-09-02", "alpha project moving along\n").unwrap();
        save_entry(&vault, "2026-09-03", "nothing relevant\n").unwrap();
        save_entry(&vault, "2026-09-04", "2026-09-04 self date\n").unwrap();

        let hits = backlinks(&vault, "Alpha Project", "Alpha Project.md").unwrap();
        assert_eq!(hits.len(), 2);
        // newest first; a link is marked apart from a plain mention
        assert_eq!(hits[0].date, "2026-09-02");
        assert!(!hits[0].is_link);
        assert_eq!(hits[1].date, "2026-09-01");
        assert!(hits[1].is_link);

        // the entry named like the note never self-matches on its date
        let self_hits = backlinks(&vault, "2026-09-04", "2026-09-04.md").unwrap();
        assert!(self_hits.iter().all(|h| h.date != "2026-09-04"));
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn backlink_mentions_respect_the_min_name_length() {
        let vault = vault("backlinks-short");
        save_entry(&vault, "2026-09-01", "an ab mention\n").unwrap();
        let hits = backlinks(&vault, "ab", "ab.md").unwrap();
        assert!(hits.is_empty());
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn old_template_locations_migrate_to_config_templates() {
        let vault = vault("tpl-migrate");
        let oldest = vault.join("journal").join("templates").join("daily.md");
        fs::write(&oldest, "# {{date}}\n").unwrap();

        assert_eq!(read_template(&vault).unwrap(), "# {{date}}\n");
        assert!(!oldest.exists());
        let target = crate::vault::config_dir(&vault)
            .join("templates")
            .join("journal.md");
        assert!(target.exists());

        // the intermediate config/journal-template.md location migrates
        // the same way
        fs::remove_file(&target).unwrap();
        let mid = crate::vault::config_dir(&vault).join("journal-template.md");
        fs::write(&mid, "mid\n").unwrap();
        assert_eq!(read_template(&vault).unwrap(), "mid\n");
        assert!(!mid.exists());
        assert!(target.exists());
    }

    #[test]
    fn first_open_serves_template_without_creating_file() {
        let vault = vault("open");
        save_template(&vault, "# {{date}}\n\n## What I did today\n").unwrap();

        let entry = open_entry(&vault, "2026-08-28").unwrap();
        assert!(entry.content.starts_with("# 2026-08-28"));
        // no file until something is actually written
        assert!(!vault
            .join("journal")
            .join("2026")
            .join("2026-08-28.md")
            .exists());
        assert!(list_entries(&vault).unwrap().is_empty());

        // the first edit creates the file; reopen returns the saved text
        save_entry(&vault, "2026-08-28", "edited").unwrap();
        assert!(vault
            .join("journal")
            .join("2026")
            .join("2026-08-28.md")
            .exists());
        let reopened = open_entry(&vault, "2026-08-28").unwrap();
        assert_eq!(reopened.content, "edited");
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn list_returns_dates_newest_first_ignoring_templates() {
        let vault = vault("list");
        save_entry(&vault, "2026-08-27", "a").unwrap();
        save_entry(&vault, "2026-08-28", "b").unwrap();
        save_entry(&vault, "2025-12-31", "c").unwrap();
        save_template(&vault, "tpl").unwrap();

        let dates = list_entries(&vault).unwrap();
        assert_eq!(dates, vec!["2026-08-28", "2026-08-27", "2025-12-31"]);
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn search_finds_entries_newest_first_case_insensitive() {
        let vault = vault("search");
        save_entry(&vault, "2026-08-27", "walked the DOG\nmore text").unwrap();
        save_entry(&vault, "2026-08-28", "quiet day").unwrap();
        save_entry(&vault, "2026-08-29", "dog again\nand dog once more").unwrap();

        let hits = search_entries(&vault, "dog").unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].date, "2026-08-29");
        assert_eq!(hits[0].line, 1);
        assert_eq!(hits[0].preview, "dog again");
        assert_eq!(hits[1].date, "2026-08-27");
        assert!(search_entries(&vault, "  ").unwrap().is_empty());
        assert!(search_entries(&vault, "absent").unwrap().is_empty());
        let _ = fs::remove_dir_all(&vault);
    }

    #[test]
    fn invalid_date_rejected() {
        let vault = vault("invalid");
        assert!(open_entry(&vault, "2026-13-99").is_err());
        assert!(open_entry(&vault, "../../etc/passwd").is_err());
        let _ = fs::remove_dir_all(&vault);
    }
}
