//! The conflict log: what a sync had to choose between, kept where a
//! person can read it. docs/android/ROADMAP.md Phase 3.
//!
//! REQUIREMENTS.md §7 asks for "no silent data loss on conflict". The
//! merge itself (`sync_merge.rs`, `sync_state.rs`) never drops a value
//! without handing it back; this is where those hand-backs go so they
//! survive the sync that produced them and can be shown later.
//!
//! Device-local on purpose, under `.hypomnema/sync/`: it records what
//! *this* device decided, and `sync_paths` keeps that directory out of
//! the shared vault. Uploading it would put one device's account of a
//! disagreement into the thing being disagreed about.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::sync_merge::FieldConflict;

const LOG_FILE: &str = ".hypomnema/sync/conflicts.json";

/// Kept entries. A conflict log is a diagnostic, not an archive: past a
/// few hundred entries nobody reads further, and the newest ones are the
/// ones that explain what just happened.
const MAX_ENTRIES: usize = 300;

/// One resolved disagreement, in the terms the user thinks in: which file,
/// which field, what was kept and what was not.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ConflictEntry {
    /// RFC3339 UTC, when this device resolved it.
    pub at: String,
    /// Vault-relative path of the file the disagreement was in.
    pub path: String,
    /// `"<row>: <field>"` for a record merge, `"<record>"` for a whole-row
    /// decision, `"<file>"` when a whole file was kept aside.
    pub field: String,
    pub kept: String,
    pub kept_by: String,
    pub discarded: String,
    pub discarded_by: String,
}

fn log_path(local_root: &Path) -> PathBuf {
    local_root.join(LOG_FILE)
}

/// Newest first. A missing or unreadable log is an empty one: this is a
/// diagnostic, and failing a sync because its notepad is corrupt would
/// trade something that matters for something that does not.
pub fn load(local_root: &Path) -> Vec<ConflictEntry> {
    fs::read_to_string(log_path(local_root))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(local_root: &Path, entries: &[ConflictEntry]) -> Result<()> {
    let path = log_path(local_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string(entries)
        .map_err(|e| Error::State(format!("cannot serialize the conflict log: {e}")))?;
    fs::write(path, text)?;
    Ok(())
}

pub fn clear(local_root: &Path) -> Result<()> {
    let path = log_path(local_root);
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

/// Renders a JSON value the way a person reads it: a string as its text,
/// anything else as JSON. Without this every conflicting title would be
/// shown wearing quotes.
fn render(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

pub fn entries_from(
    path: &str,
    at: &str,
    conflicts: impl IntoIterator<Item = FieldConflict>,
) -> Vec<ConflictEntry> {
    conflicts
        .into_iter()
        .map(|c| ConflictEntry {
            at: at.to_string(),
            path: path.to_string(),
            field: c.field,
            kept: render(&c.kept),
            kept_by: c.kept_updated_by,
            discarded: render(&c.discarded),
            discarded_by: c.discarded_updated_by,
        })
        .collect()
}

/// Adds entries to the front and trims the tail.
pub fn append(local_root: &Path, new_entries: Vec<ConflictEntry>) -> Result<()> {
    if new_entries.is_empty() {
        return Ok(());
    }
    let mut entries = new_entries;
    entries.extend(load(local_root));
    entries.truncate(MAX_ENTRIES);
    save(local_root, &entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hypomnema-conflicts-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn conflict(field: &str) -> FieldConflict {
        FieldConflict {
            field: field.to_string(),
            kept: json!("kept value"),
            kept_updated_by: "phone".into(),
            discarded: json!("lost value"),
            discarded_updated_by: "desktop".into(),
        }
    }

    #[test]
    fn entries_round_trip_and_the_newest_comes_first() {
        let dir = temp_dir("round-trip");
        append(
            &dir,
            entries_from("a.jsonl", "2026-09-08T10:00:00Z", [conflict("1: title")]),
        )
        .unwrap();
        append(
            &dir,
            entries_from("b.jsonl", "2026-09-08T11:00:00Z", [conflict("2: status")]),
        )
        .unwrap();

        let entries = load(&dir);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "b.jsonl");
        assert_eq!(entries[0].kept, "kept value");
        assert_eq!(entries[1].field, "1: title");
    }

    #[test]
    fn the_log_stays_bounded() {
        let dir = temp_dir("bounded");
        for i in 0..MAX_ENTRIES + 20 {
            append(
                &dir,
                entries_from(
                    "a.jsonl",
                    "2026-09-08T10:00:00Z",
                    [conflict(&i.to_string())],
                ),
            )
            .unwrap();
        }
        let entries = load(&dir);
        assert_eq!(entries.len(), MAX_ENTRIES);
        // Newest survives, oldest is the one dropped.
        assert_eq!(entries[0].field, (MAX_ENTRIES + 19).to_string());
    }

    #[test]
    fn a_corrupt_log_reads_as_empty_rather_than_failing_a_sync() {
        let dir = temp_dir("corrupt");
        fs::create_dir_all(dir.join(".hypomnema/sync")).unwrap();
        fs::write(log_path(&dir), "{not json").unwrap();
        assert!(load(&dir).is_empty());
    }

    #[test]
    fn clearing_empties_the_log() {
        let dir = temp_dir("clear");
        append(
            &dir,
            entries_from("a.jsonl", "2026-09-08T10:00:00Z", [conflict("1: title")]),
        )
        .unwrap();
        clear(&dir).unwrap();
        assert!(load(&dir).is_empty());
    }
}
