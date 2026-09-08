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

use crate::vault::WORK_DIR;

/// Is this vault-relative path part of the shared vault?
pub fn is_synced(path: &str) -> bool {
    let path = path.trim_start_matches('/');
    if path.is_empty() {
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
        // Unknown newcomer: keep it local. See the module note.
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
