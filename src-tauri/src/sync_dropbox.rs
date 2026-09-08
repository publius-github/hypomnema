//! `DropboxApiSyncProvider` - the `SyncProvider` implementation
//! (`sync_provider.rs`) that talks to Dropbox's HTTP API directly.
//! docs/android/ROADMAP.md Phase 1 - this is now the *only* sync backend
//! for v1 (`docs/android/SPIKES.md`'s Spike A ruled out the filesystem/SAF
//! approach: the official Dropbox Android app doesn't expose a live-synced
//! folder to other apps' file I/O at all).
//!
//! Request/response shaping and error mapping here are unit-tested against
//! a mock `DropboxTransport` - no real network access or access token
//! needed to run `cargo test`.
//!
//! **Not this module's job:** acquiring the bearer access token (OAuth2
//! PKCE, run from the Android UI - a later Phase 1 step) or refreshing it.
//! This takes an already-issued token and assumes **App folder** scoped
//! access (resolved 2026-09-08, ROADMAP.md): Dropbox roots every API path
//! at the app's own folder for that access type, so paths here are exactly
//! the plain relative names used elsewhere in this crate ("tasks.jsonl"),
//! never "/Apps/Hypomnema/tasks.jsonl".
#![allow(dead_code)]

use crate::error::{Error, Result};
use crate::sync_provider::{ChangeMarker, ChangedFile, SyncCursor, SyncProvider};
use serde_json::{json, Value};

/// Everything `DropboxApiSyncProvider` needs from an HTTP layer - kept
/// narrow and Dropbox-shaped rather than a generic HTTP client trait, so
/// both the real implementation and the test mock stay small.
pub trait DropboxTransport {
    /// POST `body` as JSON to `https://api.dropboxapi.com/2/{endpoint}`
    /// (the RPC-style endpoints: `files/list_folder`, `.../continue`).
    /// Returns the parsed JSON response.
    fn rpc(&self, endpoint: &str, body: Value) -> Result<Value>;

    /// POST to the `files/upload` content endpoint with the given
    /// `Dropbox-API-Arg` JSON and raw `contents` as the body. Returns the
    /// parsed file-metadata JSON on success. `conflict_path` is the path to
    /// report if Dropbox rejects the write as a conflict (HTTP 409) - the
    /// implementation maps that case to `Error::SyncConflict`.
    fn upload(&self, api_arg: Value, contents: &[u8], conflict_path: &str) -> Result<Value>;

    /// POST to the `files/download` content endpoint with the given
    /// `Dropbox-API-Arg` JSON. Returns the raw body bytes plus the parsed
    /// `Dropbox-API-Result` response header (file metadata).
    fn download(&self, api_arg: Value) -> Result<(Vec<u8>, Value)>;
}

pub struct DropboxApiSyncProvider<T: DropboxTransport> {
    transport: T,
}

impl<T: DropboxTransport> DropboxApiSyncProvider<T> {
    pub fn new(transport: T) -> Self {
        Self { transport }
    }
}

/// Walks `list_folder` and its `continue` pages to the end, handing every
/// raw entry to `on_entry`, and returns the cursor to resume from. Shared
/// by the `SyncProvider` view and `census` below so the paging logic has
/// exactly one implementation.
fn walk_entries<T: DropboxTransport>(
    transport: &T,
    cursor: &SyncCursor,
    mut on_entry: impl FnMut(&Value) -> Result<()>,
) -> Result<SyncCursor> {
    let mut page = match &cursor.0 {
        None => transport.rpc(
            "files/list_folder",
            // include_deleted is for sync's benefit: a device that never
            // hears about a deletion keeps resurrecting the file. The
            // link screen filters tombstones back out for display.
            json!({ "path": "", "recursive": true, "include_deleted": true }),
        )?,
        Some(c) => transport.rpc("files/list_folder/continue", json!({ "cursor": c }))?,
    };
    loop {
        let entries = page
            .get("entries")
            .and_then(Value::as_array)
            .ok_or_else(|| Error::State("list_folder response missing \"entries\"".into()))?;
        for entry in entries {
            on_entry(entry)?;
        }
        let next_cursor = page
            .get("cursor")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::State("list_folder response missing \"cursor\"".into()))?
            .to_string();
        let has_more = page
            .get("has_more")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !has_more {
            return Ok(SyncCursor(Some(next_cursor)));
        }
        page = transport.rpc(
            "files/list_folder/continue",
            json!({ "cursor": next_cursor }),
        )?;
    }
}

