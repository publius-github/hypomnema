//! Which vault-relative paths belong to the *shared* vault, and which
//! stay on the device that made them. docs/android/ROADMAP.md Phase 1,
//! REQUIREMENTS.md §2.
//!
//! This is a whitelist, not a blocklist, and deliberately so: a new file
//! kind added elsewhere in the app defaults to "device-local" and is
//! merely absent from the other device, instead of defaulting to "shared"
//! and arriving somewhere it can do damage. `app.db` is the case that
//! decides the shape - two app instances writing one SQLite file through
//! a file sync is the corruption scenario REQUIREMENTS.md §2 opens with,
//! and it must be impossible to reach by forgetting something.
//!
//! Paths here are vault-relative and always `/`-separated, the form the
//! `SyncProvider` deals in - not native paths.
#![allow(dead_code)]

use std::path::Path;
use std::sync::RwLock;

use crate::vault::{self, WORK_DIR};

/// The user's own exclusions, at the vault root, in `.hypomnemaignore`'s
/// syntax. It is itself synced, so both devices agree on what stays
/// home - an exclusion only one side knew of would let the other keep
/// sending the files.
pub const SYNC_IGNORE_FILE: &str = ".hypomnemasyncignore";

/// The Notes tree's recycle bin (`kb::delete`). Deleted notes are a
/// local safety net, not shared content: shipping them would put one
/// device's deletions in the other's trash.
pub const TRASH_DIR: &str = ".trash";

/// Patterns of `SYNC_IGNORE_FILE`, loaded at the start of every pass
/// (`load_user_ignore`) so `is_synced` keeps its one-argument shape at
/// the many call sites that walk paths.
static USER_IGNORE: RwLock<Vec<String>> = RwLock::new(Vec::new());

/// Rereads the vault's `SYNC_IGNORE_FILE`; called by each pass before it
/// lists anything.
pub fn load_user_ignore(local_root: &Path) {
    let patterns = crate::kb::load_patterns(&local_root.join(SYNC_IGNORE_FILE));
    *USER_IGNORE.write().unwrap_or_else(|e| e.into_inner()) = patterns;
}

/// Is this vault-relative path part of the shared vault?
pub fn is_synced(path: &str) -> bool {
    let patterns = USER_IGNORE.read().unwrap_or_else(|e| e.into_inner());
    is_synced_with(path, &patterns)
}

/// `is_synced` against an explicit set of user patterns.
pub fn is_synced_with(path: &str, user_ignore: &[String]) -> bool {
    let path = path.trim_start_matches('/');
    if path.is_empty() {
        return false;
    }
    let parts: Vec<&str> = path.split('/').collect();
    let name = parts.last().copied().unwrap_or("");
    // a crashed write_atomic's leftover, and the trash at any depth (the
    // Notes root can be a subfolder of the vault)
    if vault::is_staging_file(name) || parts.contains(&TRASH_DIR) {
        return false;
    }
    if is_user_ignored(&parts, user_ignore) {
        return false;
    }
    // Anything outside the app's working directory is user content -
    // journal entries, notes, and whatever else the user keeps in the
    // vault. That is the point of the vault, so it all travels.
    let Some(rest) = path.strip_prefix(&format!("{WORK_DIR}/")) else {
        return true;
    };
    match rest.split('/').next().unwrap_or("") {
        // The authoritative text snapshot of the database, minus the
        // mirror's merge base: that base records what *this* device last
        // exported, so another device's copy would be a lie about local
        // history (tasks_mirror.rs).
        "state" => !rest.starts_with("state/mirror-base/"),
        // User-authored rules and templates: recurring.yml, scheduled.yml,
        // birthdays.yml, packs, templates/. Editing these on a phone is a
        // P0 requirement (REQUIREMENTS.md §6).
        "config" => true,
        // app.db and its -wal/-shm siblings. The whole reason this
        // module is a whitelist.
        "app.db" => false,
        // Per-device: window layout, theme, profiles. A phone inheriting
        // a desktop's column counts would be a bug, not a feature.
        "settings" => false,
        // A local safety net, per device, and large. Restoring one
        // device's backup onto another is not a workflow the app has.
        "backups" => false,
        // Derived from the database and rewritten on every export.
        // Syncing it would give the same tasks two writers - the mirror
        // file and tasks.jsonl - racing to describe one row.
        "tasks" => false,
        // Device bookkeeping about the sync itself (sync_bootstrap's
        // manifest). Uploading it would put one device's record of the
        // vault inside the vault.
        "sync" => false,
        // Unknown newcomer: keep it local. See the module note.
        _ => false,
    }
}

