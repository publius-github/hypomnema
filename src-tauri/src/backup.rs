//! Vault backups under <vault>/.hypomnema/backups/: one consistent daily snapshot
//! of app.db (VACUUM INTO) plus a copy of every config YAML about to be
//! rewritten programmatically. Both rotate by count (config.backup_keep,
//! 0 disables). Backups are a best-effort safety net: callers must not
//! fail the primary operation when a backup cannot be written.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local};
use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::error::{Error, IoContext, Result};
use crate::vault;

/// Snapshots app.db to backups/db/app-YYYY-MM-DD.db, at most once per
/// day, keeping the newest `keep` snapshots. VACUUM INTO produces a
/// compact, consistent copy even with the source in WAL mode.
pub fn backup_db_daily(
    conn: &Connection,
    root: &Path,
    keep: u32,
    now: DateTime<Local>,
) -> Result<Option<PathBuf>> {
    if keep == 0 {
        return Ok(None);
    }
    let dir = crate::vault::work_dir(root).join("backups").join("db");
    fs::create_dir_all(&dir).at(&dir)?;
    let target = dir.join(format!("app-{}.db", now.format("%Y-%m-%d")));
    if target.exists() {
        return Ok(None);
    }
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()])?;
    rotate(&dir, "app-", keep as usize)?;
    Ok(Some(target))
}

/// Copies a config file aside before a programmatic rewrite (splice or
/// editor save), keeping the newest `keep` copies per file. `file` is
/// relative to config/ and may contain subdirs (templates/journal.md).
pub fn backup_config_file(
    config_dir: &Path,
    file: &str,
    keep: u32,
    now: DateTime<Local>,
) -> Result<()> {
    if keep == 0 {
        return Ok(());
    }
    let source = config_dir.join(file);
    if !source.exists() {
        return Ok(());
    }
    // the config dir sits inside the work dir, so backups land next to
    // it in <work dir>/backups/config
    let Some(work_dir) = config_dir.parent() else {
        return Ok(());
    };
    let dir = work_dir.join("backups").join("config");
    fs::create_dir_all(&dir).at(&dir)?;
    let flat = file.replace(['/', '\\'], "__");
    let prefix = format!("{flat}.");
    let target = dir.join(format!("{prefix}{}.bak", now.format("%Y%m%d-%H%M%S")));
    fs::copy(&source, &target).at(&target)?;
    rotate(&dir, &prefix, keep as usize)?;
    Ok(())
}

/// Snapshots app.db to backups/db/pre-upgrade-<ts>-v<from>.db right
/// before a schema migration: the daily snapshot may be most of a day
/// old, and a migration is the one write that cannot be undone by
/// opening the file with the build that wrote it. Rotated by `keep`
/// among its own kind, so upgrades never push out daily snapshots.
pub fn backup_db_before_migration(
    conn: &Connection,
    root: &Path,
    from_version: i64,
    keep: u32,
    now: DateTime<Local>,
) -> Result<Option<PathBuf>> {
    if keep == 0 {
        return Ok(None);
    }
    let dir = crate::vault::work_dir(root).join("backups").join("db");
    fs::create_dir_all(&dir).at(&dir)?;
    let target = dir.join(format!(
        "{PRE_UPGRADE_PREFIX}{}-v{from_version}.db",
        now.format("%Y%m%d-%H%M%S")
    ));
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()])?;
    rotate(&dir, PRE_UPGRADE_PREFIX, keep as usize)?;
    Ok(Some(target))
}

const PRE_UPGRADE_PREFIX: &str = "pre-upgrade-";

/// Deletes all but the newest `keep` files whose name starts with
/// `prefix`. Names embed the timestamp, so lexicographic order is
/// chronological.
fn rotate(dir: &Path, prefix: &str, keep: usize) -> Result<()> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .at(dir)?
        .flatten()
        .filter_map(|entry| entry.file_name().to_str().map(String::from))
        .filter(|name| name.starts_with(prefix))
        .collect();
    names.sort();
    if names.len() > keep {
        for name in &names[..names.len() - keep] {
            let _ = fs::remove_file(dir.join(name));
        }
    }
    Ok(())
}