/// What Dropbox reports in the app folder right now, *including* the kinds
/// the sync view drops. This exists because "the list is empty" and "the
/// list is empty because everything in there is a folder or a tombstone"
/// are very different answers when a device is being set up.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct FolderCensus {
    pub files: Vec<String>,
    pub folders: usize,
    pub deleted: usize,
}

pub fn census<T: DropboxTransport>(transport: &T) -> Result<FolderCensus> {
    let mut census = FolderCensus::default();
    walk_entries(transport, &SyncCursor::default(), |entry| {
        match entry.get(".tag").and_then(Value::as_str).unwrap_or("") {
            "folder" => census.folders += 1,
            "deleted" => census.deleted += 1,
            _ => census.files.push(
                entry
                    .get("path_display")
                    .and_then(Value::as_str)
                    .unwrap_or("<no path>")
                    .trim_start_matches('/')
                    .to_string(),
            ),
        }
        Ok(())
    })?;
    Ok(census)
}

impl<T: DropboxTransport> SyncProvider for DropboxApiSyncProvider<T> {
    fn list_changes(&self, cursor: &SyncCursor) -> Result<(Vec<ChangedFile>, SyncCursor)> {
        let mut changes = Vec::new();
        let next = walk_entries(&self.transport, cursor, |entry| {
            if let Some(change) = changed_file_from_entry(entry)? {
                changes.push(change);
            }
            Ok(())
        })?;
        Ok((changes, next))
    }

    fn read_file(&self, path: &str) -> Result<(Vec<u8>, ChangeMarker)> {
        let (bytes, meta) = self.transport.download(json!({ "path": dbx_path(path) }))?;
        Ok((bytes, ChangeMarker::Rev(rev_from(&meta)?)))
    }

    fn write_file(
        &self,
        path: &str,
        contents: &[u8],
        expected_marker: Option<&ChangeMarker>,
    ) -> Result<ChangeMarker> {
        let mode = match expected_marker {
            // Dropbox's "add" mode fails outright if the path already
            // exists - exactly the "create; fail if something is already
            // there" contract `SyncProvider::write_file` documents.
            None => json!({ ".tag": "add" }),
            // "update" with a `rev` is Dropbox's real optimistic-concurrency
            // check: it 409s if the server's current rev has moved past the
            // one given, which the transport maps to `Error::SyncConflict`.
            Some(ChangeMarker::Rev(rev)) => json!({ ".tag": "update", "update": rev }),
            Some(ChangeMarker::HashMtime { .. }) => {
                return Err(Error::State(
                    "DropboxApiSyncProvider only accepts its own Rev markers, not a \
                     filesystem-backend HashMtime marker"
                        .into(),
                ))
            }
        };
        let api_arg = json!({
            "path": dbx_path(path),
            "mode": mode,
            "autorename": false,
            "mute": true,
            "strict_conflict": true,
        });
        let meta = self.transport.upload(api_arg, contents, path)?;
        Ok(ChangeMarker::Rev(rev_from(&meta)?))
    }
}

/// `path` as Dropbox wants it: rooted with a leading slash. Callers of this
/// module use plain relative names ("tasks.jsonl"); App-folder scoped
/// access means Dropbox already roots "/" at the app's own folder, so no
/// "/Apps/Hypomnema" prefix belongs here.
fn dbx_path(path: &str) -> String {
    format!("/{}", path.trim_start_matches('/'))
}

fn rev_from(meta: &Value) -> Result<String> {
    meta.get("rev")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| Error::State(format!("Dropbox response missing \"rev\": {meta}")))
}

/// `None` for entries this provider has no business reporting - see the
/// folder case below.
fn changed_file_from_entry(entry: &Value) -> Result<Option<ChangedFile>> {
    let tag = entry.get(".tag").and_then(Value::as_str).unwrap_or("");
    let path = entry
        .get("path_display")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::State(format!("list_folder entry missing path_display: {entry}")))?
        .trim_start_matches('/')
        .to_string();
    // Folders carry no `rev` (only files do), and this trait deals in
    // files - a directory is implied by the paths under it. Without this
    // skip, the first real folder in a vault (journal/, .hypomnema/)
    // fails the whole listing on a missing "rev".
    if tag == "folder" {
        return Ok(None);
    }
    if tag == "deleted" {
        // Deleted entries carry no rev - there's nothing left to compare a
        // future write's `expected_marker` against, so this placeholder is
        // never actually read back: the next write for this path after a
        // delete is necessarily a fresh create (`expected_marker: None`).
        return Ok(Some(ChangedFile {
            path,
            marker: ChangeMarker::Rev(String::new()),
            deleted: true,
        }));
    }
    Ok(Some(ChangedFile {
        path,
        marker: ChangeMarker::Rev(rev_from(entry)?),
        deleted: false,
    }))
}

