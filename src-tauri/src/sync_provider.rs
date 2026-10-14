//! Backend-agnostic abstraction over "a folder of files kept in sync by
//! someone else". The sync engine (`sync_cycle.rs`, `sync_merge.rs`)
//! consumes this trait without caring which backend moved the bytes; the
//! one real implementation is `sync_gdrive.rs` (Google Drive's hidden
//! app folder), Dropbox's having been retired.
//!
//! Nothing outside this module's own tests calls into it yet - it's
//! staged ahead of the concrete providers and the vault-bootstrap wiring
//! that will use it, both later Phase 1 work.
#![allow(dead_code)]

use crate::error::Result;

/// Opaque per-file change marker. The two backends give different
/// guarantees (see ROADMAP.md "Change detection / write safety"):
/// - `Rev` (Dropbox API): server-issued, monotonic - a real
///   optimistic-concurrency token.
/// - `HashMtime` (SAF/filesystem): best-effort content hash + mtime, a
///   weaker signal with no server enforcement behind it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChangeMarker {
    Rev(String),
    HashMtime { hash: String, mtime_unix: i64 },
}

/// One entry from `SyncProvider::list_changes`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangedFile {
    pub path: String,
    pub marker: ChangeMarker,
    pub deleted: bool,
}

/// Opaque delta-listing checkpoint a backend hands back from
/// `list_changes` and accepts on the next call to resume from where it
/// left off (Dropbox's `list_folder`/`continue` cursor; a filesystem
/// backend can synthesize one from a directory-wide scan timestamp).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SyncCursor(pub Option<String>);

/// An extra copy of a path: two devices created the same file before
/// either saw the other's (Google Drive allows two files with one name).
/// The sync pass merges `bytes` into the local file, then hands the
/// duplicate back to `discard_duplicate`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Duplicate {
    pub path: String,
    pub bytes: Vec<u8>,
    /// Provider-specific id of this copy (a Drive file id).
    pub handle: String,
}

pub trait SyncProvider {
    /// List files changed since `cursor` (`SyncCursor::default()` = full
    /// listing). Returns the changes plus the cursor to pass next time.
    fn list_changes(&self, cursor: &SyncCursor) -> Result<(Vec<ChangedFile>, SyncCursor)>;

    /// Read a file's current bytes and change marker.
    fn read_file(&self, path: &str) -> Result<(Vec<u8>, ChangeMarker)>;

    /// Write a file, guarded by the marker this device last read or wrote
    /// for it. `None` means "create; fail if something is already there".
    /// A stale `expected_marker` fails with `Error::SyncConflict` rather
    /// than silently overwriting - the caller re-reads, runs the
    /// `sync_merge` step, and retries (ROADMAP.md Phase 1/3).
    fn write_file(
        &self,
        path: &str,
        contents: &[u8],
        expected_marker: Option<&ChangeMarker>,
    ) -> Result<ChangeMarker>;

    /// Remove a file, guarded by the marker this device last saw for it.
    /// Same contract as `write_file`: a stale marker fails with
    /// `Error::SyncConflict` instead of deleting what the other device
    /// just wrote. A path that is already gone is not an error - two
    /// devices deleting the same note agree, and the second one arriving
    /// should not have to care that it was second.
    fn delete_file(&self, path: &str, expected_marker: Option<&ChangeMarker>) -> Result<()>;

    /// Extra copies of paths found by the last `list_changes`, with their
    /// bytes. A backend that cannot hold two files under one path (Dropbox)
    /// never has any.
    fn take_duplicates(&self) -> Result<Vec<Duplicate>> {
        Ok(Vec::new())
    }

