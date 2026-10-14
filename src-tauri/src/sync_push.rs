//! Sending this device's changes back to the shared vault.
//! docs/android/ROADMAP.md Phase 1/3.
//!
//! The pull's manifest is what makes this answerable: it records, per
//! file, the revision that was fetched and a hash of what arrived. A file
//! whose hash still matches has not been touched here and is not worth a
//! request; one that differs is a local edit, and it goes up **guarded by
//! the revision it was based on**. The provider rejects the write if the
//! remote has moved since - which is the whole reason an API backend was
//! chosen over a synced folder (ROADMAP.md's Spike A verdict). A
//! rejection is reported, never overwritten: the other device's edit is
//! not this device's to discard.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::sync_bootstrap::{
    load_manifest, save_manifest, FileState, VaultRoot, MANIFEST_FLUSH_EVERY,
};
use crate::sync_paths;
use crate::sync_provider::{ChangeMarker, SyncProvider};

/// What a push sent, and what it could not.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PushReport {
    pub uploaded: usize,
    pub bytes: usize,
    /// The paths that actually went up. A caller that keeps a merge base
    /// (sync_cycle.rs) needs to know which files the other device can now
    /// be assumed to have.
    pub sent: Vec<String>,
    /// Files the remote had moved on since this device last saw them.
    /// Not an error to swallow and not a write to force - both sides
    /// changed, and resolving that is the merge step's job.
    pub conflicts: Vec<String>,
    pub failed: Vec<String>,
}

pub fn content_hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Every vault file this device holds that belongs to the shared vault.
fn local_files(local_root: &Path) -> Result<Vec<String>> {
    let mut found = Vec::new();
    walk(local_root, local_root, &mut found)?;
    found.sort();
    Ok(found)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            walk(root, &path, out)?;
            continue;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let relative = relative.to_string_lossy().replace('\\', "/");
        if sync_paths::is_synced(&relative) {
            out.push(relative);
        }
    }
    Ok(())
}

/// Uploads everything changed here since the last pull or push.
///
/// Deletions are deliberately not propagated yet: a file missing locally
/// is indistinguishable from one this device never pulled (a failed
/// fetch, an interrupted pull), and guessing wrong deletes the user's
/// note on every device. That needs the tombstone half of the merge
/// design before it is safe - ROADMAP.md Phase 3.
pub fn push_vault<P: SyncProvider>(
    provider: &P,
    local_root: &Path,
    root: &VaultRoot,
    mut on_progress: impl FnMut(usize, usize),
) -> Result<PushReport> {
    let files = local_files(local_root)?;
    let mut manifest = load_manifest(local_root);
    let mut report = PushReport::default();

    let changed: Vec<(String, Vec<u8>, String)> = files
        .iter()
        .filter_map(|relative| {
            let bytes = std::fs::read(local_root.join(relative)).ok()?;
            let hash = content_hash(&bytes);
            let remote = root.absolute(relative);
            match manifest.get(&remote) {
                // Untouched since it arrived: nothing to say about it.
                Some(state) if state.hash.as_deref() == Some(hash.as_str()) => None,
                _ => Some((remote, bytes, hash)),
            }
        })
        .collect();

    let total = changed.len();
    let mut since_flush = 0;
    for (done, (remote, bytes, hash)) in changed.into_iter().enumerate() {
        let expected = manifest
            .get(&remote)
            .map(|state| ChangeMarker::Rev(state.rev.clone()));
        match provider.write_file(&remote, &bytes, expected.as_ref()) {
            Ok(ChangeMarker::Rev(rev)) => {
                report.uploaded += 1;
                report.bytes += bytes.len();
                report.sent.push(remote.clone());
                manifest.insert(
                    remote,
                    FileState {
                        rev,
                        hash: Some(hash),
                    },
                );
                since_flush += 1;
                if since_flush >= MANIFEST_FLUSH_EVERY {
                    save_manifest(local_root, &manifest)?;
                    since_flush = 0;
                }
            }
            Ok(other) => {
                return Err(Error::State(format!(
                    "the remote returned a non-revision marker: {other:?}"
                )))
            }
            Err(Error::SyncConflict { .. }) => report.conflicts.push(remote),
            Err(_) => report.failed.push(remote),
        }
        on_progress(done + 1, total);
    }
    save_manifest(local_root, &manifest)?;
    Ok(report)
}

