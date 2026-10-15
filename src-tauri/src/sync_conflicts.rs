//! The conflict log: what a sync had to choose between, kept where a
//! person can read it.
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
    /// The `(conflicted copy ...)` file this decision left beside the
    /// original - the one kind of entry that asks something of the user.
    #[serde(default)]
    pub copy: Option<String>,
    /// Filled in for display only (`for_display`): the copy still exists,
    /// so it is waiting to be read and merged by hand.
    #[serde(default)]
    pub open: bool,
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
            copy: None,
            open: false,
        })
        .collect()
}

/// The entry for a file kept aside as `copy`.
pub fn with_copy(mut entries: Vec<ConflictEntry>, copy: &str) -> Vec<ConflictEntry> {
    for entry in &mut entries {
        entry.copy = Some(copy.to_string());
    }
    entries
}

/// Logs a save from an editor that could not merge with what had changed
/// on disk under it (`text_merge::reconcile_save`), so the copy it kept
/// aside shows up under "to review" like a sync conflict's. Best effort:
/// the save itself already happened, and a file outside the vault (a
/// Notes folder elsewhere) has no vault-relative path to log.
pub fn log_kept_aside(vault_root: &Path, file: &Path, copy: &Path) {
    let relative = |p: &Path| {
        p.strip_prefix(vault_root)
            .ok()
            .map(|r| r.to_string_lossy().replace('\\', "/"))
    };
    let (Some(path), Some(copy)) = (relative(file), relative(copy)) else {
        return;
    };
    let at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let entries = with_copy(
        entries_from(
            &path,
            &at,
            [FieldConflict {
                field: "<file>".into(),
                kept: serde_json::Value::String(format!("the editor's text, now at {path}")),
                kept_updated_by: String::new(),
                discarded: serde_json::Value::String(format!(
                    "the version changed under the editor, kept as {copy}"
                )),
                discarded_updated_by: String::new(),
            }],
        ),
        &copy,
    );
    let _ = append(vault_root, entries);
}

/// Who a stamp names, in words: device ids mean nothing to a person, and
/// with one phone and one computer "this device" / "the other device" is
/// the whole story. The engine's untouched stamp is nobody.
fn device_label(by: &str, own_device: &str) -> String {
    match by {
        "" | crate::ids::UNTOUCHED_BY => String::new(),
        id if id == own_device => "this device".into(),
        _ => "the other device".into(),
    }
}

/// The log as the Sync screen shows it: devices named, and entries whose
/// conflicted copy still sits in the vault first and marked open - those
/// are the ones waiting on the user; the rest are a record of what the
/// merge chose. Entries from before `copy` existed name it in their text.
pub fn for_display(local_root: &Path, own_device: &str) -> Vec<ConflictEntry> {
    let mut entries: Vec<ConflictEntry> = load(local_root)
        .into_iter()
        .map(|mut entry| {
            if entry.copy.is_none() && entry.field == "<file>" {
                entry.copy = entry
                    .discarded
                    .split_once(" kept as ")
                    .map(|(_, copy)| copy.trim().to_string());
            }
            entry.open = entry
                .copy
                .as_deref()
                .is_some_and(|copy| local_root.join(copy).is_file());
            entry.kept_by = device_label(&entry.kept_by, own_device);
            entry.discarded_by = device_label(&entry.discarded_by, own_device);
            entry
        })
        .collect();
    // stable: newest first within each group
    entries.sort_by_key(|entry| !entry.open);
    entries
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

/// One line of a file set against its conflicted copy.
#[derive(Debug, Clone, Serialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct DiffLine {
    /// `"same"` in both, `"file"` only in the file, `"copy"` only in the
    /// conflicted copy.
    pub kind: String,
    pub text: String,
}

/// A file and its conflicted copy, line by line, for the review dialog.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ConflictDiff {
    pub path: String,
    pub copy: String,
    pub lines: Vec<DiffLine>,
}

