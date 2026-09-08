//! Backend-agnostic abstraction over "a folder of files kept in sync by
//! someone else" (Dropbox API, or a Storage-Access-Framework-exposed
//! folder). `docs/android/ROADMAP.md` Phase 1: the merge logic in
//! `sync_merge.rs` consumes this trait without caring which backend moved
//! the bytes - see ROADMAP.md's "Dropbox integration: dual-backend, not
//! either/or".
//!
//! No concrete implementation lives here yet:
//! - `DropboxApiSyncProvider` needs a registered Dropbox app (OAuth client
//!   id) before it can be wired up for real.
//! - `FilesystemSyncProvider` is gated on Spike A (SAF feasibility, see
//!   `docs/android/SPIKES.md`) passing.
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
    }

    impl MockProvider {
        pub fn new() -> Self {
            Self::default()
        }

        fn marker_for(rev: u64) -> ChangeMarker {
            ChangeMarker::Rev(rev.to_string())
        }
    }

    impl SyncProvider for MockProvider {
        fn list_changes(&self, _cursor: &SyncCursor) -> Result<(Vec<ChangedFile>, SyncCursor)> {
            let files = self.files.lock().unwrap();
            let changes = files
                .iter()
                .map(|(path, (_, rev))| ChangedFile {
                    path: path.clone(),
                    marker: Self::marker_for(*rev),
                    deleted: false,
                })
                .collect();
            Ok((changes, SyncCursor(Some(files.len().to_string()))))
        }

        fn read_file(&self, path: &str) -> Result<(Vec<u8>, ChangeMarker)> {
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
            Ok(Self::marker_for(next_rev))
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
