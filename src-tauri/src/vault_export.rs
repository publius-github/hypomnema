//! A copy of the vault as one zip archive, for a phone whose vault sits
//! in the app-specific folder Android wipes on uninstall.
//!
//! Everything a user would want back goes in: notes, journal, configs,
//! the task mirror and the `state/` snapshot the database is rebuilt
//! from. What stays out is what the app regenerates or would rather not
//! carry: `app.db` and its WAL/shm (two instances must never share one
//! SQLite file, and the snapshot restores it), the daily database
//! backups, the Notes trash, and the temp files of in-flight atomic
//! writes.

use std::fs::{self, File};
use std::io::{self, Seek, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::{Error, IoContext, Result};
use crate::vault;

/// `Hypomnema-vault-YYYY-MM-DD-HHMM.zip`: readable in a Downloads list
/// and sortable there, with a stamp fine enough to tell two exports of
/// one day apart.
pub fn archive_name(now: DateTime<Local>) -> String {
    format!("Hypomnema-vault-{}.zip", now.format("%Y-%m-%d-%H%M"))
}

/// Files that are regenerated from the rest or that two instances must
/// never share, kept vault-relative and `/`-separated.
fn is_exported(relative: &str) -> bool {
    let db = format!("{}/app.db", vault::WORK_DIR);
    if relative == db || relative.starts_with(&format!("{db}-")) {
        return false;
    }
    if relative.starts_with(&format!("{}/backups/", vault::WORK_DIR)) {
        return false;
    }
    if relative == ".trash" || relative.starts_with(".trash/") {
        return false;
    }
    let name = relative.rsplit('/').next().unwrap_or(relative);
    // write_atomic's `.<name>.tmp`, and the folder browser's probe
    !(name.starts_with('.') && name.ends_with(".tmp")) && name != ".hypomnema-write-probe"
}

/// Writes the archive and returns how many files went in.
pub fn write_archive<W: Write + Seek>(root: &Path, out: W) -> Result<usize> {
    let mut zip = ZipWriter::new(out);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .large_file(true);
    let mut files = Vec::new();
    collect(root, &mut files)?;
    files.sort();
    let mut count = 0;
    for path in &files {
        let relative = relative_name(root, path);
        if !is_exported(&relative) {
            continue;
        }
        zip.start_file(relative, options).map_err(|e| {
            Error::State(format!("cannot add {} to the archive: {e}", path.display()))
        })?;
        let mut file = File::open(path).at(path)?;
        io::copy(&mut file, &mut zip).at(path)?;
        count += 1;
    }
    zip.finish()
        .map_err(|e| Error::State(format!("cannot finish the archive: {e}")))?;
    Ok(count)
}

/// Writes the archive to `dir/<archive_name>` and returns its path.
pub fn write_archive_file(root: &Path, dir: &Path, now: DateTime<Local>) -> Result<PathBuf> {
    fs::create_dir_all(dir).at(dir)?;
    let target = dir.join(archive_name(now));
    let file = File::create(&target).at(&target)?;
    if let Err(e) = write_archive(root, file) {
        let _ = fs::remove_file(&target);
        return Err(e);
    }
    Ok(target)
}

/// Every regular file under `dir`, symlinks skipped: a link out of the
/// vault would pull foreign files in, and one inside it duplicates.
fn collect(dir: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(dir).at(dir)? {
        let entry = entry.at(dir)?;
        let path = entry.path();
        let kind = entry.file_type().at(&path)?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            collect(&path, out)?;
        } else if kind.is_file() {
            out.push(path);
        }
    }
    Ok(())
}

fn relative_name(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::io::Cursor;

    fn temp_vault(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("hypomnema-export-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn put(root: &Path, relative: &str, text: &str) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn archive_carries_content_and_leaves_the_database_behind() {
        let root = temp_vault("content");
        put(&root, "journal/2026/2026-10-20.md", "# day");
        put(&root, "notes/idea.md", "idea");
        put(&root, ".hypomnemaignore", "drafts/");
        put(&root, ".hypomnema/config/recurring.yml", "rules: []");
        put(&root, ".hypomnema/settings/app.yml", "theme: dark");
        put(&root, ".hypomnema/tasks/inbox.md", "- [ ] task");
        put(&root, ".hypomnema/state/tasks.jsonl", "{}");
        put(&root, ".hypomnema/state/mirror-base/inbox.md", "- [ ] task");
        put(&root, ".hypomnema/app.db", "sqlite");
        put(&root, ".hypomnema/app.db-wal", "wal");
        put(&root, ".hypomnema/app.db-shm", "shm");
        put(&root, ".hypomnema/backups/db/app-2026-10-19.db", "old");
        put(&root, ".hypomnema/backups/config/recurring.yml.1", "old");
        put(&root, ".trash/gone.md", "gone");
        put(&root, "notes/.idea.md.tmp", "half");
        put(&root, ".hypomnema-write-probe", "probe");

        let mut buf = Cursor::new(Vec::new());
        let count = write_archive(&root, &mut buf).unwrap();
        assert_eq!(count, 8);

        let mut archive = zip::ZipArchive::new(Cursor::new(buf.into_inner())).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert_eq!(
            names,
            vec![
                ".hypomnema/config/recurring.yml",
                ".hypomnema/settings/app.yml",
                ".hypomnema/state/mirror-base/inbox.md",
                ".hypomnema/state/tasks.jsonl",
                ".hypomnema/tasks/inbox.md",
                ".hypomnemaignore",
                "journal/2026/2026-10-20.md",
                "notes/idea.md",
            ]
        );
        let mut text = String::new();
        io::Read::read_to_string(&mut archive.by_name("notes/idea.md").unwrap(), &mut text)
            .unwrap();
        assert_eq!(text, "idea");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn archive_file_is_named_by_the_moment_and_removed_on_failure() {
        let root = temp_vault("file");
        put(&root, "notes/a.md", "a");
        let now = Local.with_ymd_and_hms(2026, 10, 20, 9, 5, 0).unwrap();
        let out = temp_vault("file-out");
        let target = write_archive_file(&root, &out, now).unwrap();
        assert_eq!(
            target.file_name().unwrap(),
            "Hypomnema-vault-2026-10-20-0905.zip"
        );
        assert!(target.metadata().unwrap().len() > 0);

        let missing = root.join("does-not-exist");
        assert!(write_archive_file(&missing, &out, now).is_err());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&out);
    }

    #[test]
    fn filter_names_what_stays_out() {
        assert!(is_exported("notes/a.md"));
        assert!(is_exported(".hypomnema/state/tasks.jsonl"));
        assert!(!is_exported(".hypomnema/app.db"));
        assert!(!is_exported(".hypomnema/app.db-wal"));
        assert!(!is_exported(".hypomnema/backups/db/x.db"));
        assert!(!is_exported(".trash/x.md"));
        assert!(!is_exported("notes/.x.md.tmp"));
        assert!(is_exported("notes/.hidden.md"));
    }
}
