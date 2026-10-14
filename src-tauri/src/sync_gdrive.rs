//! `GdriveApiSyncProvider` - the `SyncProvider` implementation
//! (`sync_provider.rs`) that keeps the vault in Google Drive's hidden
//! `appDataFolder` (scope `drive.appdata`: the app sees only its own
//! folder, and the user's Drive UI does not show it).
//!
//! Request/response shaping and error mapping are unit-tested against a
//! mock `GdriveTransport` - no network or token needed for `cargo test`.
//! Acquiring and refreshing the access token is not this module's job.
//!
//! How a vault maps onto Drive:
//! - Every file sits flat in `appDataFolder`, and its vault-relative path
//!   **is its `name`** ("journal/2026-10-14.md"). Drive allows slashes in
//!   names, and `appProperties` is no place for a path (124 bytes per key
//!   plus value).
//! - The change marker is the file's `headRevisionId`.
//! - Drive has no "create only if absent" and no conditional update, so
//!   the guarantees `SyncProvider` documents are built here:
//!   - **Two devices creating the same path** leave two files with one
//!     name. Listings keep the earliest-created one (ties broken by id, so
//!     every device picks the same) and hand the rest out through
//!     `take_duplicates`; the sync pass merges them in and discards them.
//!   - **A stale write** is caught by reading `headRevisionId` first. The
//!     window between that read and the upload is then closed after the
//!     fact: the revision list must show the expected revision right
//!     before the new one. If someone else's revision landed in between,
//!     its bytes are re-created as a second file under the same name - a
//!     duplicate the next pass merges - so no write is lost silently.
//! - A file deleted on the other device simply stops being listed;
//!   `sync_cycle` reads "in the manifest, absent from a full listing" as
//!   that deletion, so no tombstones are needed.
#![allow(dead_code)]
// ureq's error type carries a whole Response; see sync_dropbox.rs.
#![allow(clippy::result_large_err)]

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};

use crate::error::{Error, Result};
use crate::sync_provider::{ChangeMarker, ChangedFile, Duplicate, SyncCursor, SyncProvider};

const API: &str = "https://www.googleapis.com/drive/v3";
const UPLOAD_API: &str = "https://www.googleapis.com/upload/drive/v3";
/// Drive's maximum page size for `files.list` and `revisions.list`.
const PAGE_SIZE: u32 = 1000;

/// One HTTP request, in the shape both the real transport and the test
/// mock can handle without knowing anything about Drive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub method: &'static str,
    pub url: String,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

impl Request {
    fn get(url: String) -> Self {
        Self {
            method: "GET",
            url,
            content_type: None,
            body: Vec::new(),
        }
    }

    fn delete(url: String) -> Self {
        Self {
            method: "DELETE",
            url,
            content_type: None,
            body: Vec::new(),
        }
    }
}

/// What came back: any status, 2xx or not. Interpreting it is the
/// provider's job, so a 404 can mean "already gone" in one place and a
/// failure in another.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub status: u16,
    pub body: Vec<u8>,
}

/// The HTTP layer `GdriveApiSyncProvider` needs. An `Err` is reserved for
/// "no answer at all" (network down after retries); every HTTP status,
/// including errors, comes back as a `Reply`.
pub trait GdriveTransport {
    fn send(&self, request: &Request) -> Result<Reply>;
}

/// Where one listed file lives in Drive.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Entry {
    id: String,
    rev: String,
}

pub struct GdriveApiSyncProvider<T: GdriveTransport> {
    transport: T,
    /// path -> canonical file, filled by `list_changes` and kept current
    /// by this provider's own writes, so a pass resolves ids without a
    /// lookup per file.
    entries: Mutex<HashMap<String, Entry>>,
    /// (path, file id) of the extra copies the last listing found.
    duplicates: Mutex<Vec<(String, String)>>,
    /// Whether `entries` holds a full listing, so a path missing from it
    /// is known absent without asking. A file another device creates
    /// after the listing is caught later as a duplicate.
    listed: Mutex<bool>,
}

impl<T: GdriveTransport> GdriveApiSyncProvider<T> {
    pub fn new(transport: T) -> Self {
        Self {
            transport,
            entries: Mutex::new(HashMap::new()),
            duplicates: Mutex::new(Vec::new()),
            listed: Mutex::new(false),
        }
    }

    fn send_ok(&self, request: &Request) -> Result<Reply> {
        let reply = self.transport.send(request)?;
        if (200..300).contains(&reply.status) {
            Ok(reply)
        } else {
            Err(error_from(&reply))
        }
    }