/// The pair a review acts on, checked: both vault-relative without
/// traversal, the copy beside the file and named as its conflicted copy.
/// The commands take paths from the page, and "keep the copy" writes one
/// file over another.
fn review_pair(root: &Path, path: &str, copy: &str) -> Result<(PathBuf, PathBuf)> {
    let file = crate::kb::resolve(root, path)?;
    let copy_abs = crate::kb::resolve(root, copy)?;
    let stem = |p: &Path| {
        p.file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    let beside = file.parent() == copy_abs.parent();
    let named = stem(&copy_abs).starts_with(&format!("{} (conflicted copy", stem(&file)));
    if !beside || !named {
        return Err(Error::State(format!(
            "{copy} is not a conflicted copy of {path}"
        )));
    }
    Ok((file, copy_abs))
}

/// Line diff of the file (as it is now) against its conflicted copy.
pub fn diff(root: &Path, path: &str, copy: &str) -> Result<ConflictDiff> {
    let (file, copy_abs) = review_pair(root, path, copy)?;
    let ours = fs::read_to_string(&file).unwrap_or_default();
    let theirs = fs::read_to_string(&copy_abs)?;
    let lf = |s: &str| s.replace("\r\n", "\n");
    let (ours, theirs) = (lf(&ours), lf(&theirs));
    let line = |kind: &str, text: &str| DiffLine {
        kind: kind.to_string(),
        text: text.trim_end_matches('\n').to_string(),
    };
    let lines = if ours == theirs {
        ours.lines().map(|l| line("same", l)).collect()
    } else {
        let patch = diffy::DiffOptions::new()
            .set_context_len(usize::MAX / 4)
            .create_patch(&ours, &theirs);
        patch
            .hunks()
            .iter()
            .flat_map(|hunk| hunk.lines())
            .map(|l| match l {
                diffy::Line::Context(t) => line("same", t),
                diffy::Line::Delete(t) => line("file", t),
                diffy::Line::Insert(t) => line("copy", t),
            })
            .collect()
    };
    Ok(ConflictDiff {
        path: path.to_string(),
        copy: copy.to_string(),
        lines,
    })
}

/// Settles a conflicted copy: `keep_copy` puts the copy's text in the
/// file, otherwise the file stays as it is. Either way the copy goes to
/// `.trash/` (recoverable for 30 days, like a Notes delete), which is
/// what takes the entry off "to review".
pub fn resolve(root: &Path, path: &str, copy: &str, keep_copy: bool) -> Result<()> {
    let (file, copy_abs) = review_pair(root, path, copy)?;
    if keep_copy {
        let _files = crate::text_merge::user_file_lock();
        let text = fs::read(&copy_abs)?;
        crate::vault::write_atomic_bytes(&file, &text)?;
    }
    crate::kb::delete(root, copy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_display_names_devices_and_puts_open_copies_first() {
        let dir = std::env::temp_dir().join("hypomnema-conflicts-display");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("journal")).unwrap();
        let field = FieldConflict {
            field: "1: title".into(),
            kept: json!("a"),
            kept_updated_by: "me".into(),
            discarded: json!("b"),
            discarded_updated_by: "them".into(),
        };
        let copy = "journal/a (conflicted copy phone 2026-09-08).md";
        fs::write(dir.join(copy), "kept aside").unwrap();
        let file = FieldConflict {
            field: "<file>".into(),
            kept: json!("the other device's version, now at journal/a.md"),
            kept_updated_by: String::new(),
            // an entry from before `copy` was stored: named in its text
            discarded: json!(format!("this device's version, kept as {copy}")),
            discarded_updated_by: "me".into(),
        };
        append(&dir, entries_from("journal/a.md", "t0", [file])).unwrap();
        append(
            &dir,
            entries_from(".hypomnema/state/tasks.jsonl", "t1", [field]),
        )
        .unwrap();

        let shown = for_display(&dir, "me");

        assert_eq!(shown[0].path, "journal/a.md");
        assert!(shown[0].open);
        assert_eq!(shown[0].copy.as_deref(), Some(copy));
        assert_eq!(shown[0].discarded_by, "this device");
        assert!(!shown[1].open);
        assert_eq!(shown[1].kept_by, "this device");
        assert_eq!(shown[1].discarded_by, "the other device");
        let _ = fs::remove_dir_all(&dir);
    }

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

    #[test]
    fn a_conflicted_copy_diffs_against_its_file_and_resolves_either_way() {
        let root = std::env::temp_dir().join("app-pkb-conflict-review");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("notes")).unwrap();
        let path = "notes/n.md";
        let copy = "notes/n (conflicted copy phone 2026-10-15).md";
        fs::write(root.join(path), "a\nb\nc\n").unwrap();
        fs::write(root.join(copy), "a\nB\nc\n").unwrap();
        let d = diff(&root, path, copy).unwrap();
        let kinds: Vec<_> = d
            .lines
            .iter()
            .map(|l| (l.kind.as_str(), l.text.as_str()))
            .collect();
        assert_eq!(
            kinds,
            vec![("same", "a"), ("file", "b"), ("copy", "B"), ("same", "c")]
        );
        // only a copy beside the file, named after it, is accepted
        assert!(diff(&root, path, "notes/other.md").is_err());
        assert!(resolve(&root, path, "../n (conflicted copy x).md", true).is_err());

        resolve(&root, path, copy, true).unwrap();
        assert_eq!(fs::read_to_string(root.join(path)).unwrap(), "a\nB\nc\n");
        assert!(!root.join(copy).exists());
        assert!(root.join(".trash").read_dir().unwrap().next().is_some());

        fs::write(root.join(copy), "x\n").unwrap();
        resolve(&root, path, copy, false).unwrap();
        assert_eq!(fs::read_to_string(root.join(path)).unwrap(), "a\nB\nc\n");
        assert!(!root.join(copy).exists());
        let _ = fs::remove_dir_all(&root);
    }
}
