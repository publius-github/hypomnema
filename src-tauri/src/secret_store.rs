//! Where secrets live on a device, and whether they are readable right
//! now. docs/android/ROADMAP.md Phase 4.
//!
//! There is exactly one secret today - the desktop's Google refresh token
//! (the phone keeps none: Play services holds its grant) - and it is
//! worth protecting for a reason the access token is not: it is a
//! standing grant to the app's Drive folder that survives reboots, app
//! restarts and every expiry in between. Somebody holding a phone they
//! did not buy is the threat this answers.
//!
//! Off by default. App-private storage on Android is already sandboxed
//! from other apps and covered by the OS's file-based encryption while
//! the device is locked; a passphrase adds cover for a rooted or
//! already-unlocked device, at the cost of typing it after every cold
//! start. That is a trade only the person using the app can make, so it
//! is a setting rather than a default.
//!
//! **The unlocked passphrase is held in memory for the session.** Two
//! honest notes about that: it is what lets a secret be re-sealed under a
//! fresh salt on every write, and it is no worse than the plaintext token
//! that would otherwise be sitting on disk. It is never written anywhere.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::crypto::{self, Envelope};
use crate::error::{Error, Result};
use crate::state::LockOrRecover;

/// Marker file that says a passphrase is set, and proves a candidate one
/// is right without any secret having to be readable to check.
const LOCK_FILE: &str = "lock.json";

/// Sealed inside `lock.json`. Decrypting it back to this exact text is
/// what makes a passphrase "correct" - the alternative, storing a hash,
/// would be a second thing to get wrong for no gain.
const LOCK_PROOF: &[u8] = b"hypomnema-lock-v1";

/// The passphrase for this session, once someone has typed it.
///
/// Process-global on purpose: "is this app unlocked?" is a property of
/// the running app, not of any one command, and threading it through
/// every call site that eventually touches a token would put the same
/// question in a dozen signatures.
static UNLOCKED: Mutex<Option<String>> = Mutex::new(None);

/// What the lock screen needs to know.
#[derive(Debug, Clone, Default, Serialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct LockState {
    /// A passphrase has been set on this device.
    pub enabled: bool,
    /// Secrets are readable right now.
    pub unlocked: bool,
}

#[derive(Serialize, Deserialize)]
struct LockFile {
    proof: Envelope,
}

fn lock_path(config_dir: &Path) -> PathBuf {
    config_dir.join(LOCK_FILE)
}

fn secret_path(config_dir: &Path, name: &str) -> PathBuf {
    config_dir.join(name)
}