    fn send_json(&self, request: &Request) -> Result<Value> {
        let reply = self.send_ok(request)?;
        serde_json::from_slice(&reply.body)
            .map_err(|e| Error::State(format!("bad Google Drive JSON response: {e}")))
    }

    fn cached(&self, path: &str) -> Option<Entry> {
        self.entries.lock().unwrap().get(path).cloned()
    }

    /// The canonical file for `path`: from the last listing when there was
    /// one, otherwise asked for by name.
    fn find(&self, path: &str) -> Result<Option<Entry>> {
        if let Some(entry) = self.cached(path) {
            return Ok(Some(entry));
        }
        if *self.listed.lock().unwrap() {
            return Ok(None);
        }
        let query = format!(
            "name = '{}' and 'appDataFolder' in parents",
            escape_query(path)
        );
        let files = self.list_files(Some(&query))?;
        let canonical = files.into_iter().min_by(canonical_order);
        Ok(canonical.map(|f| {
            let entry = Entry {
                id: f.id,
                rev: f.rev,
            };
            self.entries
                .lock()
                .unwrap()
                .insert(path.to_string(), entry.clone());
            entry
        }))
    }

    fn list_files(&self, query: Option<&str>) -> Result<Vec<Listed>> {
        let mut files = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let mut url = format!(
                "{API}/files?spaces=appDataFolder&pageSize={PAGE_SIZE}\
                 &fields=nextPageToken,files(id,name,headRevisionId,createdTime)"
            );
            if let Some(q) = query {
                url.push_str(&format!("&q={}", percent_encode(q)));
            }
            if let Some(token) = &page_token {
                url.push_str(&format!("&pageToken={}", percent_encode(token)));
            }
            let page = self.send_json(&Request::get(url))?;
            let listed = page
                .get("files")
                .and_then(Value::as_array)
                .ok_or_else(|| Error::State("files.list response missing \"files\"".into()))?;
            for file in listed {
                files.push(Listed::from_json(file)?);
            }
            match page.get("nextPageToken").and_then(Value::as_str) {
                Some(token) => page_token = Some(token.to_string()),
                None => return Ok(files),
            }
        }
    }

    /// Current `headRevisionId` of a file, or `None` when it is gone.
    fn head_revision(&self, id: &str) -> Result<Option<String>> {
        let reply = self.transport.send(&Request::get(format!(
            "{API}/files/{id}?fields=headRevisionId"
        )))?;
        if reply.status == 404 {
            return Ok(None);
        }
        if !(200..300).contains(&reply.status) {
            return Err(error_from(&reply));
        }
        let meta: Value = serde_json::from_slice(&reply.body)
            .map_err(|e| Error::State(format!("bad Google Drive JSON response: {e}")))?;
        Ok(Some(head_revision_of(&meta)?))
    }

    fn create(&self, path: &str, contents: &[u8]) -> Result<Entry> {
        let boundary = new_boundary()?;
        let metadata = json!({ "name": path, "parents": ["appDataFolder"] });
        let meta = self.send_json(&Request {
            method: "POST",
            url: format!("{UPLOAD_API}/files?uploadType=multipart&fields=id,headRevisionId"),
            content_type: Some(format!("multipart/related; boundary={boundary}")),
            body: multipart_body(&boundary, &metadata, contents),
        })?;
        entry_of(&meta)
    }

    fn download(&self, url: String) -> Result<Vec<u8>> {
        Ok(self.send_ok(&Request::get(url))?.body)
    }

    /// Revision ids of a file, oldest first.
    fn revisions(&self, id: &str) -> Result<Vec<String>> {
        let mut ids = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let mut url = format!(
                "{API}/files/{id}/revisions?pageSize={PAGE_SIZE}\
                 &fields=nextPageToken,revisions(id)"
            );
            if let Some(token) = &page_token {
                url.push_str(&format!("&pageToken={}", percent_encode(token)));
            }
            let page = self.send_json(&Request::get(url))?;
            for revision in page
                .get("revisions")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if let Some(rev) = revision.get("id").and_then(Value::as_str) {
                    ids.push(rev.to_string());
                }
            }
            match page.get("nextPageToken").and_then(Value::as_str) {
                Some(token) => page_token = Some(token.to_string()),
                None => return Ok(ids),
            }
        }
    }

    /// The after-the-fact half of a guarded write: the revision just
    /// written must sit right on top of `expected`. If another device's
    /// revision landed in the window between the check and the upload,
    /// its bytes are put back as a duplicate of `path` for the next pass
    /// to merge, instead of being left buried in the revision history.
    fn rescue_overwritten(
        &self,
        path: &str,
        id: &str,
        expected: &str,
        written: &str,
    ) -> Result<()> {
        let revisions = self.revisions(id)?;
        let Some(position) = revisions.iter().position(|r| r == written) else {
            return Ok(());
        };
        let Some(previous) = position.checked_sub(1).map(|p| &revisions[p]) else {
            return Ok(());
        };
        if previous == expected {
            return Ok(());
        }
        let lost = self.download(format!("{API}/files/{id}/revisions/{previous}?alt=media"))?;
        self.create(path, &lost)?;
        Ok(())
    }
}

