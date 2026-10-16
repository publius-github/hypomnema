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

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};

use crate::error::{Error, Result};
use crate::state::LockOrRecover;
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
        self.entries.lock_or_recover().get(path).cloned()
    }

    /// The canonical file for `path`: from the last listing when there was
    /// one, otherwise asked for by name.
    fn find(&self, path: &str) -> Result<Option<Entry>> {
        if let Some(entry) = self.cached(path) {
            return Ok(Some(entry));
        }
        if *self.listed.lock_or_recover() {
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
                .lock_or_recover()
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
        *self.entries.lock_or_recover() = entries;
        *self.duplicates.lock_or_recover() = duplicates;
        *self.listed.lock_or_recover() = true;
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
            self.entries
                .lock_or_recover()
                .insert(path.to_string(), entry);
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
            .lock_or_recover()
            .insert(path.to_string(), written);
        Ok(marker)
    }

    fn delete_file(&self, path: &str, expected_marker: Option<&ChangeMarker>) -> Result<()> {
        let Some(entry) = self.find(path)? else {
            return Ok(());
        };
        let Some(head) = self.head_revision(&entry.id)? else {
            self.entries.lock_or_recover().remove(path);
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
        self.entries.lock_or_recover().remove(path);
        Ok(())
    }

    fn take_duplicates(&self) -> Result<Vec<Duplicate>> {
        let extras = std::mem::take(&mut *self.duplicates.lock_or_recover());
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
        401 => Error::SignInExpired(format!(
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
/// The longest a `Retry-After` is honoured: a pass holds `engine_lock`
/// while it waits, so the server does not get to park it for an hour.
const MAX_RETRY_WAIT: Duration = Duration::from_secs(60);

/// Bounds on each phase of one HTTP call. ureq waits forever by default,
/// and a connection that dies silently (a laptop put to sleep mid-pass, a
/// Wi-Fi switch) would then block its read for good - with `engine_lock`
/// held, so no engine pass, export or later sync would run until restart.
/// DNS + TCP + TLS handshake.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// Sending the request line and headers, then waiting for the response
/// headers (Drive answers an upload only once it has stored it).
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(120);
/// Sending or receiving a whole body - a total, not an idle timeout, so
/// generous enough for a large note attachment over a slow link.
const BODY_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// How long to sleep before the next attempt: the server's `Retry-After`
/// when it sent one, else our own backoff, never more than `MAX_RETRY_WAIT`.
fn retry_wait(retry_after: Option<u64>, backoff: Duration) -> Duration {
    retry_after
        .map(Duration::from_secs)
        .unwrap_or(backoff)
        .min(MAX_RETRY_WAIT)
}

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

/// Real `GdriveTransport` over `ureq` (rustls with the bundled
/// webpki roots - no native TLS, so the Android cross-compile stays
/// clean).
pub struct HttpGdriveTransport {
    access_token: String,
    agent: ureq::Agent,
}

impl HttpGdriveTransport {
    pub fn new(access_token: String) -> Self {
        Self {
            access_token,
            agent: http_agent(),
        }
    }

    /// The reply, plus how long the server asked to wait (`Retry-After`).
    fn attempt(&self, request: &Request) -> std::result::Result<(Reply, Option<u64>), ureq::Error> {
        let mut builder = ureq::http::Request::builder()
            .method(request.method)
            .uri(&request.url)
            .header("Authorization", format!("Bearer {}", self.access_token));
        if let Some(content_type) = &request.content_type {
            builder = builder.header("Content-Type", content_type);
        }
        let response =
            if request.body.is_empty() && request.method != "POST" && request.method != "PATCH" {
                self.agent.run(builder.body(())?)?
            } else {
                self.agent.run(builder.body(request.body.clone())?)?
            };
        read_reply(response)
    }
}

/// An agent that hands every HTTP status back as a response: the
/// callers read Drive's and Google's error bodies themselves.
pub(crate) fn http_agent() -> ureq::Agent {
    agent_with_timeouts(CONNECT_TIMEOUT, RESPONSE_TIMEOUT, BODY_TIMEOUT)
}

fn agent_with_timeouts(connect: Duration, response: Duration, body: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_resolve(Some(connect))
        .timeout_connect(Some(connect))
        .timeout_send_request(Some(response))
        .timeout_recv_response(Some(response))
        .timeout_send_body(Some(body))
        .timeout_recv_body(Some(body))
        .build()
        .new_agent()
}

/// The whole body, however large: a vault file is not capped at the
/// client's default read limit.
pub(crate) fn read_body(
    mut response: ureq::http::Response<ureq::Body>,
) -> std::result::Result<Vec<u8>, ureq::Error> {
    response
        .body_mut()
        .with_config()
        .limit(u64::MAX)
        .read_to_vec()
}

fn read_reply(
    response: ureq::http::Response<ureq::Body>,
) -> std::result::Result<(Reply, Option<u64>), ureq::Error> {
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get("Retry-After")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    let body = read_body(response)?;
    Ok((Reply { status, body }, retry_after))
}

impl GdriveTransport for HttpGdriveTransport {
    fn send(&self, request: &Request) -> Result<Reply> {
        let mut delay = FIRST_RETRY_DELAY;
        let mut attempt = 1;
        loop {
            let wait = match self.attempt(request) {
                Ok((reply, retry_after)) => {
                    if attempt >= MAX_ATTEMPTS || !retryable(reply.status, &reply.body) {
                        return Ok(reply);
                    }
                    retry_wait(retry_after, delay)
                }
                Err(e) => {
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
mod tests;