/// The user's patterns, with a folder rule (`drafts/`) also covering
/// everything below it - the walk lists files only, never folders.
fn is_user_ignored(parts: &[&str], patterns: &[String]) -> bool {
    if patterns.is_empty() {
        return false;
    }
    (1..=parts.len()).any(|n| {
        let is_dir = n < parts.len();
        crate::kb::is_ignored(patterns, parts[n - 1], &parts[..n].join("/"), is_dir)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patterns(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_trash_and_staging_files_stay_local() {
        assert!(!is_synced_with(".trash/20261015-101010-note.md", &[]));
        assert!(!is_synced_with("notes/.trash/x.md", &[]));
        assert!(!is_synced_with("journal/.2026-10-15.md.1234-0.tmp", &[]));
        assert!(is_synced_with("journal/2026-10-15.md", &[]));
    }

    #[test]
    fn user_patterns_exclude_files_and_whole_folders() {
        let p = patterns(&[".git/", "*.pdf", "drafts/private.md"]);
        assert!(!is_synced_with(".git/objects/ab/cd", &p));
        assert!(!is_synced_with("papers/big.pdf", &p));
        assert!(!is_synced_with("drafts/private.md", &p));
        assert!(is_synced_with("drafts/public.md", &p));
        assert!(is_synced_with(SYNC_IGNORE_FILE, &p));
        // a folder rule never matches a file of that name
        assert!(is_synced_with("notes/.git", &p));
    }

    #[test]
    fn the_database_and_its_siblings_never_travel() {
        // The one this module exists for: SQLite in WAL mode moved by a
        // file sync is how a vault gets corrupted (REQUIREMENTS.md §2).
        assert!(!is_synced(".hypomnema/app.db"));
        assert!(!is_synced(".hypomnema/app.db-wal"));
        assert!(!is_synced(".hypomnema/app.db-shm"));
    }

    #[test]
    fn user_content_travels() {
        assert!(is_synced("journal/2026-09-08.md"));
        assert!(is_synced("notes/some/deep/note.md"));
        assert!(is_synced("Inbox.md"));
        assert!(is_synced(".hypomnemaignore"));
    }

    #[test]
    fn the_state_snapshot_travels_but_not_the_mirror_base() {
        assert!(is_synced(".hypomnema/state/tasks.jsonl"));
        assert!(is_synced(".hypomnema/state/lists.jsonl"));
        // What this device last exported is a statement about this
        // device, and merging another one's copy would corrupt the
        // three-way merge the mirror import depends on.
        assert!(!is_synced(".hypomnema/state/mirror-base/Inbox.md"));
    }

    #[test]
    fn user_configs_travel_and_app_settings_do_not() {
        assert!(is_synced(".hypomnema/config/recurring.yml"));
        assert!(is_synced(".hypomnema/config/templates/journal.md"));
        assert!(!is_synced(".hypomnema/settings/app.yml"));
        assert!(!is_synced(".hypomnema/settings/profiles/dense.yml"));
    }

    #[test]
    fn backups_and_the_task_mirror_stay_local() {
        assert!(!is_synced(".hypomnema/backups/db/2026-09-08.db"));
        assert!(!is_synced(".hypomnema/tasks/Inbox.md"));
        assert!(!is_synced(".hypomnema/tasks/agenda.md"));
    }

    #[test]
    fn the_sync_manifest_stays_on_the_device_that_wrote_it() {
        assert!(!is_synced(".hypomnema/sync/pull-manifest.json"));
    }

    #[test]
    fn an_unrecognized_work_dir_entry_defaults_to_local() {
        // A whitelist so that whatever lands in .hypomnema/ next is
        // merely missing on the other device rather than shared by
        // accident.
        assert!(!is_synced(".hypomnema/something-new/file.txt"));
        assert!(!is_synced(".hypomnema/stray.log"));
    }

    #[test]
    fn leading_slashes_and_empty_paths_are_handled() {
        assert!(is_synced("/journal/2026-09-08.md"));
        assert!(!is_synced("/.hypomnema/app.db"));
        assert!(!is_synced(""));
        assert!(!is_synced("/"));
    }
}