/// Maps a non-2xx Dropbox response to an `Error`. A bare function (status +
/// body, not a `ureq::Response`) so it's unit-testable without a real HTTP
/// round trip - see the tests below.
fn map_error_response(status: u16, body: String, conflict_path: Option<&str>) -> Error {
    if status == 409 {
        if let Some(path) = conflict_path {
            return Error::SyncConflict {
                path: path.to_string(),
            };
        }
    }
    Error::State(format!("Dropbox API error ({status}): {body}"))
}

/// Real `DropboxTransport` backed by an HTTP round trip via `ureq`
/// (rustls-based TLS - no native OpenSSL, so this cross-compiles cleanly
/// for `aarch64-linux-android`, unlike a native-tls-backed client would).
pub struct HttpDropboxTransport {
    access_token: String,
    agent: ureq::Agent,
}

impl HttpDropboxTransport {
    pub fn new(access_token: String) -> Self {
        Self {
            access_token,
            agent: ureq::Agent::new(),
        }
    }

    fn auth_header(&self) -> String {
        format!("Bearer {}", self.access_token)
    }
}

impl DropboxTransport for HttpDropboxTransport {
    fn rpc(&self, endpoint: &str, body: Value) -> Result<Value> {
        let url = format!("https://api.dropboxapi.com/2/{endpoint}");
        let result = self
            .agent
            .post(&url)
            .set("Authorization", &self.auth_header())
            .send_json(body);
        parse_json_response(result, None)
    }

    fn upload(&self, api_arg: Value, contents: &[u8], conflict_path: &str) -> Result<Value> {
        let result = self
            .agent
            .post("https://content.dropboxapi.com/2/files/upload")
            .set("Authorization", &self.auth_header())
            .set("Dropbox-API-Arg", &api_arg.to_string())
            .set("Content-Type", "application/octet-stream")
            .send_bytes(contents);
        parse_json_response(result, Some(conflict_path))
    }

    fn download(&self, api_arg: Value) -> Result<(Vec<u8>, Value)> {
        use std::io::Read;
        let result = self
            .agent
            .post("https://content.dropboxapi.com/2/files/download")
            .set("Authorization", &self.auth_header())
            .set("Dropbox-API-Arg", &api_arg.to_string())
            .call();
        let response = match result {
            Ok(r) => r,
            Err(ureq::Error::Status(code, r)) => {
                let body = r.into_string().unwrap_or_default();
                return Err(map_error_response(code, body, None));
            }
            Err(e) => {
                return Err(Error::State(format!(
                    "Dropbox download request failed: {e}"
                )))
            }
        };
        let meta: Value = response
            .header("Dropbox-API-Result")
            .ok_or_else(|| Error::State("download response missing Dropbox-API-Result".into()))
            .and_then(|h| {
                serde_json::from_str(h)
                    .map_err(|e| Error::State(format!("bad Dropbox-API-Result header: {e}")))
            })?;
        let mut bytes = Vec::new();
        response
            .into_reader()
            .read_to_end(&mut bytes)
            .map_err(|e| Error::State(format!("reading Dropbox download body: {e}")))?;
        Ok((bytes, meta))
    }
}

