use std::fs;
use std::path::{Path, PathBuf};

use chrono::NaiveDate;
use serde::Serialize;

use crate::error::{Error, Result};

#[derive(Debug, Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct JournalEntry {
    pub date: String,
    pub content: String,
}

fn validate_date(date: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| Error::State(format!("invalid journal date: {date}")))
}

/// chrono accepts non-padded input ("2026-8-5"), which would create a
/// second file next to "2026-08-05.md" and sort wrong; normalize.
fn normalize_date(date: &str) -> Result<String> {
    Ok(validate_date(date)?.format("%Y-%m-%d").to_string())
}

fn entry_path(vault: &Path, date: &str) -> Result<PathBuf> {
    let parsed = validate_date(date)?;
    Ok(vault
        .join("journal")
        .join(parsed.format("%Y").to_string())
        .join(format!("{}.md", parsed.format("%Y-%m-%d"))))
}

/// The template lives with the other config files (it used to sit in
/// journal/templates/daily.md, which cluttered the notes tree); an old
/// file is moved over on first access.
fn template_path(vault: &Path) -> PathBuf {
    let new = vault.join("config").join("journal-template.md");
    let old = vault.join("journal").join("templates").join("daily.md");
    if !new.exists() && old.exists() {
        let _ = fs::create_dir_all(vault.join("config"));
        if fs::rename(&old, &new).is_err() {
            if let Ok(content) = fs::read_to_string(&old) {
                if crate::vault::write_atomic(&new, &content).is_ok() {
                    let _ = fs::remove_file(&old);
                }
            }
        }
    }
    new
}

/// Opens the entry for the date, instantiating it from the template on
/// first open ({{date}} placeholder is substituted).
pub fn open_entry(vault: &Path, date: &str) -> Result<JournalEntry> {
    let date = normalize_date(date)?;
    let path = entry_path(vault, &date)?;
    if path.exists() {
        return Ok(JournalEntry {
            content: fs::read_to_string(&path)?,
            date,
        });
    }
    let template = fs::read_to_string(template_path(vault)).unwrap_or_default();
    let content = template.replace("{{date}}", &date);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    crate::vault::write_atomic(&path, &content)?;
    Ok(JournalEntry { date, content })
}

pub fn save_entry(vault: &Path, date: &str, content: &str) -> Result<()> {
    let path = entry_path(vault, date)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    // Journal text is primary user data: a crash mid-autosave must not
    // truncate the entry, same guarantee the YAML configs already have.
    crate::vault::write_atomic(&path, content)?;
    Ok(())
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
        for file in fs::read_dir(year_entry.path())? {
            let file = file?;
            let name = file.file_name().to_string_lossy().into_owned();
            if let Some(date) = name.strip_suffix(".md") {
                if validate_date(date).is_ok() {
                    dates.push(date.to_string());
                }
            }
        }
    }
    dates.sort_by(|a, b| b.cmp(a));
    Ok(dates)
}

pub fn read_template(vault: &Path) -> Result<String> {
    Ok(fs::read_to_string(template_path(vault)).unwrap_or_default())
}

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
    fn old_template_location_migrates_to_config() {
        let vault = vault("tpl-migrate");
        let old = vault.join("journal").join("templates").join("daily.md");
        fs::write(&old, "# {{date}}\n").unwrap();

        assert_eq!(read_template(&vault).unwrap(), "# {{date}}\n");
        assert!(!old.exists());
        assert!(vault.join("config").join("journal-template.md").exists());
    }

    #[test]
    fn first_open_instantiates_template_with_date() {
        let vault = vault("open");
        fs::write(template_path(&vault), "# {{date}}\n\n## What I did today\n").unwrap();

        let entry = open_entry(&vault, "2026-08-28").unwrap();
        assert!(entry.content.starts_with("# 2026-08-28"));
        assert!(vault
            .join("journal")
            .join("2026")
            .join("2026-08-28.md")
            .exists());

        // second open returns the saved file, not a fresh template copy
        save_entry(&vault, "2026-08-28", "edited").unwrap();
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
        fs::write(template_path(&vault), "tpl").unwrap();

        let dates = list_entries(&vault).unwrap();
        assert_eq!(dates, vec!["2026-08-28", "2026-08-27", "2025-12-31"]);
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
