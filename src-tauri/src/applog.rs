//! The diagnostic log, `<app-config-dir>/hypomnema.log`: panics, command
//! failures the frontend reports through `log_write`, and background
//! errors that have no banner to land in. A GUI process on Windows has
//! no console, so `eprintln!` alone would leave a field bug with nothing
//! to look at. The file lives outside the vault on purpose - it is
//! per-device, never synced, and survives a broken vault. When it grows
//! past `log_max_kb` it is renamed to `hypomnema.log.1` (replacing the
//! previous one), so at most two files' worth is ever kept.

use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::state::LockOrRecover;

pub const FILE_NAME: &str = "hypomnema.log";

/// Used until a vault's config says otherwise (pre-vault start, the
/// vault picker).
const DEFAULT_MAX_BYTES: u64 = 1024 * 1024;

static PATH: OnceLock<PathBuf> = OnceLock::new();
static MAX_BYTES: AtomicU64 = AtomicU64::new(DEFAULT_MAX_BYTES);
/// Serializes appends and the rotation rename between threads.
static WRITE: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Error,
    Warn,
    Info,
}

impl Level {
    fn label(self) -> &'static str {
        match self {
            Level::Error => "ERROR",
            Level::Warn => "WARN",
            Level::Info => "INFO",
        }
    }

    /// The frontend's level names; anything unknown reads as info.
    pub fn parse(s: &str) -> Level {
        match s {
            "error" => Level::Error,
            "warn" => Level::Warn,
            _ => Level::Info,
        }
    }
}

/// Points the log at its file and routes panics into it. Called once
/// from setup; later calls are ignored.
pub fn init(path: PathBuf) {
    if PATH.set(path).is_ok() {
        install_panic_hook();
    }
}

/// The rotation threshold from the vault's config (`log_max_kb`).
pub fn set_max_kb(kb: u32) {
    MAX_BYTES.store(u64::from(kb) * 1024, Ordering::Relaxed);
}

pub fn path() -> Option<&'static Path> {
    PATH.get().map(PathBuf::as_path)
}

pub fn error(msg: impl AsRef<str>) {
    write(Level::Error, msg.as_ref());
}

pub fn warn(msg: impl AsRef<str>) {
    write(Level::Warn, msg.as_ref());
}

pub fn info(msg: impl AsRef<str>) {
    write(Level::Info, msg.as_ref());
}

pub fn write(level: Level, msg: &str) {
    let line = format_line(level, msg);
    // stderr too: `tauri dev` and a console-attached run see it live
    eprint!("{line}");
    let Some(path) = path() else { return };
    let _guard = WRITE.lock_or_recover();
    let _ = append(path, &line, MAX_BYTES.load(Ordering::Relaxed));
}

/// The last `max_bytes` of the log (current file, preceded by the
/// rotated one when the current is shorter), cut at a line start. Backs
/// the "Copy diagnostics" button, so the user sees what they share.
pub fn tail(max_bytes: u64) -> String {
    let Some(path) = path() else {
        return String::new();
    };
    let _guard = WRITE.lock_or_recover();
    tail_of(path, max_bytes)
}

fn format_line(level: Level, msg: &str) -> String {
    format!(
        "{} {:<5} {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        level.label(),
        msg.trim_end()
    )
}

fn rotated(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".1");
    PathBuf::from(name)
}

fn append(path: &Path, line: &str, max_bytes: u64) -> std::io::Result<()> {
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() + line.len() as u64 > max_bytes {
            // rename replaces the old .1 on Windows too (MoveFileEx
            // with REPLACE_EXISTING under std::fs::rename)
            fs::rename(path, rotated(path))?;
        }
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(line.as_bytes())
}

fn tail_of(path: &Path, max_bytes: u64) -> String {
    let mut out = read_tail(path, max_bytes);
    let missing = max_bytes.saturating_sub(out.len() as u64);
    if missing > 0 {
        let older = read_tail(&rotated(path), missing);
        out = older + &out;
    }
    out
}

fn read_tail(path: &Path, max_bytes: u64) -> String {
    let Ok(mut file) = fs::File::open(path) else {
        return String::new();
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(max_bytes);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return String::new();
    }
    let mut buf = Vec::new();
    if file.read_to_end(&mut buf).is_err() {
        return String::new();
    }
    let text = String::from_utf8_lossy(&buf).into_owned();
    if start > 0 {
        // the cut landed mid-line: drop the fragment
        match text.find('\n') {
            Some(i) => text[i + 1..].to_string(),
            None => String::new(),
        }
    } else {
        text
    }
}

fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let line = format_line(Level::Error, &format!("PANIC {info}"));
        eprint!("{line}");
        let Some(path) = path() else { return };
        // A panic inside `write` itself holds WRITE on this thread;
        // waiting for it would hang the process instead of aborting it.
        // Skip the rotation then and append directly.
        match WRITE.try_lock() {
            Ok(_guard) => {
                let _ = append(path, &line, MAX_BYTES.load(Ordering::Relaxed));
            }
            Err(_) => {
                if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
                    let _ = file.write_all(line.as_bytes());
                }
            }
        }
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hypomnema-applog-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join(FILE_NAME)
    }

    #[test]
    fn rotates_past_the_limit_keeping_one_old_file() {
        let path = tmp("rotate");
        for i in 0..10 {
            append(&path, &format!("line {i:02} padded to some length\n"), 100).unwrap();
        }
        let current = fs::read_to_string(&path).unwrap();
        let old = fs::read_to_string(rotated(&path)).unwrap();
        assert!(current.len() <= 100);
        assert!(current.contains("line 09"));
        assert!(old.contains("line 0"));
        assert!(!old.contains("line 09"));
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn tail_spans_the_rotated_file_and_starts_on_a_line() {
        let path = tmp("tail");
        fs::write(rotated(&path), "aaaa\nbbbb\ncccc\n").unwrap();
        fs::write(&path, "dddd\n").unwrap();
        // 5 bytes from the current file, 7 from the rotated one: "cccc\n"
        // is whole, the "b\n" fragment before it is dropped
        assert_eq!(tail_of(&path, 12), "cccc\ndddd\n");
        assert_eq!(tail_of(&path, 3), "");
        assert_eq!(tail_of(&path, 1000), "aaaa\nbbbb\ncccc\ndddd\n");
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn levels_parse_from_the_frontend_names() {
        assert_eq!(Level::parse("error"), Level::Error);
        assert_eq!(Level::parse("warn"), Level::Warn);
        assert_eq!(Level::parse("whatever"), Level::Info);
    }
}
