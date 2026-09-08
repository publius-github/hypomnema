//! Walking the filesystem to choose where a vault lives, and knowing
//! which directories this device will actually let the app write to.
//!
//! Android has no folder picker to hand off to. Tauri's dialog plugin
//! picks files, not directories, and the Storage Access Framework returns
//! an opaque `content://` tree rather than a path the Rust core could
//! open (`docs/android/SPIKES.md`, Spike A hit the same wall from the
//! other side). So the app browses the filesystem itself: this module is
//! the listing behind that browser.
//!
//! Two things it reports that a plain `read_dir` does not, because both
//! are invisible from a path on Android and both change what the button
//! under the list should say:
//!
//! - **writable**, probed by writing a file and deleting it again. On
//!   Android 11+ two identical-looking directories differ only by
//!   permissions, and a chooser that accepts a folder it cannot write to
//!   fails after the choice instead of before it.
//! - **has_vault**, so "use this folder" and "open this vault" are
//!   different words. Adopting an existing vault and starting an empty
//!   one must not look the same.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::vault::WORK_DIR;

/// A directory the browser can move into.
#[derive(Debug, Clone, Serialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct DirEntryView {
    pub name: String,
    pub path: String,
    /// A vault already lives here.
    pub has_vault: bool,
}

/// A shortcut in the browser's header - somewhere worth starting from.
#[derive(Debug, Clone, Serialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct VaultPlace {
    pub path: String,
    /// Short name for the button.
    pub label: String,
}

/// One directory, as the browser shows it.
#[derive(Debug, Clone, Serialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct DirListing {
    pub path: String,
    /// `None` at a root the browser should not climb past.
    pub parent: Option<String>,
    pub entries: Vec<DirEntryView>,
    /// The directory could be listed at all. False is the normal answer
    /// for shared storage on a device that has not granted this app
    /// access to it, and the screen says so rather than showing an empty
    /// folder that looks like an empty folder.
    pub readable: bool,
    pub writable: bool,
    pub has_vault: bool,
    /// Places worth jumping to, so browsing never starts from nothing.
    pub shortcuts: Vec<VaultPlace>,
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

/// Like `probe_writable`, but never creates the directory - the browser
/// asks about folders that already exist, and making one as a side effect
/// of looking at it would litter storage with empty Hypomnema folders.
fn probe_writable_existing(path: &Path) -> bool {
    if !path.is_dir() {
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

/// Where browsing starts, and the shortcuts offered throughout.
///
/// `app_data` is Tauri's app data dir (private to the app); `identifier`
/// is the Android package name, which is what names the app's own folder
/// on shared storage.
pub fn shortcuts(app_data: &Path, identifier: &str) -> Vec<(PathBuf, &'static str)> {
    let mut places = vec![(app_data.to_path_buf(), "App storage")];
    if cfg!(target_os = "android") {
        places.push((
            PathBuf::from(format!(
                "/storage/emulated/0/Android/data/{identifier}/files"
            )),
            "USB-visible",
        ));
        places.push((PathBuf::from("/storage/emulated/0"), "Internal storage"));
    }
    places
}

/// The default place a vault goes when nobody chooses.
///
/// The app's own folder on shared storage rather than its private one:
/// both need no permission, but only this one can be reached from a
/// computer over USB, and "how do I get my existing vault in?" is the
/// first question a phone install raises.
pub fn default_vault_dir(app_data: &Path, identifier: &str) -> PathBuf {
    if cfg!(target_os = "android") {
        let shared = PathBuf::from(format!(
            "/storage/emulated/0/Android/data/{identifier}/files/vault"
        ));
        if probe_writable(&shared) {
            return shared;
        }
    }
    app_data.join("vault")
}

fn shortcut_views(app_data: &Path, identifier: &str) -> Vec<VaultPlace> {
    shortcuts(app_data, identifier)
        .into_iter()
        .filter(|(path, _)| path.is_dir())
        .map(|(path, label)| VaultPlace {
            path: path.to_string_lossy().into_owned(),
            label: label.to_string(),
        })
        .collect()
}

/// Lists one directory for the browser.
pub fn browse(path: &Path, app_data: &Path, identifier: &str) -> Result<DirListing> {
    if !path.is_dir() {
        return Err(Error::State(format!("{} is not a folder", path.display())));
    }
    let mut entries: Vec<DirEntryView> = Vec::new();
    let readable = match fs::read_dir(path) {
        Ok(iter) => {
            for entry in iter.flatten() {
                let child = entry.path();
                if !child.is_dir() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                // The app's own working directory is not a place to put
                // another vault inside, and showing it invites exactly
                // that.
                if name == WORK_DIR {
                    continue;
                }
                entries.push(DirEntryView {
                    has_vault: has_vault(&child),
                    name,
                    path: child.to_string_lossy().into_owned(),
                });
            }
            true
        }
        Err(_) => false,
    };
    entries.sort_by_key(|entry| entry.name.to_lowercase());

    Ok(DirListing {
        parent: path
            .parent()
            .filter(|p| p.is_dir() && *p != path)
            .map(|p| p.to_string_lossy().into_owned()),
        path: path.to_string_lossy().into_owned(),
        entries,
        readable,
        writable: probe_writable_existing(path),
        has_vault: has_vault(path),
        shortcuts: shortcut_views(app_data, identifier),
    })
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
    fn browsing_never_creates_the_folder_it_is_looking_at() {
        // probe_writable would have made it; the browser must not turn
        // looking into a side effect.
        let dir = temp_dir("no-side-effect");
        assert!(!probe_writable_existing(&dir.join("nothing-here")));
        assert!(!dir.join("nothing-here").exists());
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
    fn a_listing_shows_subfolders_marks_vaults_and_hides_the_work_dir() {
        let dir = temp_dir("listing");
        fs::create_dir_all(dir.join("Notes")).unwrap();
        fs::create_dir_all(dir.join("Archive").join(WORK_DIR)).unwrap();
        fs::create_dir_all(dir.join(WORK_DIR)).unwrap();
        fs::write(dir.join("a-file.md"), b"not a folder").unwrap();

        let listing = browse(&dir, &dir, "com.example.app").unwrap();

        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        // Files are not places to put a vault, and the app's own working
        // directory is not a place to put another one inside.
        assert_eq!(names, vec!["Archive", "Notes"]);
        assert!(listing.entries[0].has_vault);
        assert!(!listing.entries[1].has_vault);
        assert!(listing.readable);
        assert!(listing.writable);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn browsing_something_that_is_not_a_folder_is_an_error_not_an_empty_list() {
        let file = temp_dir("not-a-folder");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, b"x").unwrap();
        assert!(browse(&file, &file, "com.example.app").is_err());
        let _ = fs::remove_file(&file);
    }

    #[test]
    fn the_parent_is_offered_until_the_filesystem_root() {
        let dir = temp_dir("parent");
        fs::create_dir_all(dir.join("child")).unwrap();
        let listing = browse(&dir.join("child"), &dir, "com.example.app").unwrap();
        assert_eq!(listing.parent.as_deref(), Some(dir.to_str().unwrap()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_default_falls_back_to_private_storage_when_shared_is_unreachable() {
        // On this host there is no /storage/emulated/0, which is exactly
        // the shape of an Android device that refuses it.
        let app_data = temp_dir("default");
        assert_eq!(
            default_vault_dir(&app_data, "com.example.app"),
            app_data.join("vault")
        );
        let _ = fs::remove_dir_all(&app_data);
    }
}
