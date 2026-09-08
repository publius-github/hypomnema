//! Finding the vault inside a Dropbox app folder, and deciding which of
//! its files this device needs to pull. docs/android/ROADMAP.md Phase 1.
//!
//! The app folder is not the vault. Dropbox drops its own `desktop.ini`
//! in there, this app writes a marker file (`dropbox_link.rs`), and a
//! user may reasonably keep the vault as a named subfolder rather than
//! spilling its contents next to those. So the vault root is *detected*,
//! not configured: one less setup step to get wrong, and it works whether
//! the vault sits at the app-folder root or one level down.
//!
//! What identifies a vault root is `.hypomnema/` - the same working
//! directory `vault.rs` creates and every vault has.
#![allow(dead_code)]

use std::fs;
use std::path::Path;

use crate::error::{Error, Result};
use crate::sync_paths;
use crate::sync_provider::SyncProvider;
use crate::vault::WORK_DIR;

/// Where the vault sits inside the app folder: `""` when its contents are
/// at the root, or a `"subfolder/"` prefix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultRoot(pub String);

impl VaultRoot {
    /// The app-folder path of a vault-relative path.
    pub fn absolute(&self, vault_relative: &str) -> String {
        format!("{}{}", self.0, vault_relative)
    }

    /// The vault-relative path of an app-folder path, or `None` when the
    /// path lies outside the vault (the marker file, `desktop.ini`, a
    /// second vault).
    pub fn relative<'a>(&self, app_folder_path: &'a str) -> Option<&'a str> {
        app_folder_path.strip_prefix(self.0.as_str())
    }
}

/// Locates the vault in a listing of the app folder.
///
/// Prefers the shallowest candidate, since a vault nested inside another
/// vault's tree is a copy or a backup rather than a second vault. Two
/// candidates at the same depth are refused instead of guessed at: which
/// one holds the user's real work is not a coin flip worth taking.
pub fn detect_vault_root(paths: &[String]) -> Result<VaultRoot> {
    let marker = format!("{WORK_DIR}/");
    let mut candidates: Vec<String> = paths
        .iter()
        .filter_map(|path| {
            let path = path.trim_start_matches('/');
            let at = path.find(&marker)?;
            // Must be a whole path segment: "my.hypomnema/" is not one.
            if at != 0 && !path[..at].ends_with('/') {
                return None;
            }
            Some(path[..at].to_string())
        })
        .collect();
    candidates.sort();
    candidates.dedup();

    let shallowest = candidates
        .iter()
        .map(|c| c.matches('/').count())
        .min()
        .ok_or_else(|| {
            Error::State(format!(
                "no vault in this Dropbox app folder - expected a {WORK_DIR}/ directory, \
                 either at its root or inside one subfolder"
            ))
        })?;
    let mut shallowest: Vec<&String> = candidates
        .iter()
        .filter(|c| c.matches('/').count() == shallowest)
        .collect();
    shallowest.dedup();
    match shallowest.as_slice() {
        [only] => Ok(VaultRoot((*only).clone())),
        many => Err(Error::State(format!(
            "this Dropbox app folder holds {} vaults ({}); it must hold one",
            many.len(),
            many.iter()
                .map(|c| if c.is_empty() {
                    "the folder root".to_string()
                } else {
                    c.trim_end_matches('/').to_string()
                })
                .collect::<Vec<_>>()
                .join(", ")
        ))),
    }
}

/// The app-folder paths this device should pull, given a listing.
///
/// Filtered through `sync_paths`, so the same whitelist that keeps
/// `app.db` out of the shared vault also keeps it from being downloaded
/// into one - a device pulling another device's database would defeat the
/// disposable-cache model rather than corrupting it, but it would still
/// be wrong.
pub fn files_to_pull(paths: &[String], root: &VaultRoot) -> Vec<String> {
    paths
        .iter()
        .filter(|path| {
            root.relative(path.trim_start_matches('/'))
                .is_some_and(sync_paths::is_synced)
        })
        .cloned()
        .collect()
}

/// What a pull brought down, for the screen that triggered it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PullReport {
    pub vault_root: String,
    pub files: usize,
    pub bytes: usize,
}