fn read_lock(config_dir: &Path) -> Option<LockFile> {
    fs::read_to_string(lock_path(config_dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}

pub fn state(config_dir: &Path) -> LockState {
    let enabled = read_lock(config_dir).is_some();
    LockState {
        enabled,
        // With no passphrase set there is nothing to unlock, and
        // reporting "locked" would make every caller special-case it.
        unlocked: !enabled || UNLOCKED.lock_or_recover().is_some(),
    }
}

fn passphrase() -> Option<String> {
    UNLOCKED.lock_or_recover().clone()
}

/// Turn the lock on, sealing every secret already on disk under the new
/// passphrase. Leaving one behind in plaintext would make the lock a
/// decoration.
pub fn enable(config_dir: &Path, new_passphrase: &str, secrets: &[&str]) -> Result<()> {
    if new_passphrase.trim().is_empty() {
        return Err(Error::State("the passphrase cannot be empty".into()));
    }
    if read_lock(config_dir).is_some() {
        return Err(Error::State("a passphrase is already set".into()));
    }
    fs::create_dir_all(config_dir)?;
    // Read everything first: a half-converted store, with one secret
    // sealed and another not, is worse than either state.
    let mut plaintexts = Vec::new();
    for name in secrets {
        let path = secret_path(config_dir, name);
        if path.is_file() {
            plaintexts.push((*name, fs::read(&path)?));
        }
    }
    let lock = LockFile {
        proof: crypto::seal(new_passphrase, LOCK_PROOF)?,
    };
    write_json(&lock_path(config_dir), &lock)?;
    *UNLOCKED.lock_or_recover() = Some(new_passphrase.to_string());
    for (name, bytes) in plaintexts {
        write_secret(config_dir, name, &bytes)?;
    }
    Ok(())
}

/// Turn the lock off, putting the secrets back as plain files. Requires
/// the passphrase: otherwise "disable the lock" would be a way around it.
pub fn disable(config_dir: &Path, candidate: &str, secrets: &[&str]) -> Result<()> {
    verify(config_dir, candidate)?;
    let mut plaintexts = Vec::new();
    for name in secrets {
        if let Some(bytes) = read_secret_with(config_dir, name, candidate)? {
            plaintexts.push((*name, bytes));
        }
    }
    // plaintexts first, lock file last: the reverse order would leave an
    // AES envelope with no lock file behind a crash in between, and the
    // token would then be read as garbage
    for (name, bytes) in plaintexts {
        fs::write(secret_path(config_dir, name), bytes)?;
    }
    let path = lock_path(config_dir);
    if path.is_file() {
        fs::remove_file(path)?;
    }
    *UNLOCKED.lock_or_recover() = None;
    Ok(())
}

/// Checks a passphrase and remembers it for the session.
pub fn unlock(config_dir: &Path, candidate: &str) -> Result<()> {
    verify(config_dir, candidate)?;
    *UNLOCKED.lock_or_recover() = Some(candidate.to_string());
    Ok(())
}

/// Forgets the passphrase. Cheap, and the only thing standing between a
/// handed-over phone and a standing grant to the vault.
pub fn lock() {
    *UNLOCKED.lock_or_recover() = None;
}

fn verify(config_dir: &Path, candidate: &str) -> Result<()> {
    let Some(lock) = read_lock(config_dir) else {
        return Err(Error::State("no passphrase is set on this device".into()));
    };
    let proof = crypto::open(candidate, &lock.proof)?;
    if proof != LOCK_PROOF {
        return Err(Error::State("wrong passphrase".into()));
    }
    Ok(())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let text = serde_json::to_string(value)
        .map_err(|e| Error::State(format!("cannot serialize a secret: {e}")))?;
    fs::write(path, text)?;
    Ok(())
}

/// Reads a secret, decrypting it when the lock is on. `None` means the
/// file is simply not there.
pub fn read_secret(config_dir: &Path, name: &str) -> Result<Option<Vec<u8>>> {
    if read_lock(config_dir).is_none() {
        let path = secret_path(config_dir, name);
        return match path.is_file() {
            true => Ok(Some(fs::read(path)?)),
            false => Ok(None),
        };
    }
    let Some(passphrase) = passphrase() else {
        return Err(Error::State(
            "this device is locked - enter its passphrase to reach the Google sign-in".into(),
        ));
    };
    read_secret_with(config_dir, name, &passphrase)
}

fn read_secret_with(config_dir: &Path, name: &str, passphrase: &str) -> Result<Option<Vec<u8>>> {
    let path = secret_path(config_dir, name);
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)?;
    // A file written before the lock was turned on, or by an older
    // build, is still plain: read it rather than failing, and the next
    // write seals it.
    let Ok(envelope) = serde_json::from_str::<Envelope>(&text) else {
        return Ok(Some(text.into_bytes()));
    };
    crypto::open(passphrase, &envelope).map(Some)
}

/// Writes a secret, sealing it when the lock is on.
pub fn write_secret(config_dir: &Path, name: &str, bytes: &[u8]) -> Result<()> {
    fs::create_dir_all(config_dir)?;
    let path = secret_path(config_dir, name);
    if read_lock(config_dir).is_none() {
        fs::write(path, bytes)?;
        return Ok(());
    }
    let Some(passphrase) = passphrase() else {
        return Err(Error::State(
            "this device is locked - enter its passphrase before signing in".into(),
        ));
    };
    write_json(&path, &crypto::seal(&passphrase, bytes)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// These tests share the process-global unlock state, so they run
    /// under one lock rather than in parallel with each other.
    static SERIAL: Mutex<()> = Mutex::new(());

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hypomnema-secrets-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const SECRETS: &[&str] = &["dropbox.json"];

    #[test]
    fn with_no_passphrase_a_secret_is_a_plain_file() {
        let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        lock();
        let dir = temp_dir("plain");
        write_secret(&dir, "dropbox.json", b"{\"refresh_token\":\"x\"}").unwrap();

        assert_eq!(
            fs::read_to_string(dir.join("dropbox.json")).unwrap(),
            "{\"refresh_token\":\"x\"}"
        );
        assert_eq!(
            state(&dir),
            LockState {
                enabled: false,
                unlocked: true
            }
        );
    }

    #[test]
    fn turning_the_lock_on_seals_what_was_already_there() {
        let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        lock();
        let dir = temp_dir("seal-existing");
        write_secret(&dir, "dropbox.json", b"refresh-token").unwrap();

        enable(&dir, "open sesame", SECRETS).unwrap();

        // Leaving the old plaintext behind would make the lock a
        // decoration: the token is what an attacker came for.
        let on_disk = fs::read_to_string(dir.join("dropbox.json")).unwrap();
        assert!(!on_disk.contains("refresh-token"));
        assert_eq!(
            read_secret(&dir, "dropbox.json").unwrap().unwrap(),
            b"refresh-token"
        );
    }

    #[test]
    fn a_locked_device_refuses_the_secret_until_unlocked() {
        let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        lock();
        let dir = temp_dir("locked");
        write_secret(&dir, "dropbox.json", b"refresh-token").unwrap();
        enable(&dir, "open sesame", SECRETS).unwrap();
        lock();

        assert_eq!(
            state(&dir),
            LockState {
                enabled: true,
                unlocked: false
            }
        );
        assert!(read_secret(&dir, "dropbox.json").is_err());

        assert!(unlock(&dir, "wrong").is_err());
        unlock(&dir, "open sesame").unwrap();
        assert_eq!(
            read_secret(&dir, "dropbox.json").unwrap().unwrap(),
            b"refresh-token"
        );
    }

    #[test]
    fn turning_the_lock_off_needs_the_passphrase_and_restores_plain_files() {
        let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        lock();
        let dir = temp_dir("disable");
        write_secret(&dir, "dropbox.json", b"refresh-token").unwrap();
        enable(&dir, "open sesame", SECRETS).unwrap();

        // Otherwise "turn the lock off" would be the way around it.
        assert!(disable(&dir, "guess", SECRETS).is_err());

        disable(&dir, "open sesame", SECRETS).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("dropbox.json")).unwrap(),
            "refresh-token"
        );
        assert!(!state(&dir).enabled);
    }

    #[test]
    fn an_empty_passphrase_is_refused() {
        let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        lock();
        let dir = temp_dir("empty");
        assert!(enable(&dir, "   ", SECRETS).is_err());
    }

    #[test]
    fn a_missing_secret_reads_as_absent_not_as_an_error() {
        let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        lock();
        let dir = temp_dir("absent");
        assert!(read_secret(&dir, "dropbox.json").unwrap().is_none());
        enable(&dir, "open sesame", SECRETS).unwrap();
        assert!(read_secret(&dir, "dropbox.json").unwrap().is_none());
    }
}