/// One file under backups/db/ or backups/config/, as shown in the
/// Data tab's restore list.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct BackupEntry {
    /// The file name on disk - opaque to the frontend, passed back
    /// verbatim to request a restore.
    pub id: String,
    /// What the backup is a copy of: a date for a DB snapshot, the
    /// original relative file name for a config backup.
    pub label: String,
    pub modified: String,
    #[ts(type = "number")]
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct BackupsOverview {
    pub db: Vec<BackupEntry>,
    pub config: Vec<BackupEntry>,
}

fn list_entries(
    dir: &Path,
    keep: impl Fn(&str) -> bool,
    label_of: impl Fn(&str) -> String,
) -> Result<Vec<BackupEntry>> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).at(dir)?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !keep(&name) {
            continue;
        }
        let meta = entry.metadata()?;
        let modified: DateTime<Local> = meta.modified()?.into();
        entries.push(BackupEntry {
            label: label_of(&name),
            id: name,
            modified: modified.format("%Y-%m-%d %H:%M:%S").to_string(),
            size: meta.len(),
        });
    }
    // newest first - the timestamp in "modified" sorts lexicographically
    entries.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(entries)
}

/// Recovers the original relative config path from a backup file name
/// (`backup_config_file` flattens it: "templates/journal.md" becomes
/// "templates__journal.md.<ts>.bak").
fn original_file_from_backup_name(name: &str) -> String {
    let without_ext = name.strip_suffix(".bak").unwrap_or(name);
    let flat = match without_ext.rsplit_once('.') {
        // the timestamp suffix is exactly "YYYYMMDD-HHMMSS" (15 chars)
        Some((base, ts)) if ts.len() == 15 && ts.as_bytes().get(8) == Some(&b'-') => base,
        _ => without_ext,
    };
    flat.replace("__", "/")
}

/// Lists app.db snapshots under backups/db/, newest first.
pub fn list_db_backups(root: &Path) -> Result<Vec<BackupEntry>> {
    let dir = vault::work_dir(root).join("backups").join("db");
    list_entries(
        &dir,
        |name| {
            (name.starts_with("app-")
                || name.starts_with("pre-restore-app-")
                || name.starts_with(PRE_UPGRADE_PREFIX))
                && name.ends_with(".db")
        },
        |name| {
            name.strip_prefix("pre-restore-app-")
                .map(|s| format!("pre-restore {s}"))
                .or_else(|| {
                    name.strip_prefix(PRE_UPGRADE_PREFIX)
                        .map(|s| format!("before upgrade {s}"))
                })
                .or_else(|| name.strip_prefix("app-").map(str::to_string))
                .map(|s| s.trim_end_matches(".db").to_string())
                .unwrap_or_else(|| name.to_string())
        },
    )
}

/// Lists config/settings file backups under backups/config/, newest
/// first; `label` is the original file's path relative to config/ (or
/// "app.yml" for the settings file).
pub fn list_config_backups(root: &Path) -> Result<Vec<BackupEntry>> {
    let dir = vault::work_dir(root).join("backups").join("config");
    list_entries(
        &dir,
        |name| name.ends_with(".bak"),
        original_file_from_backup_name,
    )
}

pub fn overview(root: &Path) -> Result<BackupsOverview> {
    Ok(BackupsOverview {
        db: list_db_backups(root)?,
        config: list_config_backups(root)?,
    })
}

/// A backup id is one plain file name inside the backups folder. On
/// Windows a `:` would make `C:name` a drive-relative path that `join`
/// lets escape the folder (and `name:stream` an alternate data stream),
/// so it is refused on every platform alike.
fn check_backup_id(id: &str) -> Result<()> {
    let mut parts = Path::new(id).components();
    let plain =
        matches!(parts.next(), Some(std::path::Component::Normal(_))) && parts.next().is_none();
    if !plain || id.contains(['/', '\\', ':']) {
        return Err(Error::State(format!("invalid backup id: {id}")));
    }
    Ok(())
}

