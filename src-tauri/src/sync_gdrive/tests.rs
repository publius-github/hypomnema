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
        Ok(self
            .replies
            .borrow_mut()
            .pop_front()
            .unwrap_or_else(|| panic!("unexpected request: {} {}", request.method, request.url)))
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
    let body =
        json!({ "error": { "code": 403, "message": "The user has not granted the app access" } });
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