    /// Removes a duplicate whose content has been merged in. Gone already
    /// is not an error.
    fn discard_duplicate(&self, _duplicate: &Duplicate) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod mock {
    //! An in-memory `SyncProvider` used only to pin down the trait's
    //! contract in tests before any real backend exists.
    use super::*;
    use crate::error::Error;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct MockProvider {
        // path -> (bytes, revision counter)
        files: Mutex<HashMap<String, (Vec<u8>, u64)>>,
        // Paths whose reads fail, so callers that must survive a partial
        // failure can be tested without a real flaky network.
        unreadable: Mutex<std::collections::HashSet<String>>,
        // Deleted paths, so listings can carry tombstones the way
        // Dropbox's `include_deleted` does - a device that never hears
        // about a deletion keeps resurrecting the file.
        tombstones: Mutex<std::collections::HashSet<String>>,
        duplicates: Mutex<Vec<Duplicate>>,
        pub discarded: Mutex<Vec<Duplicate>>,
    }

    impl MockProvider {
        pub fn new() -> Self {
            Self::default()
        }

        /// Make this path exist in listings but fail to download.
        pub fn make_unreadable(&self, path: &str) {
            self.unreadable.lock().unwrap().insert(path.to_string());
        }

        /// Removes a file without leaving a tombstone, the way a backend
        /// with no deletion records (Google Drive) just stops listing it.
        pub fn vanish(&self, path: &str) {
            self.files.lock().unwrap().remove(path);
        }

        /// A second copy of `path`, as two devices racing to create it
        /// would leave on a backend that allows that.
        pub fn add_duplicate(&self, path: &str, bytes: &[u8]) {
            let mut duplicates = self.duplicates.lock().unwrap();
            let handle = format!("dup-{}", duplicates.len());
            duplicates.push(Duplicate {
                path: path.to_string(),
                bytes: bytes.to_vec(),
                handle,
            });
        }

        fn marker_for(rev: u64) -> ChangeMarker {
            ChangeMarker::Rev(rev.to_string())
        }
    }

    impl SyncProvider for MockProvider {
        fn list_changes(&self, _cursor: &SyncCursor) -> Result<(Vec<ChangedFile>, SyncCursor)> {
            let files = self.files.lock().unwrap();
            let mut changes: Vec<ChangedFile> = files
                .iter()
                .map(|(path, (_, rev))| ChangedFile {
                    path: path.clone(),
                    marker: Self::marker_for(*rev),
                    deleted: false,
                })
                .collect();
            for path in self.tombstones.lock().unwrap().iter() {
                changes.push(ChangedFile {
                    path: path.clone(),
                    marker: ChangeMarker::Rev(String::new()),
                    deleted: true,
                });
            }
            Ok((changes, SyncCursor(Some(files.len().to_string()))))
        }

        fn read_file(&self, path: &str) -> Result<(Vec<u8>, ChangeMarker)> {
            if self.unreadable.lock().unwrap().contains(path) {
                return Err(Error::State(format!("mock: unreadable: {path}")));
            }
            let files = self.files.lock().unwrap();
            let (bytes, rev) = files
                .get(path)
                .ok_or_else(|| Error::State(format!("not found: {path}")))?;
            Ok((bytes.clone(), Self::marker_for(*rev)))
        }

        fn write_file(
            &self,
            path: &str,
            contents: &[u8],
            expected_marker: Option<&ChangeMarker>,
        ) -> Result<ChangeMarker> {
            let mut files = self.files.lock().unwrap();
            let current_rev = files.get(path).map(|(_, rev)| *rev);
            let expected_rev = match expected_marker {
                None => None,
                Some(ChangeMarker::Rev(r)) => Some(r.parse::<u64>().map_err(|e| {
                    Error::State(format!("mock provider: not one of its own markers: {e}"))
                })?),
                Some(ChangeMarker::HashMtime { .. }) => {
                    return Err(Error::State(
                        "mock provider only ever issues Rev markers".into(),
                    ))
                }
            };
            if current_rev != expected_rev {
                return Err(Error::SyncConflict {
                    path: path.to_string(),
                });
            }
            let next_rev = current_rev.map(|r| r + 1).unwrap_or(0);
            files.insert(path.to_string(), (contents.to_vec(), next_rev));
            self.tombstones.lock().unwrap().remove(path);
            Ok(Self::marker_for(next_rev))
        }

        fn delete_file(&self, path: &str, expected_marker: Option<&ChangeMarker>) -> Result<()> {
            let mut files = self.files.lock().unwrap();
            let Some((_, current_rev)) = files.get(path) else {
                // Already gone: the deletions agree.
                return Ok(());
            };
            if let Some(ChangeMarker::Rev(expected)) = expected_marker {
                if expected != &current_rev.to_string() {
                    return Err(Error::SyncConflict {
                        path: path.to_string(),
                    });
                }
            }
            files.remove(path);
            self.tombstones.lock().unwrap().insert(path.to_string());
            Ok(())
        }

        fn take_duplicates(&self) -> Result<Vec<Duplicate>> {
            Ok(self.duplicates.lock().unwrap().clone())
        }

        fn discard_duplicate(&self, duplicate: &Duplicate) -> Result<()> {
            self.duplicates
                .lock()
                .unwrap()
                .retain(|d| d.handle != duplicate.handle);
            self.discarded.lock().unwrap().push(duplicate.clone());
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::mock::MockProvider;
    use super::*;
    use crate::error::Error;

    #[test]
    fn create_then_read_round_trips() {
        let provider = MockProvider::new();
        let marker = provider.write_file("tasks.jsonl", b"hello", None).unwrap();
        let (bytes, read_marker) = provider.read_file("tasks.jsonl").unwrap();
        assert_eq!(bytes, b"hello");
        assert_eq!(read_marker, marker);
    }

    #[test]
    fn write_with_stale_marker_conflicts() {
        let provider = MockProvider::new();
        let first = provider.write_file("tasks.jsonl", b"v1", None).unwrap();
        provider
            .write_file("tasks.jsonl", b"v2", Some(&first))
            .unwrap();

        // Still holding the stale `first` marker - simulates a second
        // device that hasn't seen the "v2" write yet.
        let err = provider
            .write_file("tasks.jsonl", b"v3-from-stale-writer", Some(&first))
            .unwrap_err();
        assert!(matches!(err, Error::SyncConflict { .. }));
    }

    #[test]
    fn create_fails_if_something_already_exists() {
        let provider = MockProvider::new();
        provider.write_file("tasks.jsonl", b"v1", None).unwrap();
        let err = provider.write_file("tasks.jsonl", b"v2", None).unwrap_err();
        assert!(matches!(err, Error::SyncConflict { .. }));
    }

    #[test]
    fn delete_with_a_stale_marker_conflicts_and_keeps_the_file() {
        let provider = MockProvider::new();
        let first = provider.write_file("note.md", b"v1", None).unwrap();
        provider.write_file("note.md", b"v2", Some(&first)).unwrap();

        let err = provider.delete_file("note.md", Some(&first)).unwrap_err();

        assert!(matches!(err, Error::SyncConflict { .. }));
        assert_eq!(provider.read_file("note.md").unwrap().0, b"v2");
    }

    #[test]
    fn deleting_what_is_already_gone_is_not_an_error() {
        let provider = MockProvider::new();
        let marker = provider.write_file("note.md", b"v1", None).unwrap();
        provider.delete_file("note.md", Some(&marker)).unwrap();
        // The second device's delete arrives after the first one's: they
        // agree, and arriving second is not a failure.
        provider.delete_file("note.md", Some(&marker)).unwrap();
    }

    #[test]
    fn a_deletion_shows_up_in_listings_as_a_tombstone() {
        let provider = MockProvider::new();
        let marker = provider.write_file("note.md", b"v1", None).unwrap();
        provider.delete_file("note.md", Some(&marker)).unwrap();

        let (changes, _) = provider.list_changes(&SyncCursor::default()).unwrap();

        assert_eq!(changes.len(), 1);
        assert!(changes[0].deleted);
        assert_eq!(changes[0].path, "note.md");
    }

    #[test]
    fn list_changes_reflects_writes() {
        let provider = MockProvider::new();
        provider.write_file("tasks.jsonl", b"v1", None).unwrap();
        provider.write_file("lists.jsonl", b"v1", None).unwrap();
        let (changes, _cursor) = provider.list_changes(&SyncCursor::default()).unwrap();
        let mut paths: Vec<_> = changes.iter().map(|c| c.path.clone()).collect();
        paths.sort();
        assert_eq!(paths, vec!["lists.jsonl", "tasks.jsonl"]);
    }
}