impl<T: GdriveTransport> SyncProvider for GdriveApiSyncProvider<T> {
    /// Always a full listing: Drive's change feed reports deletions by id
    /// for files this device may never have seen, and a full listing of
    /// one hidden folder is a page or two.
    fn list_changes(&self, _cursor: &SyncCursor) -> Result<(Vec<ChangedFile>, SyncCursor)> {
        let mut by_name: HashMap<String, Vec<Listed>> = HashMap::new();
        for file in self.list_files(None)? {
            by_name.entry(file.name.clone()).or_default().push(file);
        }
        let mut entries = HashMap::new();
        let mut duplicates = Vec::new();
        let mut changes = Vec::new();
        for (name, mut files) in by_name {
            files.sort_by(canonical_order);
            let mut files = files.into_iter();
            let canonical = files.next().expect("grouped from at least one file");
            duplicates.extend(files.map(|extra| (name.clone(), extra.id)));
            changes.push(ChangedFile {
                path: name.clone(),
                marker: ChangeMarker::Rev(canonical.rev.clone()),
                deleted: false,
            });
            entries.insert(
                name,
                Entry {
                    id: canonical.id,
                    rev: canonical.rev,
                },
            );
        }
        changes.sort_by(|a, b| a.path.cmp(&b.path));
        duplicates.sort();
        *self.entries.lock().unwrap() = entries;
        *self.duplicates.lock().unwrap() = duplicates;
        *self.listed.lock().unwrap() = true;
        Ok((changes, SyncCursor::default()))
    }

    fn read_file(&self, path: &str) -> Result<(Vec<u8>, ChangeMarker)> {
        let entry = self
            .find(path)?
            .ok_or_else(|| Error::State(format!("not in Google Drive: {path}")))?;
        // The marker is the one known *before* the download: if the file
        // moved on in between, a write based on it fails as a conflict,
        // which is the safe direction to be wrong in.
        let bytes = self.download(format!("{API}/files/{}?alt=media", entry.id))?;
        Ok((bytes, ChangeMarker::Rev(entry.rev)))
    }

    fn write_file(
        &self,
        path: &str,
        contents: &[u8],
        expected_marker: Option<&ChangeMarker>,
    ) -> Result<ChangeMarker> {
        let expected = match expected_marker {
            None => None,
            Some(ChangeMarker::Rev(rev)) => Some(rev.as_str()),
            Some(ChangeMarker::HashMtime { .. }) => {
                return Err(Error::State(
                    "GdriveApiSyncProvider only accepts its own Rev markers".into(),
                ))
            }
        };
        let conflict = || Error::SyncConflict {
            path: path.to_string(),
        };
        let Some(expected) = expected else {
            // Create. A file another device created since the listing
            // slips past this check; the two then meet as duplicates.
            if self.find(path)?.is_some() {
                return Err(conflict());
            }
            let entry = self.create(path, contents)?;
            let marker = ChangeMarker::Rev(entry.rev.clone());
            self.entries.lock().unwrap().insert(path.to_string(), entry);
            return Ok(marker);
        };

        let entry = self.find(path)?.ok_or_else(conflict)?;
        match self.head_revision(&entry.id)? {
            Some(head) if head == expected => {}
            _ => return Err(conflict()),
        }
        let meta = self.send_json(&Request {
            method: "PATCH",
            url: format!(
                "{UPLOAD_API}/files/{}?uploadType=media&fields=id,headRevisionId",
                entry.id
            ),
            content_type: Some("application/octet-stream".into()),
            body: contents.to_vec(),
        })?;
        let written = entry_of(&meta)?;
        self.rescue_overwritten(path, &written.id, expected, &written.rev)?;
        let marker = ChangeMarker::Rev(written.rev.clone());
        self.entries
            .lock()
            .unwrap()
            .insert(path.to_string(), written);
        Ok(marker)
    }