fn parse_json_response(
    result: std::result::Result<ureq::Response, ureq::Error>,
    conflict_path: Option<&str>,
) -> Result<Value> {
    match result {
        Ok(response) => response
            .into_json::<Value>()
            .map_err(|e| Error::State(format!("bad Dropbox JSON response: {e}"))),
        Err(ureq::Error::Status(code, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(map_error_response(code, body, conflict_path))
        }
        Err(e) => Err(Error::State(format!("Dropbox request failed: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::VecDeque;

    type DownloadResult = Result<(Vec<u8>, Value)>;

    #[derive(Default)]
    struct MockTransport {
        rpc_responses: RefCell<VecDeque<Result<Value>>>,
        rpc_calls: RefCell<Vec<(String, Value)>>,
        upload_responses: RefCell<VecDeque<Result<Value>>>,
        upload_calls: RefCell<Vec<(Value, Vec<u8>)>>,
        download_responses: RefCell<VecDeque<DownloadResult>>,
    }

    impl MockTransport {
        fn new() -> Self {
            Self::default()
        }

        fn push_rpc(&self, response: Value) {
            self.rpc_responses.borrow_mut().push_back(Ok(response));
        }

        fn push_upload(&self, response: Result<Value>) {
            self.upload_responses.borrow_mut().push_back(response);
        }

        fn push_download(&self, bytes: &[u8], meta: Value) {
            self.download_responses
                .borrow_mut()
                .push_back(Ok((bytes.to_vec(), meta)));
        }
    }

    impl DropboxTransport for MockTransport {
        fn rpc(&self, endpoint: &str, body: Value) -> Result<Value> {
            self.rpc_calls
                .borrow_mut()
                .push((endpoint.to_string(), body));
            self.rpc_responses
                .borrow_mut()
                .pop_front()
                .expect("unexpected extra rpc() call in test")
        }

        fn upload(&self, api_arg: Value, contents: &[u8], _conflict_path: &str) -> Result<Value> {
            self.upload_calls
                .borrow_mut()
                .push((api_arg, contents.to_vec()));
            self.upload_responses
                .borrow_mut()
                .pop_front()
                .expect("unexpected extra upload() call in test")
        }

        fn download(&self, _api_arg: Value) -> Result<(Vec<u8>, Value)> {
            self.download_responses
                .borrow_mut()
                .pop_front()
                .expect("unexpected extra download() call in test")
        }
    }

    #[test]
    fn list_changes_from_scratch_calls_list_folder() {
        let transport = MockTransport::new();
        transport.push_rpc(json!({
            "entries": [
                { ".tag": "file", "path_display": "/tasks.jsonl", "rev": "abc123" }
            ],
            "cursor": "cursor-1",
            "has_more": false,
        }));
        let provider = DropboxApiSyncProvider::new(transport);
        let (changes, cursor) = provider.list_changes(&SyncCursor::default()).unwrap();

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, "tasks.jsonl");
        assert_eq!(changes[0].marker, ChangeMarker::Rev("abc123".into()));
        assert!(!changes[0].deleted);
        assert_eq!(cursor, SyncCursor(Some("cursor-1".into())));

        let calls = provider.transport.rpc_calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "files/list_folder");
    }

    #[test]
    fn list_changes_with_existing_cursor_calls_continue() {
        let transport = MockTransport::new();
        transport.push_rpc(json!({ "entries": [], "cursor": "cursor-2", "has_more": false }));
        let provider = DropboxApiSyncProvider::new(transport);
        provider
            .list_changes(&SyncCursor(Some("cursor-1".into())))
            .unwrap();

        let calls = provider.transport.rpc_calls.borrow();
        assert_eq!(calls[0].0, "files/list_folder/continue");
        assert_eq!(calls[0].1["cursor"], "cursor-1");
    }

    #[test]
    fn list_changes_drains_multiple_pages() {
        let transport = MockTransport::new();
        transport.push_rpc(json!({
            "entries": [{ ".tag": "file", "path_display": "/a.jsonl", "rev": "1" }],
            "cursor": "c1",
            "has_more": true,
        }));
        transport.push_rpc(json!({
            "entries": [{ ".tag": "file", "path_display": "/b.jsonl", "rev": "2" }],
            "cursor": "c2",
            "has_more": false,
        }));
        let provider = DropboxApiSyncProvider::new(transport);
        let (changes, cursor) = provider.list_changes(&SyncCursor::default()).unwrap();

        let mut paths: Vec<_> = changes.iter().map(|c| c.path.clone()).collect();
        paths.sort();
        assert_eq!(paths, vec!["a.jsonl", "b.jsonl"]);
        assert_eq!(cursor, SyncCursor(Some("c2".into())));
        assert_eq!(provider.transport.rpc_calls.borrow().len(), 2);
    }

    #[test]
    fn list_changes_skips_folder_entries() {
        let transport = MockTransport::new();
        // Folder entries carry no "rev"; requiring one used to fail the
        // whole listing as soon as a vault had a real directory in it.
        transport.push_rpc(json!({
            "entries": [
                { ".tag": "folder", "path_display": "/journal" },
                { ".tag": "folder", "path_display": "/.hypomnema" },
                { ".tag": "file", "path_display": "/tasks.jsonl", "rev": "abc" }
            ],
            "cursor": "c1",
            "has_more": false,
        }));
        let provider = DropboxApiSyncProvider::new(transport);
        let (changes, _) = provider.list_changes(&SyncCursor::default()).unwrap();

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, "tasks.jsonl");
    }

    #[test]
    fn list_changes_maps_deleted_entries() {
        let transport = MockTransport::new();
        transport.push_rpc(json!({
            "entries": [{ ".tag": "deleted", "path_display": "/gone.jsonl" }],
            "cursor": "c1",
            "has_more": false,
        }));
        let provider = DropboxApiSyncProvider::new(transport);
        let (changes, _) = provider.list_changes(&SyncCursor::default()).unwrap();

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, "gone.jsonl");
        assert!(changes[0].deleted);
    }

    #[test]
    fn census_counts_folders_and_tombstones_separately_from_files() {
        let transport = MockTransport::new();
        transport.push_rpc(json!({
            "entries": [
                { ".tag": "folder", "path_display": "/journal" },
                { ".tag": "file", "path_display": "/journal/2026-09-08.md", "rev": "a" },
                { ".tag": "deleted", "path_display": "/old.md" },
                { ".tag": "deleted", "path_display": "/older.md" }
            ],
            "cursor": "c1",
            "has_more": false,
        }));

        let census = census(&transport).unwrap();

        assert_eq!(census.files, vec!["journal/2026-09-08.md"]);
        assert_eq!(census.folders, 1);
        assert_eq!(census.deleted, 2);
    }

    #[test]
    fn census_of_an_empty_app_folder_is_all_zeroes() {
        let transport = MockTransport::new();
        transport.push_rpc(json!({ "entries": [], "cursor": "c1", "has_more": false }));
        assert_eq!(census(&transport).unwrap(), FolderCensus::default());
    }

    #[test]
    fn read_file_returns_bytes_and_rev_marker() {
        let transport = MockTransport::new();
        transport.push_download(b"hello", json!({ "rev": "rev-1" }));
        let provider = DropboxApiSyncProvider::new(transport);
        let (bytes, marker) = provider.read_file("tasks.jsonl").unwrap();

        assert_eq!(bytes, b"hello");
        assert_eq!(marker, ChangeMarker::Rev("rev-1".into()));
    }

    #[test]
    fn write_file_with_no_marker_uses_add_mode() {
        let transport = MockTransport::new();
        transport.push_upload(Ok(json!({ "rev": "rev-1" })));
        let provider = DropboxApiSyncProvider::new(transport);
        let marker = provider.write_file("tasks.jsonl", b"v1", None).unwrap();

        assert_eq!(marker, ChangeMarker::Rev("rev-1".into()));
        let calls = provider.transport.upload_calls.borrow();
        assert_eq!(calls[0].0["path"], "/tasks.jsonl");
        assert_eq!(calls[0].0["mode"], json!({ ".tag": "add" }));
        assert_eq!(calls[0].1, b"v1");
    }

    #[test]
    fn write_file_with_rev_marker_uses_update_mode() {
        let transport = MockTransport::new();
        transport.push_upload(Ok(json!({ "rev": "rev-2" })));
        let provider = DropboxApiSyncProvider::new(transport);
        let marker = provider
            .write_file(
                "tasks.jsonl",
                b"v2",
                Some(&ChangeMarker::Rev("rev-1".into())),
            )
            .unwrap();

        assert_eq!(marker, ChangeMarker::Rev("rev-2".into()));
        let calls = provider.transport.upload_calls.borrow();
        assert_eq!(
            calls[0].0["mode"],
            json!({ ".tag": "update", "update": "rev-1" })
        );
    }

    #[test]
    fn write_file_rejects_filesystem_marker_without_calling_transport() {
        let transport = MockTransport::new();
        let provider = DropboxApiSyncProvider::new(transport);
        let marker = ChangeMarker::HashMtime {
            hash: "abc".into(),
            mtime_unix: 0,
        };
        let err = provider
            .write_file("tasks.jsonl", b"v1", Some(&marker))
            .unwrap_err();

        assert!(matches!(err, Error::State(_)));
        assert!(provider.transport.upload_calls.borrow().is_empty());
    }

    #[test]
    fn write_file_surfaces_conflict_from_transport() {
        let transport = MockTransport::new();
        transport.push_upload(Err(Error::SyncConflict {
            path: "tasks.jsonl".into(),
        }));
        let provider = DropboxApiSyncProvider::new(transport);
        let err = provider
            .write_file(
                "tasks.jsonl",
                b"v2",
                Some(&ChangeMarker::Rev("stale-rev".into())),
            )
            .unwrap_err();

        assert!(matches!(err, Error::SyncConflict { path } if path == "tasks.jsonl"));
    }

    #[test]
    fn conflict_status_maps_to_sync_conflict_when_path_given() {
        let err = map_error_response(409, "{}".into(), Some("tasks.jsonl"));
        assert!(matches!(err, Error::SyncConflict { path } if path == "tasks.jsonl"));
    }

    #[test]
    fn conflict_status_without_path_maps_to_state_error() {
        let err = map_error_response(409, "{}".into(), None);
        assert!(matches!(err, Error::State(_)));
    }

    #[test]
    fn other_status_maps_to_state_error() {
        let err = map_error_response(500, "boom".into(), Some("tasks.jsonl"));
        assert!(matches!(err, Error::State(_)));
    }
}