/// Downloads the shared vault into `local_root`, a directory this device
/// owns privately.
///
/// The local copy is a working vault like any other: `app.db` is rebuilt
/// there from the JSONL snapshot by the existing restore path, and it
/// stays there. Nothing puts it back into the app folder, because
/// `sync_paths` never lists it as shared - which is why "the database
/// never travels" holds without a separate exclude step to maintain.
pub fn pull_vault<P: SyncProvider>(
    provider: &P,
    local_root: &Path,
    listing: &[String],
) -> Result<PullReport> {
    let root = detect_vault_root(listing)?;
    let wanted = files_to_pull(listing, &root);
    let mut report = PullReport {
        vault_root: root.0.clone(),
        ..Default::default()
    };
    for remote in &wanted {
        let relative = root
            .relative(remote.trim_start_matches('/'))
            .ok_or_else(|| Error::State(format!("{remote} is outside the vault")))?;
        let (bytes, _marker) = provider.read_file(remote)?;
        let target = local_root.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, &bytes)?;
        report.files += 1;
        report.bytes += bytes.len();
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_provider::mock::MockProvider;

    fn paths(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("hypomnema-bootstrap-{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_vault_at_the_app_folder_root_is_found() {
        let listing = paths(&[
            "HYPOMNEMA-APP-FOLDER.md",
            ".hypomnema/state/tasks.jsonl",
            "journal/2026-09-08.md",
        ]);
        assert_eq!(detect_vault_root(&listing).unwrap(), VaultRoot("".into()));
    }

    /// The layout a user actually ends up with: Dropbox's desktop.ini and
    /// this app's marker live at the app-folder root, so keeping the vault
    /// in its own subfolder keeps them out of the notes tree.
    #[test]
    fn a_vault_in_a_subfolder_is_found() {
        let listing = paths(&[
            "HYPOMNEMA-APP-FOLDER.md",
            "desktop.ini",
            "hypomnema-vault/.hypomnema/state/tasks.jsonl",
            "hypomnema-vault/journal/2026-09-08.md",
        ]);
        assert_eq!(
            detect_vault_root(&listing).unwrap(),
            VaultRoot("hypomnema-vault/".into())
        );
    }

    #[test]
    fn an_app_folder_without_a_vault_says_so() {
        let listing = paths(&["HYPOMNEMA-APP-FOLDER.md", "desktop.ini"]);
        let err = detect_vault_root(&listing).unwrap_err();
        assert!(matches!(err, Error::State(_)));
    }

    #[test]
    fn a_nested_copy_does_not_outrank_the_real_vault() {
        // A backup copy living inside the vault is not a second vault.
        let listing = paths(&[
            "vault/.hypomnema/state/tasks.jsonl",
            "vault/old-copy/.hypomnema/state/tasks.jsonl",
        ]);
        assert_eq!(
            detect_vault_root(&listing).unwrap(),
            VaultRoot("vault/".into())
        );
    }

    #[test]
    fn two_vaults_side_by_side_are_refused_rather_than_guessed() {
        let listing = paths(&[
            "work/.hypomnema/state/tasks.jsonl",
            "personal/.hypomnema/state/tasks.jsonl",
        ]);
        let err = detect_vault_root(&listing).unwrap_err();
        assert!(matches!(err, Error::State(_)));
    }

    #[test]
    fn a_folder_merely_ending_in_the_work_dir_name_is_not_a_vault() {
        let listing = paths(&["notes/my.hypomnema/state/tasks.jsonl"]);
        assert!(detect_vault_root(&listing).is_err());
    }

    #[test]
    fn only_shared_vault_files_are_pulled() {
        let root = VaultRoot("vault/".into());
        let listing = paths(&[
            "HYPOMNEMA-APP-FOLDER.md",
            "vault/.hypomnema/state/tasks.jsonl",
            "vault/.hypomnema/config/recurring.yml",
            "vault/journal/2026-09-08.md",
            // Should never have been uploaded; must not be pulled either.
            "vault/.hypomnema/app.db",
            "vault/.hypomnema/settings/app.yml",
        ]);

        let pull = files_to_pull(&listing, &root);

        assert_eq!(
            pull,
            paths(&[
                "vault/.hypomnema/state/tasks.jsonl",
                "vault/.hypomnema/config/recurring.yml",
                "vault/journal/2026-09-08.md",
            ])
        );
    }

    #[test]
    fn a_pull_lands_the_vault_locally_under_its_own_relative_paths() {
        let provider = MockProvider::new();
        provider
            .write_file("vault/.hypomnema/state/tasks.jsonl", b"{\"id\":1}\n", None)
            .unwrap();
        provider
            .write_file("vault/journal/2026-09-08.md", b"# today", None)
            .unwrap();
        provider
            .write_file("vault/.hypomnema/app.db", b"binary", None)
            .unwrap();
        let listing: Vec<String> = paths(&[
            "vault/.hypomnema/state/tasks.jsonl",
            "vault/journal/2026-09-08.md",
            "vault/.hypomnema/app.db",
            "HYPOMNEMA-APP-FOLDER.md",
        ]);
        let local = temp_dir("pull");

        let report = pull_vault(&provider, &local, &listing).unwrap();

        assert_eq!(report.vault_root, "vault/");
        assert_eq!(report.files, 2);
        // The subfolder the vault happened to live in does not leak into
        // the local copy: this is a vault root like any other.
        assert_eq!(
            fs::read_to_string(local.join(".hypomnema/state/tasks.jsonl")).unwrap(),
            "{\"id\":1}\n"
        );
        assert_eq!(
            fs::read_to_string(local.join("journal/2026-09-08.md")).unwrap(),
            "# today"
        );
        // Someone else's database must not be pulled onto this device
        // even if it somehow made it into the app folder.
        assert!(!local.join(".hypomnema/app.db").exists());
    }

    #[test]
    fn a_pull_from_an_app_folder_without_a_vault_fails_before_writing_anything() {
        let provider = MockProvider::new();
        let local = temp_dir("pull-empty");
        let listing = paths(&["HYPOMNEMA-APP-FOLDER.md", "desktop.ini"]);

        assert!(pull_vault(&provider, &local, &listing).is_err());
        assert!(!local.exists());
    }

    #[test]
    fn paths_round_trip_through_the_root() {
        let root = VaultRoot("vault/".into());
        assert_eq!(
            root.absolute("journal/2026-09-08.md"),
            "vault/journal/2026-09-08.md"
        );
        assert_eq!(
            root.relative("vault/journal/2026-09-08.md"),
            Some("journal/2026-09-08.md")
        );
        assert_eq!(root.relative("HYPOMNEMA-APP-FOLDER.md"), None);
    }
}
