//! Where a vault can live on a phone, and which of those places this
//! device will actually let the app write to.
//!
//! Android has no folder picker to offer. Tauri's dialog plugin picks
//! files, not directories, and the Storage Access Framework hands back an
//! opaque content:// tree rather than a path the Rust core could open
//! (`docs/android/SPIKES.md`, Spike A ran into the same wall from the
//! other side). So instead of a picker that cannot exist, this offers the
//! handful of places a vault plausibly goes, each **probed** rather than
//! assumed: the app writes a file and deletes it again.
//!
//! Probing is the point. On Android 11+ a path under shared storage is
//! readable and writable or not depending on permissions this build does
//! not hold, and the difference is invisible from the path alone. A list
//! that says "this one works, these three do not" is worth more than a
//! picker that offers all four and fails on three.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use crate::vault::WORK_DIR;

/// One place a vault could live, as the setup screen shows it.
#[derive(Debug, Clone, Serialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct VaultPlace {
    pub path: String,
    /// Short name for the row.
    pub label: String,
    /// Why someone would pick this one, in a sentence.
    pub note: String,
    /// The app created and removed a file here just now.
    pub writable: bool,
    /// A vault is already there - opening it adopts it rather than
    /// starting empty, which is the difference between "restore" and
    /// "start over" and must not be a surprise.
    pub has_vault: bool,
}

/// Can this app actually write here? Answered by writing, because on
/// Android the path tells you nothing: the same-looking directory is
/// writable or not depending on permissions and API level.
pub fn probe_writable(path: &Path) -> bool {
    if fs::create_dir_all(path).is_err() {
        return false;
    }
    let probe = path.join(".hypomnema-write-probe");
    let ok = fs::write(&probe, b"probe").is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

pub fn has_vault(path: &Path) -> bool {
    path.join(WORK_DIR).is_dir()
}

/// The candidate directories, in the order they are worth trying.
///
/// `app_data` is this device's private storage (Tauri's app data dir);
/// `identifier` is the Android package name, which is what names the
/// app's own folder on external storage.
pub fn candidates(app_data: &Path, identifier: &str) -> Vec<(PathBuf, &'static str, String)> {
    let mut places = vec![(
        app_data.join("vault"),
        "This device only",
        "Private to the app. Nothing else can read it, and neither can a \
         computer over USB."
            .to_string(),
    )];
    if cfg!(target_os = "android") {
        places.push((
            PathBuf::from(format!(
                "/storage/emulated/0/Android/data/{identifier}/files/vault"
            )),
            "App folder on shared storage",
            "The app's own folder outside its sandbox. Needs no permission, \
             and on most phones a computer can reach it over USB."
                .to_string(),
        ));
        places.push((
            PathBuf::from("/storage/emulated/0/Documents/Hypomnema"),
            "Documents",
            "An ordinary folder any file manager shows. Needs all-files \
             access, which this build does not ask for - shown so it is \
             visible whether this phone allows it."
                .to_string(),
        ));
        places.push((
            PathBuf::from("/storage/emulated/0/Hypomnema"),
            "Internal storage",
            "The top of internal storage. Same permission caveat as \
             Documents."
                .to_string(),
        ));
    }
    places
}

/// The candidate list with every entry probed.
pub fn places(app_data: &Path, identifier: &str) -> Vec<VaultPlace> {
    candidates(app_data, identifier)
        .into_iter()
        .map(|(path, label, note)| VaultPlace {
            writable: probe_writable(&path),
            has_vault: has_vault(&path),
            path: path.to_string_lossy().into_owned(),
            label: label.to_string(),
            note,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hypomnema-places-{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_writable_directory_probes_writable_and_leaves_nothing_behind() {
        let dir = temp_dir("writable");
        assert!(probe_writable(&dir));
        // The probe file must not survive: a stray dotfile in a vault
        // root would sync to every other device.
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_path_that_cannot_be_created_probes_unwritable() {
        // A directory under a *file* can never be made.
        let file = temp_dir("blocked");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, b"not a directory").unwrap();
        assert!(!probe_writable(&file.join("vault")));
        let _ = fs::remove_file(&file);
    }

    #[test]
    fn an_existing_vault_is_recognized_so_opening_it_is_not_a_surprise() {
        let dir = temp_dir("existing");
        fs::create_dir_all(dir.join(WORK_DIR)).unwrap();
        assert!(has_vault(&dir));

        let empty = temp_dir("empty");
        fs::create_dir_all(&empty).unwrap();
        assert!(!has_vault(&empty));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&empty);
    }

    #[test]
    fn the_private_directory_is_always_offered_first() {
        let app_data = temp_dir("candidates");
        let listed = candidates(&app_data, "com.example.app");
        assert_eq!(listed[0].0, app_data.join("vault"));
        // Everything after it is Android-only; on this host there is
        // nothing else to offer, and offering a Linux path that means
        // nothing on a phone would be worse than a short list.
        assert_eq!(
            listed.len(),
            if cfg!(target_os = "android") { 4 } else { 1 }
        );
    }
}