/// Restores app.db from a snapshot in backups/db/. The caller must have
/// already closed the live connection - Windows refuses to overwrite a
/// file that's still open, and SQLite must not see its file replaced
/// out from under an open handle on any platform. The current app.db is
/// itself copied aside first, so a restore is never a one-way door; the
/// stale -wal/-shm siblings of the replaced database are dropped so no
/// leftover frames apply to the restored file.
pub fn restore_db_backup(root: &Path, id: &str, now: DateTime<Local>) -> Result<()> {
    check_backup_id(id)?;
    let dir = vault::work_dir(root).join("backups").join("db");
    let source = dir.join(id);
    if !source.is_file() {
        return Err(Error::State(format!("backup not found: {id}")));
    }
    let target = vault::db_path(root);
    if target.exists() {
        // not `app-` prefixed: `rotate(&dir, "app-", keep)` would count
        // these against `backup_keep` and, sorting after every dated
        // snapshot, keep them while the dailies got deleted
        let safety = dir.join(format!(
            "pre-restore-app-{}.db",
            now.format("%Y%m%d-%H%M%S")
        ));
        fs::copy(&target, &safety).at(&safety)?;
    }
    // copied beside the target and renamed over it: a copy cut short
    // must not leave a truncated app.db in place of a working one
    let staging = target.with_extension("db.restoring");
    if let Err(e) = fs::copy(&source, &staging) {
        let _ = fs::remove_file(&staging);
        return Err(Error::io_at(&staging, e));
    }
    fs::rename(&staging, &target).map_err(|e| Error::io_at(&target, e))?;
    let _ = fs::remove_file(target.with_extension("db-wal"));
    let _ = fs::remove_file(target.with_extension("db-shm"));
    Ok(())
}

