//! This installation's device id: the `updated_by` half of the merge
//! stamps (docs/android/ROADMAP.md Phase 1, REQUIREMENTS.md §3).
//!
//! It lives in the app's **private config dir**, never in the vault. A
//! vault copied or synced to a second machine must not carry the first
//! machine's identity with it - two devices sharing one id would make
//! their edits indistinguishable, which is the one thing the stamp
//! exists to prevent.
//!
//! The id is opaque and carries no meaning: not a hostname, not an
//! account, nothing that would leak into a synced file. It only has to be
//! stable per install and different from every other device's.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

const DEVICE_FILE: &str = "device-id";

fn device_file(config_dir: &Path) -> PathBuf {
    config_dir.join(DEVICE_FILE)
}

/// 128 random bits, hex encoded. Long enough that two installs colliding
/// is not a thing that happens.
fn generate() -> Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes)
        .map_err(|e| Error::State(format!("no system randomness for a device id: {e}")))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// This device's id, generated and persisted on first call.
pub fn ensure(config_dir: &Path) -> Result<String> {
    let path = device_file(config_dir);
    if let Ok(existing) = fs::read_to_string(&path) {
        let existing = existing.trim().to_string();
        if !existing.is_empty() {
            return Ok(existing);
        }
        // An empty or truncated file (a crash mid-write, a half-restored
        // backup) is replaced rather than propagated: an empty
        // `updated_by` would silently merge as "some device".
    }
    let id = generate()?;
    fs::create_dir_all(config_dir)?;
    fs::write(&path, &id)?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hypomnema-device-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_id_is_stable_across_calls() {
        let dir = temp_dir("stable");
        let first = ensure(&dir).unwrap();
        assert_eq!(ensure(&dir).unwrap(), first);
    }

    #[test]
    fn two_installs_get_different_ids() {
        let a = ensure(&temp_dir("install-a")).unwrap();
        let b = ensure(&temp_dir("install-b")).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn the_id_is_hex_and_long_enough_to_not_collide() {
        let id = ensure(&temp_dir("shape")).unwrap();
        assert_eq!(id.len(), 32);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn an_empty_file_is_replaced_rather_than_returned() {
        let dir = temp_dir("empty");
        fs::write(device_file(&dir), "   \n").unwrap();
        let id = ensure(&dir).unwrap();
        assert_eq!(id.len(), 32);
        assert_eq!(ensure(&dir).unwrap(), id);
    }
}