/// Adopt the current local contents as the baseline, without uploading.
///
/// Used right after a vault is opened for the first time on a device: the
/// files on disk are exactly what was pulled, so hashing them now records
/// the truth. Without it every file would look locally changed and the
/// first push would upload the whole vault back unchanged.
pub fn adopt_local_baseline(local_root: &Path, root: &VaultRoot) -> Result<usize> {
    let mut manifest: BTreeMap<String, FileState> = load_manifest(local_root);
    let mut adopted = 0;
    for relative in local_files(local_root)? {
        let remote = root.absolute(&relative);
        let Some(state) = manifest.get(&remote) else {
            continue;
        };
        if state.hash.is_some() {
            continue;
        }
        let Ok(bytes) = std::fs::read(local_root.join(&relative)) else {
            continue;
        };
        let rev = state.rev.clone();
        manifest.insert(
            remote,
            FileState {
                rev,
                hash: Some(content_hash(&bytes)),
            },
        );
        adopted += 1;
    }
    save_manifest(local_root, &manifest)?;
    Ok(adopted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_provider::mock::MockProvider;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hypomnema-push-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_local(root: &Path, relative: &str, contents: &[u8]) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    fn vault_root() -> VaultRoot {
        VaultRoot("vault/".into())
    }

    #[test]
    fn only_locally_changed_files_are_uploaded() {
        let local = temp_dir("changed-only");
        let provider = MockProvider::new();
        let untouched = provider
            .write_file("vault/journal/a.md", b"same", None)
            .unwrap();
        let edited = provider
            .write_file("vault/journal/b.md", b"old", None)
            .unwrap();
        write_local(&local, "journal/a.md", b"same");
        write_local(&local, "journal/b.md", b"edited here");

        let mut manifest = BTreeMap::new();
        for (path, marker, bytes) in [
            ("vault/journal/a.md", &untouched, &b"same"[..]),
            ("vault/journal/b.md", &edited, &b"old"[..]),
        ] {
            let ChangeMarker::Rev(rev) = marker else {
                unreachable!()
            };
            manifest.insert(
                path.to_string(),
                FileState {
                    rev: rev.clone(),
                    hash: Some(content_hash(bytes)),
                },
            );
        }
        save_manifest(&local, &manifest).unwrap();

        let report = push_vault(&provider, &local, &vault_root(), |_, _| {}).unwrap();

        assert_eq!(report.uploaded, 1);
        assert!(report.conflicts.is_empty());
        assert_eq!(
            provider.read_file("vault/journal/b.md").unwrap().0,
            b"edited here"
        );
        // The untouched one was never sent, so its revision stands.
        assert_eq!(
            provider.read_file("vault/journal/a.md").unwrap().1,
            untouched
        );
    }

    #[test]
    fn a_file_changed_on_both_ends_is_a_conflict_not_an_overwrite() {
        let local = temp_dir("conflict");
        let provider = MockProvider::new();
        let base = provider
            .write_file("vault/journal/a.md", b"base", None)
            .unwrap();
        // Someone else edits it after this device pulled.
        provider
            .write_file("vault/journal/a.md", b"theirs", Some(&base))
            .unwrap();
        write_local(&local, "journal/a.md", b"mine");

        let ChangeMarker::Rev(rev) = &base else {
            unreachable!()
        };
        let mut manifest = BTreeMap::new();
        manifest.insert(
            "vault/journal/a.md".to_string(),
            FileState {
                rev: rev.clone(),
                hash: Some(content_hash(b"base")),
            },
        );
        save_manifest(&local, &manifest).unwrap();

        let report = push_vault(&provider, &local, &vault_root(), |_, _| {}).unwrap();

        assert_eq!(report.uploaded, 0);
        assert_eq!(report.conflicts, vec!["vault/journal/a.md".to_string()]);
        // Their edit survives untouched - it is not this device's to drop.
        assert_eq!(
            provider.read_file("vault/journal/a.md").unwrap().0,
            b"theirs"
        );
    }

    #[test]
    fn a_file_created_here_is_uploaded_as_new() {
        let local = temp_dir("new-file");
        let provider = MockProvider::new();
        write_local(&local, "journal/fresh.md", b"written on the phone");

        let report = push_vault(&provider, &local, &vault_root(), |_, _| {}).unwrap();

        assert_eq!(report.uploaded, 1);
        assert_eq!(
            provider.read_file("vault/journal/fresh.md").unwrap().0,
            b"written on the phone"
        );
    }

    #[test]
    fn device_local_files_are_never_pushed() {
        let local = temp_dir("local-only");
        let provider = MockProvider::new();
        write_local(&local, ".hypomnema/app.db", b"sqlite");
        write_local(&local, ".hypomnema/settings/app.yml", b"theme: dark");
        write_local(&local, ".hypomnema/backups/db/x.db", b"backup");

        let report = push_vault(&provider, &local, &vault_root(), |_, _| {}).unwrap();

        assert_eq!(report.uploaded, 0);
    }

    #[test]
    fn adopting_the_baseline_stops_the_first_push_from_re_uploading_everything() {
        let local = temp_dir("adopt");
        let provider = MockProvider::new();
        let marker = provider
            .write_file("vault/journal/a.md", b"contents", None)
            .unwrap();
        write_local(&local, "journal/a.md", b"contents");
        let ChangeMarker::Rev(rev) = &marker else {
            unreachable!()
        };
        // A manifest from a pull that predates content hashing.
        let mut manifest = BTreeMap::new();
        manifest.insert(
            "vault/journal/a.md".to_string(),
            FileState {
                rev: rev.clone(),
                hash: None,
            },
        );
        save_manifest(&local, &manifest).unwrap();

        assert_eq!(adopt_local_baseline(&local, &vault_root()).unwrap(), 1);

        let report = push_vault(&provider, &local, &vault_root(), |_, _| {}).unwrap();
        assert_eq!(report.uploaded, 0);
    }
}
