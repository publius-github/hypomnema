//! Vault backups under <vault>/.hypomnema/backups/: one consistent daily snapshot
//! of app.db (VACUUM INTO) plus a copy of every config YAML about to be
//! rewritten programmatically. Both rotate by count (config.backup_keep,
//! 0 disables). Backups are a best-effort safety net: callers must not
//! fail the primary operation when a backup cannot be written.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local};
use rusqlite::Connection;

use crate::error::Result;

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
    fs::create_dir_all(&dir)?;
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
    fs::create_dir_all(&dir)?;
    let flat = file.replace(['/', '\\'], "__");
    let prefix = format!("{flat}.");
    let target = dir.join(format!("{prefix}{}.bak", now.format("%Y%m%d-%H%M%S")));
    fs::copy(&source, &target)?;
    rotate(&dir, &prefix, keep as usize)?;
    Ok(())
}

/// Deletes all but the newest `keep` files whose name starts with
/// `prefix`. Names embed the timestamp, so lexicographic order is
/// chronological.
fn rotate(dir: &Path, prefix: &str, keep: usize) -> Result<()> {
    let mut names: Vec<String> = fs::read_dir(dir)?
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("app-pkb-backup-{name}"));
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
}