    fn delete_file(&self, path: &str, expected_marker: Option<&ChangeMarker>) -> Result<()> {
        let Some(entry) = self.find(path)? else {
            return Ok(());
        };
        let Some(head) = self.head_revision(&entry.id)? else {
            self.entries.lock().unwrap().remove(path);
            return Ok(());
        };
        match expected_marker {
            Some(ChangeMarker::Rev(expected)) if &head != expected => {
                return Err(Error::SyncConflict {
                    path: path.to_string(),
                })
            }
            Some(ChangeMarker::HashMtime { .. }) => {
                return Err(Error::State(
                    "GdriveApiSyncProvider only accepts its own Rev markers".into(),
                ))
            }
            _ => {}
        }
        // appDataFolder has no trash: this is final.
        let reply = self
            .transport
            .send(&Request::delete(format!("{API}/files/{}", entry.id)))?;
        if !(200..300).contains(&reply.status) && reply.status != 404 {
            return Err(error_from(&reply));
        }
        self.entries.lock().unwrap().remove(path);
        Ok(())
    }

    fn take_duplicates(&self) -> Result<Vec<Duplicate>> {
        let extras = std::mem::take(&mut *self.duplicates.lock().unwrap());
        let mut out = Vec::new();
        for (path, id) in extras {
            // One that fails to download is still there next pass.
            if let Ok(bytes) = self.download(format!("{API}/files/{id}?alt=media")) {
                out.push(Duplicate {
                    path,
                    bytes,
                    handle: id,
                });
            }
        }
        Ok(out)
    }

    fn discard_duplicate(&self, duplicate: &Duplicate) -> Result<()> {
        let reply = self.transport.send(&Request::delete(format!(
            "{API}/files/{}",
            duplicate.handle
        )))?;
        if (200..300).contains(&reply.status) || reply.status == 404 {
            Ok(())
        } else {
            Err(error_from(&reply))
        }
    }
}

/// The signed-in Google account, as Drive reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriveUser {
    pub email: String,
    pub name: String,
    /// Stable per account; names this device's sync space for it.
    pub permission_id: String,
}

/// Who the token belongs to (`about.get`; `drive.appdata` is enough).
pub fn fetch_user<T: GdriveTransport>(transport: &T) -> Result<DriveUser> {
    let reply = transport.send(&Request::get(format!(
        "{API}/about?fields=user(displayName,emailAddress,permissionId)"
    )))?;
    if !(200..300).contains(&reply.status) {
        return Err(error_from(&reply));
    }
    let about: Value = serde_json::from_slice(&reply.body)
        .map_err(|e| Error::State(format!("bad Google Drive JSON response: {e}")))?;
    let field = |key: &str| {
        about
            .pointer(&format!("/user/{key}"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let user = DriveUser {
        email: field("emailAddress"),
        name: field("displayName"),
        permission_id: field("permissionId"),
    };
    if user.permission_id.is_empty() {
        return Err(Error::State(format!(
            "Google Drive did not say which account this is: {about}"
        )));
    }
    Ok(user)
}

/// One file as `files.list` reports it.
#[derive(Debug, Clone)]
struct Listed {
    id: String,
    name: String,
    rev: String,
    created: String,
}

impl Listed {
    fn from_json(file: &Value) -> Result<Self> {
        let field = |key: &str| {
            file.get(key)
                .and_then(Value::as_str)
                .map(str::to_string)
                .ok_or_else(|| Error::State(format!("Drive file missing \"{key}\": {file}")))
        };
        Ok(Self {
            id: field("id")?,
            name: field("name")?,
            rev: field("headRevisionId")?,
            created: field("createdTime")?,
        })
    }
}

/// The order that picks the canonical copy among files sharing a name:
/// earliest `createdTime`, then smallest id. Every device lists the same
/// files, so every device picks the same one.
fn canonical_order(a: &Listed, b: &Listed) -> std::cmp::Ordering {
    (&a.created, &a.id).cmp(&(&b.created, &b.id))
}

fn head_revision_of(meta: &Value) -> Result<String> {
    meta.get("headRevisionId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| Error::State(format!("Drive response missing \"headRevisionId\": {meta}")))
}

fn entry_of(meta: &Value) -> Result<Entry> {
    let id = meta
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::State(format!("Drive response missing \"id\": {meta}")))?;
    Ok(Entry {
        id: id.to_string(),
        rev: head_revision_of(meta)?,
    })
}