/// Restores one config/settings file from its backup in backups/config/.
/// The file currently in place is itself backed up first, same as
/// before any other programmatic rewrite of that file.
pub fn restore_config_backup(root: &Path, id: &str, keep: u32, now: DateTime<Local>) -> Result<()> {
    check_backup_id(id)?;
    let dir = vault::work_dir(root).join("backups").join("config");
    let source = dir.join(id);
    if !source.is_file() {
        return Err(Error::State(format!("backup not found: {id}")));
    }
    let original = original_file_from_backup_name(id);
    let (backup_source_dir, target) = if original == "app.yml" {
        let settings_file = vault::settings_file(root);
        let dir = settings_file
            .parent()
            .ok_or_else(|| Error::State("settings file has no parent directory".into()))?
            .to_path_buf();
        (dir, settings_file)
    } else {
        (
            vault::config_dir(root),
            vault::config_dir(root).join(&original),
        )
    };
    let _ = backup_config_file(&backup_source_dir, &original, keep, now);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).at(parent)?;
    }
    let content = fs::read_to_string(&source).at(&source)?;
    crate::vault::write_atomic(&target, &content)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hypomnema-backup-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("config")).unwrap();
        dir
    }

    fn local(s: &str) -> DateTime<Local> {
        use chrono::TimeZone;
        Local
            .from_local_datetime(
                &chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap(),
            )
            .unwrap()
    }

    /// A vault root laid out like the real thing (`.hypomnema/...`), for
    /// the listing/restore tests below which go through the `vault::`
    /// path helpers rather than a bare `config_dir`.
    fn fresh_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hypomnema-backup-restore-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn db_backup_is_daily_and_rotates() {
        let root = vault("db");
        let conn = db::open(&root.join("app.db")).unwrap();
        db::migrate(&conn).unwrap();

        let first = backup_db_daily(&conn, &root, 2, local("2026-08-29 10:00:00")).unwrap();
        assert!(first.is_some());
        assert!(first.unwrap().exists());
        // same day: no second snapshot
        let again = backup_db_daily(&conn, &root, 2, local("2026-08-29 18:00:00")).unwrap();
        assert!(again.is_none());

        backup_db_daily(&conn, &root, 2, local("2026-08-30 10:00:00")).unwrap();
        backup_db_daily(&conn, &root, 2, local("2026-08-31 10:00:00")).unwrap();
        let dir = crate::vault::work_dir(&root).join("backups").join("db");
        let mut names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec!["app-2026-08-30.db", "app-2026-08-31.db"]);

        // the snapshot is a usable database
        let snapshot = db::open(&dir.join("app-2026-08-31.db")).unwrap();
        let version: i64 = snapshot
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert!(version > 0);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn pre_upgrade_backup_rotates_apart_from_the_dailies_and_is_listed() {
        let root = vault("pre-upgrade");
        let conn = db::open(&root.join("app.db")).unwrap();
        db::migrate(&conn).unwrap();
        backup_db_daily(&conn, &root, 2, local("2026-08-29 09:00:00")).unwrap();
        for (i, at) in [
            "2026-08-29 10:00:00",
            "2026-08-30 10:00:00",
            "2026-08-31 10:00:00",
        ]
        .iter()
        .enumerate()
        {
            let made =
                backup_db_before_migration(&conn, &root, 18 + i as i64, 2, local(at)).unwrap();
            assert!(made.unwrap().exists());
        }
        let listed = list_db_backups(&root).unwrap();
        let mut labels: Vec<&str> = listed.iter().map(|e| e.label.as_str()).collect();
        labels.sort();
        // two upgrade copies survive their own rotation; the daily is untouched
        assert_eq!(
            labels,
            vec![
                "2026-08-29",
                "before upgrade 20260830-100000-v19",
                "before upgrade 20260831-100000-v20",
            ]
        );
        assert!(
            backup_db_before_migration(&conn, &root, 1, 0, local("2026-09-01 10:00:00"))
                .unwrap()
                .is_none()
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn db_backup_disabled_with_zero_keep() {
        let root = vault("db-off");
        let conn = db::open(&root.join("app.db")).unwrap();
        db::migrate(&conn).unwrap();
        let made = backup_db_daily(&conn, &root, 0, local("2026-08-29 10:00:00")).unwrap();
        assert!(made.is_none());
        assert!(!crate::vault::work_dir(&root).join("backups").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn config_backup_copies_and_rotates_per_file() {
        let root = vault("cfg");
        let config_dir = root.join("config");
        fs::write(config_dir.join("recurring.yml"), "tasks: []\n").unwrap();
        fs::write(config_dir.join("birthdays.yml"), "birthdays: []\n").unwrap();

        backup_config_file(
            &config_dir,
            "recurring.yml",
            2,
            local("2026-08-29 10:00:00"),
        )
        .unwrap();
        backup_config_file(
            &config_dir,
            "recurring.yml",
            2,
            local("2026-08-29 10:00:01"),
        )
        .unwrap();
        backup_config_file(
            &config_dir,
            "recurring.yml",
            2,
            local("2026-08-29 10:00:02"),
        )
        .unwrap();
        backup_config_file(
            &config_dir,
            "birthdays.yml",
            2,
            local("2026-08-29 10:00:03"),
        )
        .unwrap();
        // a missing file is a no-op, not an error
        backup_config_file(
            &config_dir,
            "scheduled.yml",
            2,
            local("2026-08-29 10:00:04"),
        )
        .unwrap();

        let dir = root.join("backups").join("config");
        let mut names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        // rotation is per file: the oldest recurring copy is gone, the
        // single birthdays copy is untouched
        assert_eq!(
            names,
            vec![
                "birthdays.yml.20260829-100003.bak",
                "recurring.yml.20260829-100001.bak",
                "recurring.yml.20260829-100002.bak",
            ]
        );
        assert_eq!(
            fs::read_to_string(dir.join("recurring.yml.20260829-100002.bak")).unwrap(),
            "tasks: []\n"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn list_db_backups_lists_and_labels() {
        let root = fresh_vault("list-db");
        let dir = vault::work_dir(&root).join("backups").join("db");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("app-2026-08-29.db"), b"a").unwrap();
        fs::write(dir.join("app-2026-08-30.db"), b"bb").unwrap();
        fs::write(dir.join("notes.txt"), b"ignore me").unwrap();

        let mut entries = list_db_backups(&root).unwrap();
        entries.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "app-2026-08-29.db");
        assert_eq!(entries[0].label, "2026-08-29");
        assert_eq!(entries[0].size, 1);
        assert_eq!(entries[1].label, "2026-08-30");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn list_config_backups_unflattens_original_name() {
        let root = fresh_vault("list-config");
        let dir = vault::work_dir(&root).join("backups").join("config");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("recurring.yml.20260829-100000.bak"), b"tasks: []").unwrap();
        fs::write(
            dir.join("templates__journal.md.20260830-110000.bak"),
            b"# {{date}}",
        )
        .unwrap();
        fs::write(dir.join("app.yml.20260831-120000.bak"), b"theme: dark").unwrap();

        let mut entries = list_config_backups(&root).unwrap();
        entries.sort_by(|a, b| a.id.cmp(&b.id));
        let labels: Vec<&str> = entries.iter().map(|e| e.label.as_str()).collect();
        assert_eq!(
            labels,
            vec!["app.yml", "recurring.yml", "templates/journal.md"]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_db_backup_swaps_file_and_keeps_a_safety_copy() {
        let root = fresh_vault("restore-db");
        fs::create_dir_all(vault::work_dir(&root)).unwrap();
        let current_path = vault::db_path(&root);
        fs::write(&current_path, b"CURRENT-DB-BYTES").unwrap();
        // stale WAL/SHM siblings of the database being replaced must not
        // survive the swap - they'd apply frames from the wrong file
        fs::write(current_path.with_extension("db-wal"), b"wal").unwrap();
        fs::write(current_path.with_extension("db-shm"), b"shm").unwrap();

        let backup_dir = vault::work_dir(&root).join("backups").join("db");
        fs::create_dir_all(&backup_dir).unwrap();
        fs::write(backup_dir.join("app-2026-08-29.db"), b"BACKUP-DB-BYTES").unwrap();

        restore_db_backup(&root, "app-2026-08-29.db", local("2026-09-01 09:00:00")).unwrap();

        assert_eq!(fs::read(&current_path).unwrap(), b"BACKUP-DB-BYTES");
        assert!(!current_path.with_extension("db-wal").exists());
        assert!(!current_path.with_extension("db-shm").exists());
        let safety = backup_dir.join("pre-restore-app-20260901-090000.db");
        assert_eq!(fs::read(&safety).unwrap(), b"CURRENT-DB-BYTES");
        // the safety copy is listed but never counted by the daily rotation
        assert!(list_db_backups(&root)
            .unwrap()
            .iter()
            .any(|e| e.id == "pre-restore-app-20260901-090000.db"));
        rotate(&backup_dir, "app-", 1).unwrap();
        assert!(safety.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_backup_id_names_one_file_inside_the_backups_folder() {
        for id in ["app-20260901.db", "recurring.yml.20260901-090000.bak"] {
            assert!(check_backup_id(id).is_ok(), "{id}");
        }
        for id in [
            "",
            ".",
            "..",
            "../app.db",
            "a/b.db",
            "a\\b.db",
            "/etc/passwd",
            "C:app.db",
            "C:\\app.db",
            "app.db:stream",
        ] {
            assert!(check_backup_id(id).is_err(), "{id}");
        }
    }

    #[test]
    fn restore_db_backup_missing_id_errors() {
        let root = fresh_vault("restore-db-missing");
        fs::create_dir_all(vault::work_dir(&root).join("backups").join("db")).unwrap();
        assert!(restore_db_backup(&root, "nope.db", local("2026-09-01 09:00:00")).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_config_backup_restores_content_and_backs_up_current() {
        let root = fresh_vault("restore-config");
        let config_dir = vault::config_dir(&root);
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(config_dir.join("recurring.yml"), "tasks: [current]\n").unwrap();

        let backup_dir = vault::work_dir(&root).join("backups").join("config");
        fs::create_dir_all(&backup_dir).unwrap();
        fs::write(
            backup_dir.join("recurring.yml.20260829-100000.bak"),
            "tasks: [restored]\n",
        )
        .unwrap();

        restore_config_backup(
            &root,
            "recurring.yml.20260829-100000.bak",
            3,
            local("2026-09-01 09:00:00"),
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(config_dir.join("recurring.yml")).unwrap(),
            "tasks: [restored]\n"
        );
        // the content about to be overwritten got its own backup first,
        // same as any other programmatic rewrite of a config file
        assert_eq!(
            fs::read_to_string(backup_dir.join("recurring.yml.20260901-090000.bak")).unwrap(),
            "tasks: [current]\n"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_config_backup_targets_settings_file_for_app_yml() {
        let root = fresh_vault("restore-app-yml");
        let backup_dir = vault::work_dir(&root).join("backups").join("config");
        fs::create_dir_all(&backup_dir).unwrap();
        fs::write(
            backup_dir.join("app.yml.20260829-100000.bak"),
            "theme: dark\n",
        )
        .unwrap();

        restore_config_backup(
            &root,
            "app.yml.20260829-100000.bak",
            3,
            local("2026-09-01 09:00:00"),
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(vault::settings_file(&root)).unwrap(),
            "theme: dark\n"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_config_backup_missing_id_errors() {
        let root = fresh_vault("restore-config-missing");
        fs::create_dir_all(vault::work_dir(&root).join("backups").join("config")).unwrap();
        assert!(restore_config_backup(&root, "nope.bak", 3, local("2026-09-01 09:00:00")).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