/// A non-2xx reply as an `Error`, with Google's own message when the body
/// carries one.
fn error_from(reply: &Reply) -> Error {
    let message = serde_json::from_slice::<Value>(&reply.body)
        .ok()
        .and_then(|v| {
            v.pointer("/error/message")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| String::from_utf8_lossy(&reply.body).into_owned());
    match reply.status {
        401 => Error::State(format!(
            "Google sign-in expired or was revoked; sign in again ({message})"
        )),
        status => Error::State(format!("Google Drive API error ({status}): {message}")),
    }
}

/// A `q` string literal: Drive escapes `'` and `\` with a backslash.
fn escape_query(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

/// RFC 3986 percent-encoding for a query parameter value.
pub(crate) fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Random, so no file's bytes can happen to contain it.
fn new_boundary() -> Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes)
        .map_err(|e| Error::State(format!("no randomness for a multipart boundary: {e}")))?;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("hypomnema-{hex}"))
}

/// `multipart/related` body for `files.create`: JSON metadata, then the
/// bytes.
fn multipart_body(boundary: &str, metadata: &Value, contents: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(contents.len() + 256);
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n\
             --{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(contents);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

/// Attempts per request, including the first.
const MAX_ATTEMPTS: usize = 4;
/// Wait before the second attempt; tripled for each one after.
const FIRST_RETRY_DELAY: Duration = Duration::from_millis(500);

/// Is this status Google asking us to come back later? 429 and 5xx are;
/// so is a 403 whose reason is a rate limit (Drive uses both).
fn retryable(status: u16, body: &[u8]) -> bool {
    if status == 429 || (500..600).contains(&status) {
        return true;
    }
    status == 403 && {
        let text = String::from_utf8_lossy(body);
        text.contains("rateLimitExceeded") || text.contains("userRateLimitExceeded")
    }
}

/// Real `GdriveTransport` over `ureq` (rustls - no native TLS, so the
/// Android cross-compile stays clean).
pub struct HttpGdriveTransport {
    access_token: String,
    agent: ureq::Agent,
}

impl HttpGdriveTransport {
    pub fn new(access_token: String) -> Self {
        Self {
            access_token,
            agent: ureq::Agent::new(),
        }
    }

    fn attempt(&self, request: &Request) -> std::result::Result<ureq::Response, ureq::Error> {
        let mut call = self
            .agent
            .request(request.method, &request.url)
            .set("Authorization", &format!("Bearer {}", self.access_token));
        if let Some(content_type) = &request.content_type {
            call = call.set("Content-Type", content_type);
        }
        if request.body.is_empty() && request.method != "POST" && request.method != "PATCH" {
            call.call()
        } else {
            call.send_bytes(&request.body)
        }
    }
}

fn read_body(response: ureq::Response) -> Result<Vec<u8>> {
    use std::io::Read;
    let mut body = Vec::new();
    response
        .into_reader()
        .read_to_end(&mut body)
        .map_err(|e| Error::State(format!("reading Google Drive response: {e}")))?;
    Ok(body)
}

impl GdriveTransport for HttpGdriveTransport {
    fn send(&self, request: &Request) -> Result<Reply> {
        let mut delay = FIRST_RETRY_DELAY;
        let mut attempt = 1;
        loop {
            let wait = match self.attempt(request) {
                Ok(response) => {
                    let status = response.status();
                    return Ok(Reply {
                        status,
                        body: read_body(response)?,
                    });
                }
                Err(ureq::Error::Status(status, response)) => {
                    let retry_after = response
                        .header("Retry-After")
                        .and_then(|v| v.parse::<u64>().ok())
                        .map(Duration::from_secs);
                    let body = read_body(response)?;
                    if attempt >= MAX_ATTEMPTS || !retryable(status, &body) {
                        return Ok(Reply { status, body });
                    }
                    retry_after.unwrap_or(delay)
                }
                Err(e @ ureq::Error::Transport(_)) => {
                    if attempt >= MAX_ATTEMPTS {
                        return Err(Error::State(format!("Google Drive request failed: {e}")));
                    }
                    delay
                }
            };
            std::thread::sleep(wait);
            delay *= 3;
            attempt += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::VecDeque;

    /// Replies are matched to requests in order; every request is kept for
    /// the assertions.
    #[derive(Default)]
    struct MockTransport {
        replies: RefCell<VecDeque<Reply>>,
        requests: RefCell<Vec<Request>>,
    }

    impl MockTransport {
        fn reply(&self, status: u16, body: Value) {
            self.replies.borrow_mut().push_back(Reply {
                status,
                body: body.to_string().into_bytes(),
            });
        }

        fn reply_bytes(&self, bytes: &[u8]) {
            self.replies.borrow_mut().push_back(Reply {
                status: 200,
                body: bytes.to_vec(),
            });
        }

        fn requests(&self) -> Vec<Request> {
            self.requests.borrow().clone()
        }
    }

    impl GdriveTransport for MockTransport {
        fn send(&self, request: &Request) -> Result<Reply> {
            self.requests.borrow_mut().push(request.clone());
            Ok(self.replies.borrow_mut().pop_front().unwrap_or_else(|| {
                panic!("unexpected request: {} {}", request.method, request.url)
            }))
        }
    }

    fn file(id: &str, name: &str, rev: &str, created: &str) -> Value {
        json!({ "id": id, "name": name, "headRevisionId": rev, "createdTime": created })
    }

    fn provider_with_listing(files: Vec<Value>) -> GdriveApiSyncProvider<MockTransport> {
        let transport = MockTransport::default();
        transport.reply(200, json!({ "files": files }));
        let provider = GdriveApiSyncProvider::new(transport);
        provider.list_changes(&SyncCursor::default()).unwrap();
        provider
    }

    fn rev(r: &str) -> ChangeMarker {
        ChangeMarker::Rev(r.into())
    }

    #[test]
    fn listing_pages_through_and_reports_paths_by_name() {
        let transport = MockTransport::default();
        transport.reply(
            200,
            json!({ "files": [file("1", "journal/a.md", "r1", "2026-01-01T00:00:00.000Z")],
                    "nextPageToken": "p2" }),
        );
        transport.reply(
            200,
            json!({ "files": [file("2", ".hypomnema/state/tasks.jsonl", "r2", "2026-01-01T00:00:00.000Z")] }),
        );
        let provider = GdriveApiSyncProvider::new(transport);

        let (changes, _) = provider.list_changes(&SyncCursor::default()).unwrap();

        let paths: Vec<_> = changes.iter().map(|c| c.path.as_str()).collect();
        assert_eq!(paths, vec![".hypomnema/state/tasks.jsonl", "journal/a.md"]);
        assert_eq!(changes[1].marker, rev("r1"));
        assert!(changes.iter().all(|c| !c.deleted));
        let requests = provider.transport.requests();
        assert!(requests[0].url.contains("spaces=appDataFolder"));
        assert!(requests[1].url.ends_with("&pageToken=p2"));
    }

    #[test]
    fn two_files_with_one_name_keep_the_earliest_and_hand_out_the_other() {
        let provider = provider_with_listing(vec![
            file("late", "a.md", "r-late", "2026-01-02T00:00:00.000Z"),
            file("early", "a.md", "r-early", "2026-01-01T00:00:00.000Z"),
        ]);
        assert_eq!(provider.cached("a.md").unwrap().id, "early");

        provider.transport.reply_bytes(b"the late copy");
        let duplicates = provider.take_duplicates().unwrap();

        assert_eq!(
            duplicates,
            vec![Duplicate {
                path: "a.md".into(),
                bytes: b"the late copy".to_vec(),
                handle: "late".into(),
            }]
        );
        assert!(provider.transport.requests()[1]
            .url
            .ends_with("/files/late?alt=media"));
        // Handed out once; the next call has nothing until a new listing.
        assert!(provider.take_duplicates().unwrap().is_empty());
    }

    #[test]
    fn a_tie_on_created_time_is_broken_by_id_the_same_way_everywhere() {
        let provider = provider_with_listing(vec![
            file("b", "a.md", "rb", "2026-01-01T00:00:00.000Z"),
            file("a", "a.md", "ra", "2026-01-01T00:00:00.000Z"),
        ]);
        assert_eq!(provider.cached("a.md").unwrap().id, "a");
    }

    #[test]
    fn discarding_a_duplicate_deletes_that_file_and_tolerates_it_being_gone() {
        let provider = provider_with_listing(vec![]);
        provider.transport.reply(404, json!({}));
        let duplicate = Duplicate {
            path: "a.md".into(),
            bytes: vec![],
            handle: "late".into(),
        };

        provider.discard_duplicate(&duplicate).unwrap();

        let request = &provider.transport.requests()[1];
        assert_eq!(request.method, "DELETE");
        assert!(request.url.ends_with("/files/late"));
    }

    #[test]
    fn read_downloads_by_id_and_reports_the_listed_revision() {
        let provider =
            provider_with_listing(vec![file("id1", "a.md", "r1", "2026-01-01T00:00:00.000Z")]);
        provider.transport.reply_bytes(b"hello");

        let (bytes, marker) = provider.read_file("a.md").unwrap();

        assert_eq!(bytes, b"hello");
        assert_eq!(marker, rev("r1"));
        assert!(provider.transport.requests()[1]
            .url
            .ends_with("/files/id1?alt=media"));
    }

    #[test]
    fn a_path_not_in_the_listing_is_looked_up_by_an_escaped_name() {
        let transport = MockTransport::default();
        transport.reply(
            200,
            json!({ "files": [file("id9", "it's.md", "r9", "2026-01-01T00:00:00.000Z")] }),
        );
        transport.reply_bytes(b"x");
        let provider = GdriveApiSyncProvider::new(transport);

        provider.read_file("it's.md").unwrap();

        let url = &provider.transport.requests()[0].url;
        // name = 'it\'s.md', percent-encoded.
        assert!(url.contains("&q=name%20%3D%20%27it%5C%27s.md%27"), "{url}");
    }

    #[test]
    fn create_uploads_multipart_into_the_app_folder() {
        let provider = provider_with_listing(vec![]);
        provider
            .transport
            .reply(200, json!({ "id": "new", "headRevisionId": "r1" }));

        let marker = provider
            .write_file("journal/ж.md", b"body bytes", None)
            .unwrap();

        assert_eq!(marker, rev("r1"));
        // Absent from the full listing: no lookup by name before creating.
        let request = &provider.transport.requests()[1];
        assert_eq!(request.method, "POST");
        assert!(request.url.contains("uploadType=multipart"));
        let content_type = request.content_type.as_deref().unwrap();
        let boundary = content_type
            .strip_prefix("multipart/related; boundary=")
            .unwrap();
        let body = String::from_utf8(request.body.clone()).unwrap();
        assert!(body.starts_with(&format!("--{boundary}\r\n")));
        assert!(body.contains(r#""name":"journal/ж.md""#));
        assert!(body.contains(r#""parents":["appDataFolder"]"#));
        assert!(body.contains("\r\n\r\nbody bytes\r\n"));
        assert!(body.ends_with(&format!("--{boundary}--\r\n")));
        assert_eq!(provider.cached("journal/ж.md").unwrap().id, "new");
    }

    #[test]
    fn create_over_an_existing_path_conflicts() {
        let provider =
            provider_with_listing(vec![file("id1", "a.md", "r1", "2026-01-01T00:00:00.000Z")]);

        let err = provider.write_file("a.md", b"x", None).unwrap_err();

        assert!(matches!(err, Error::SyncConflict { .. }));
        assert_eq!(provider.transport.requests().len(), 1);
    }

    #[test]
    fn an_update_checks_the_head_then_uploads_then_verifies_the_history() {
        let provider =
            provider_with_listing(vec![file("id1", "a.md", "r1", "2026-01-01T00:00:00.000Z")]);
        let t = &provider.transport;
        t.reply(200, json!({ "headRevisionId": "r1" }));
        t.reply(200, json!({ "id": "id1", "headRevisionId": "r2" }));
        t.reply(
            200,
            json!({ "revisions": [{ "id": "r0" }, { "id": "r1" }, { "id": "r2" }] }),
        );

        let marker = provider
            .write_file("a.md", b"v2", Some(&rev("r1")))
            .unwrap();

        assert_eq!(marker, rev("r2"));
        let requests = provider.transport.requests();
        assert_eq!(requests.len(), 4);
        assert_eq!(requests[2].method, "PATCH");
        assert!(requests[2]
            .url
            .contains("/upload/drive/v3/files/id1?uploadType=media"));
        assert_eq!(requests[2].body, b"v2");
        assert_eq!(provider.cached("a.md").unwrap().rev, "r2");
    }

    #[test]
    fn an_update_from_a_stale_revision_conflicts_without_uploading() {
        let provider =
            provider_with_listing(vec![file("id1", "a.md", "r1", "2026-01-01T00:00:00.000Z")]);
        provider
            .transport
            .reply(200, json!({ "headRevisionId": "r5" }));

        let err = provider
            .write_file("a.md", b"v2", Some(&rev("r1")))
            .unwrap_err();

        assert!(matches!(err, Error::SyncConflict { .. }));
        assert_eq!(provider.transport.requests().len(), 2);
    }

    #[test]
    fn an_update_to_a_file_deleted_elsewhere_conflicts() {
        let provider =
            provider_with_listing(vec![file("id1", "a.md", "r1", "2026-01-01T00:00:00.000Z")]);
        provider.transport.reply(404, json!({}));

        let err = provider
            .write_file("a.md", b"v2", Some(&rev("r1")))
            .unwrap_err();

        assert!(matches!(err, Error::SyncConflict { .. }));
    }

    #[test]
    fn a_revision_slipped_in_between_check_and_upload_is_put_back_as_a_duplicate() {
        let provider =
            provider_with_listing(vec![file("id1", "a.md", "r1", "2026-01-01T00:00:00.000Z")]);
        let t = &provider.transport;
        t.reply(200, json!({ "headRevisionId": "r1" }));
        t.reply(200, json!({ "id": "id1", "headRevisionId": "r3" }));
        // r2 is the other device's write, landed inside the window.
        t.reply(
            200,
            json!({ "revisions": [{ "id": "r1" }, { "id": "r2" }, { "id": "r3" }] }),
        );
        t.reply_bytes(b"their edit");
        t.reply(200, json!({ "id": "rescued", "headRevisionId": "x1" }));

        let marker = provider
            .write_file("a.md", b"mine", Some(&rev("r1")))
            .unwrap();

        assert_eq!(marker, rev("r3"));
        let requests = provider.transport.requests();
        assert!(requests[4]
            .url
            .ends_with("/files/id1/revisions/r2?alt=media"));
        assert_eq!(requests[5].method, "POST");
        let body = String::from_utf8(requests[5].body.clone()).unwrap();
        assert!(body.contains(r#""name":"a.md""#));
        assert!(body.contains("their edit"));
        // The canonical file is still the original, not the rescued copy.
        assert_eq!(provider.cached("a.md").unwrap().id, "id1");
    }

    #[test]
    fn delete_checks_the_revision_first() {
        let provider =
            provider_with_listing(vec![file("id1", "a.md", "r1", "2026-01-01T00:00:00.000Z")]);
        provider
            .transport
            .reply(200, json!({ "headRevisionId": "r2" }));

        let err = provider.delete_file("a.md", Some(&rev("r1"))).unwrap_err();

        assert!(matches!(err, Error::SyncConflict { .. }));
        assert_eq!(provider.transport.requests().len(), 2);
    }

    #[test]
    fn delete_removes_the_file_and_forgets_it() {
        let provider =
            provider_with_listing(vec![file("id1", "a.md", "r1", "2026-01-01T00:00:00.000Z")]);
        provider
            .transport
            .reply(200, json!({ "headRevisionId": "r1" }));
        provider.transport.reply(204, json!({}));

        provider.delete_file("a.md", Some(&rev("r1"))).unwrap();

        let requests = provider.transport.requests();
        assert_eq!(requests[2].method, "DELETE");
        assert!(requests[2].url.ends_with("/files/id1"));
        assert!(provider.cached("a.md").is_none());
    }

    #[test]
    fn deleting_what_is_already_gone_is_not_an_error() {
        let provider = provider_with_listing(vec![]);

        provider.delete_file("a.md", Some(&rev("r1"))).unwrap();

        assert_eq!(provider.transport.requests().len(), 1);
    }

    #[test]
    fn errors_carry_googles_message_and_name_an_expired_sign_in() {
        let body = json!({ "error": { "code": 403, "message": "The user has not granted the app access" } });
        let err = error_from(&Reply {
            status: 403,
            body: body.to_string().into_bytes(),
        });
        assert!(err.to_string().contains("(403): The user has not granted"));

        let err = error_from(&Reply {
            status: 401,
            body: b"{}".to_vec(),
        });
        assert!(err.to_string().contains("sign in again"));
    }

    #[test]
    fn the_account_is_read_from_about() {
        let transport = MockTransport::default();
        transport.reply(
            200,
            json!({ "user": { "displayName": "A", "emailAddress": "a@x.com", "permissionId": "0712" } }),
        );

        let user = fetch_user(&transport).unwrap();

        assert_eq!(user.email, "a@x.com");
        assert_eq!(user.permission_id, "0712");
        assert!(transport.requests()[0].url.contains("/about?fields=user("));
    }

    #[test]
    fn rate_limits_are_retried_and_real_refusals_are_not() {
        assert!(retryable(429, b""));
        assert!(retryable(503, b""));
        assert!(retryable(
            403,
            br#"{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}"#
        ));
        assert!(!retryable(
            403,
            br#"{"error":{"errors":[{"reason":"insufficientPermissions"}]}}"#
        ));
        assert!(!retryable(404, b""));
    }
}
