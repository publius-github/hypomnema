use super::*;
use crate::sync_provider::mock::MockProvider;

const NOW: &str = "2026-09-08T12:00:00Z";

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("hypomnema-cycle-{name}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn root() -> VaultRoot {
    VaultRoot("vault/".into())
}

fn write(root_dir: &Path, relative: &str, contents: &str) {
    let path = root_dir.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

fn read(root_dir: &Path, relative: &str) -> String {
    fs::read_to_string(root_dir.join(relative)).unwrap()
}

/// A device that has synced once: the file is on disk, on the server,
/// and recorded in the manifest as agreed.
fn in_sync(provider: &MockProvider, local: &Path, relative: &str, contents: &str) {
    let remote = root().absolute(relative);
    let marker = provider
        .write_file(&remote, contents.as_bytes(), None)
        .unwrap();
    write(local, relative, contents);
    let ChangeMarker::Rev(rev) = marker else {
        unreachable!()
    };
    let mut manifest = load_manifest(local);
    manifest.insert(
        remote,
        FileState {
            rev,
            hash: Some(content_hash(contents.as_bytes())),
        },
    );
    save_manifest(local, &manifest).unwrap();
    if keeps_base(relative) {
        write_base(local, relative, contents.as_bytes()).unwrap();
    }
}

const PHONE: DeviceTag<'static> = DeviceTag {
    id: "phone",
    label: "phone",
};

fn sync(provider: &MockProvider, local: &Path) -> SyncReport {
    sync_vault(provider, local, &root(), PHONE, NOW, 30, |_, _| {}).unwrap()
}

#[test]
fn a_quiet_vault_makes_no_changes_at_all() {
    let local = temp_dir("quiet");
    let provider = MockProvider::new();
    in_sync(&provider, &local, "journal/a.md", "unchanged");

    let report = sync(&provider, &local);

    assert_eq!(report, SyncReport::default());
}

#[test]
fn a_note_written_on_the_other_device_arrives() {
    let local = temp_dir("incoming");
    let provider = MockProvider::new();
    provider
        .write_file("vault/journal/new.md", b"from the desktop", None)
        .unwrap();

    let report = sync(&provider, &local);

    assert_eq!(report.downloaded, 1);
    assert_eq!(read(&local, "journal/new.md"), "from the desktop");
}

#[test]
fn a_note_edited_only_here_goes_up_untouched() {
    let local = temp_dir("outgoing");
    let provider = MockProvider::new();
    in_sync(&provider, &local, "journal/a.md", "before");
    write(&local, "journal/a.md", "after");

    let report = sync(&provider, &local);

    assert_eq!(report.uploaded, 1);
    assert_eq!(report.merged, 0);
    assert_eq!(
        provider.read_file("vault/journal/a.md").unwrap().0,
        b"after"
    );
}

#[test]
fn a_note_edited_only_there_comes_down_over_the_local_copy() {
    let local = temp_dir("incoming-edit");
    let provider = MockProvider::new();
    in_sync(&provider, &local, "journal/a.md", "before");
    let (_, marker) = provider.read_file("vault/journal/a.md").unwrap();
    provider
        .write_file("vault/journal/a.md", b"their edit", Some(&marker))
        .unwrap();

    let report = sync(&provider, &local);

    assert_eq!(report.downloaded, 1);
    assert_eq!(report.uploaded, 0);
    assert_eq!(read(&local, "journal/a.md"), "their edit");
}

/// A file that is there but cannot be read right now (locked by another
/// app, a cloud placeholder offline) may hold edits: the pass reports it
/// as failed instead of taking it for missing and writing the other side
/// over it, and the next pass tries again.
#[cfg(unix)]
#[test]
fn an_unreadable_local_file_is_not_overwritten_as_if_it_were_missing() {
    use std::os::unix::fs::PermissionsExt;
    let local = temp_dir("unreadable");
    let provider = MockProvider::new();
    in_sync(&provider, &local, "journal/a.md", "before");
    write(&local, "journal/a.md", "my edit");
    let (_, marker) = provider.read_file("vault/journal/a.md").unwrap();
    provider
        .write_file("vault/journal/a.md", b"their edit", Some(&marker))
        .unwrap();
    let path = local.join("journal/a.md");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
    if fs::read(&path).is_ok() {
        // running as root: permissions cannot make the file unreadable
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        return;
    }

    let report = sync(&provider, &local);

    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(report.failed, vec!["vault/journal/a.md".to_string()]);
    assert_eq!(report.downloaded, 0);
    assert_eq!(read(&local, "journal/a.md"), "my edit");
}

#[test]
fn a_journal_entry_written_on_both_devices_keeps_both_versions() {
    let local = temp_dir("prose-conflict");
    let provider = MockProvider::new();
    in_sync(&provider, &local, "journal/a.md", "shared start");
    let (_, marker) = provider.read_file("vault/journal/a.md").unwrap();
    provider
        .write_file("vault/journal/a.md", b"their afternoon", Some(&marker))
        .unwrap();
    write(&local, "journal/a.md", "my afternoon");

    let report = sync(&provider, &local);

    assert_eq!(report.merged, 1);
    // Theirs is at the real path; mine is beside it, named after this
    // device - nothing was overwritten and nothing was invented.
    assert_eq!(read(&local, "journal/a.md"), "their afternoon");
    let copy = "journal/a (conflicted copy phone 2026-09-08).md";
    assert_eq!(read(&local, copy), "my afternoon");
    assert_eq!(report.conflicted_copies, vec![copy.to_string()]);
    // And the kept-aside copy travels, so the other device sees it too.
    assert_eq!(
        provider.read_file(&root().absolute(copy)).unwrap().0,
        b"my afternoon"
    );
    assert_eq!(sync_conflicts::load(&local).len(), 1);
}

#[test]
fn a_seeded_sample_config_gives_way_to_the_other_devices_rules() {
    let local = temp_dir("sample-config");
    let provider = MockProvider::new();
    let path = ".hypomnema/config/birthdays.yml";
    let (_, sample) = vault::CONFIG_SAMPLES
        .iter()
        .find(|(name, _)| *name == "birthdays.yml")
        .unwrap();
    write(&local, path, sample);
    let real = "birthdays:\n  - name: Ann\n    date: \"03-14\"\n";
    provider
        .write_file(&root().absolute(path), real.as_bytes(), None)
        .unwrap();

    let report = sync(&provider, &local);

    assert_eq!(read(&local, path), real);
    assert!(report.conflicted_copies.is_empty());
    assert!(sync_conflicts::load(&local).is_empty());
}

#[test]
fn edits_to_different_lines_on_both_devices_merge_without_a_copy() {
    let local = temp_dir("prose-merge");
    let provider = MockProvider::new();
    in_sync(
        &provider,
        &local,
        "journal/a.md",
        "morning\n\nnoon\n\nevening\n",
    );
    let (_, marker) = provider.read_file("vault/journal/a.md").unwrap();
    provider
        .write_file(
            "vault/journal/a.md",
            b"morning, on the phone\n\nnoon\n\nevening\n",
            Some(&marker),
        )
        .unwrap();
    write(
        &local,
        "journal/a.md",
        "morning\n\nnoon\n\nevening, at the desk\n",
    );

    let report = sync(&provider, &local);

    let merged = "morning, on the phone\n\nnoon\n\nevening, at the desk\n";
    assert_eq!(report.merged, 1);
    assert!(report.conflicted_copies.is_empty());
    assert_eq!(read(&local, "journal/a.md"), merged);
    assert_eq!(
        provider.read_file("vault/journal/a.md").unwrap().0,
        merged.as_bytes()
    );
    assert!(sync_conflicts::load(&local).is_empty());
    // and the next pass has nothing left to do
    assert_eq!(sync(&provider, &local), SyncReport::default());
}

#[test]
fn a_file_synced_before_bases_were_kept_still_merges() {
    let local = temp_dir("prose-seeded-base");
    let provider = MockProvider::new();
    in_sync(&provider, &local, "notes/n.md", "one\n\ntwo\n");
    forget_base(&local, "notes/n.md");
    // a quiet pass records the agreed version as the base
    sync(&provider, &local);
    let (_, marker) = provider.read_file("vault/notes/n.md").unwrap();
    provider
        .write_file("vault/notes/n.md", b"one!\n\ntwo\n", Some(&marker))
        .unwrap();
    write(&local, "notes/n.md", "one\n\ntwo!\n");

    let report = sync(&provider, &local);

    assert!(report.conflicted_copies.is_empty());
    assert_eq!(read(&local, "notes/n.md"), "one!\n\ntwo!\n");
}

#[test]
fn a_second_clash_on_one_day_does_not_overwrite_the_first_copy() {
    let local = temp_dir("copy-twice");
    let provider = MockProvider::new();
    in_sync(&provider, &local, "journal/a.md", "start");
    write(
        &local,
        "journal/a (conflicted copy phone 2026-09-08).md",
        "first",
    );
    let (_, marker) = provider.read_file("vault/journal/a.md").unwrap();
    provider
        .write_file("vault/journal/a.md", b"theirs", Some(&marker))
        .unwrap();
    write(&local, "journal/a.md", "mine");

    let report = sync(&provider, &local);

    let copy = "journal/a (conflicted copy phone 2 2026-09-08).md";
    assert_eq!(report.conflicted_copies, vec![copy.to_string()]);
    assert_eq!(read(&local, copy), "mine");
    assert_eq!(
        read(&local, "journal/a (conflicted copy phone 2026-09-08).md"),
        "first"
    );
    let shown = sync_conflicts::for_display(&local, "phone");
    assert_eq!(shown[0].copy.as_deref(), Some(copy));
    assert!(shown[0].open);
    assert_eq!(shown[0].discarded_by, "this device");
}

#[test]
fn a_task_added_on_each_device_survives_the_pass() {
    let local = temp_dir("state-merge");
    let provider = MockProvider::new();
    let path = ".hypomnema/state/tasks.jsonl";
    let base = "{\"id\":1,\"title\":\"shared\",\"updated_at\":\"t0\",\"updated_by\":\"d\"}\n";
    in_sync(&provider, &local, path, base);

    let mine = format!(
        "{base}{{\"id\":2,\"title\":\"mine\",\"updated_at\":\"t1\",\"updated_by\":\"phone\"}}\n"
    );
    write(&local, path, &mine);
    let theirs = format!(
        "{base}{{\"id\":3,\"title\":\"theirs\",\"updated_at\":\"t1\",\"updated_by\":\"desk\"}}\n"
    );
    let (_, marker) = provider.read_file(&root().absolute(path)).unwrap();
    provider
        .write_file(&root().absolute(path), theirs.as_bytes(), Some(&marker))
        .unwrap();

    let report = sync(&provider, &local);

    assert_eq!(report.merged, 1);
    assert!(report.state_changed);
    let merged = read(&local, path);
    assert!(merged.contains("\"mine\""));
    assert!(merged.contains("\"theirs\""));
    assert!(merged.contains("\"shared\""));
    // The merge went up in the same pass, so the other device sees it
    // on its next one rather than a pass later.
    assert_eq!(report.uploaded, 1);
    let uploaded = provider.read_file(&root().absolute(path)).unwrap().0;
    assert_eq!(String::from_utf8(uploaded).unwrap(), merged);
    // And the agreed base moved with it, so the next merge compares
    // against what was actually shared.
    assert_eq!(read_base(&local, path).unwrap(), merged);
}

#[test]
fn a_note_deleted_here_is_deleted_on_the_other_device_too() {
    let local = temp_dir("delete-here");
    let provider = MockProvider::new();
    in_sync(&provider, &local, "journal/gone.md", "text");
    fs::remove_file(local.join("journal/gone.md")).unwrap();

    let report = sync(&provider, &local);

    assert_eq!(report.removed_remotely, 1);
    assert!(provider.read_file("vault/journal/gone.md").is_err());
}

#[test]
fn a_note_this_device_never_pulled_is_not_treated_as_a_deletion() {
    // The case that kept deletion propagation out of the push until
    // now: a file absent locally because a pull failed halfway must
    // not be read as "the user deleted this".
    let local = temp_dir("never-pulled");
    let provider = MockProvider::new();
    provider
        .write_file("vault/journal/theirs.md", b"never fetched here", None)
        .unwrap();
    // Simulate an interrupted pull: nothing local, nothing recorded.
    let report = sync(&provider, &local);

    assert_eq!(report.removed_remotely, 0);
    assert_eq!(report.downloaded, 1);
}

#[test]
fn a_note_deleted_here_but_edited_there_is_kept() {
    let local = temp_dir("delete-vs-edit");
    let provider = MockProvider::new();
    in_sync(&provider, &local, "journal/a.md", "before");
    let (_, marker) = provider.read_file("vault/journal/a.md").unwrap();
    provider
        .write_file("vault/journal/a.md", b"their edit", Some(&marker))
        .unwrap();
    fs::remove_file(local.join("journal/a.md")).unwrap();

    let report = sync(&provider, &local);

    assert_eq!(report.removed_remotely, 0);
    // Their edit is on the server and now on this device as well: an
    // edit outranks a deletion, same call the record merge makes.
    assert_eq!(
        provider.read_file("vault/journal/a.md").unwrap().0,
        b"their edit"
    );
    assert_eq!(read(&local, "journal/a.md"), "their edit");
}

#[test]
fn a_note_deleted_there_and_untouched_here_goes_away_locally() {
    let local = temp_dir("delete-there");
    let provider = MockProvider::new();
    in_sync(&provider, &local, "journal/a.md", "text");
    let (_, marker) = provider.read_file("vault/journal/a.md").unwrap();
    provider
        .delete_file("vault/journal/a.md", Some(&marker))
        .unwrap();

    let report = sync(&provider, &local);

    assert_eq!(report.removed_locally, 1);
    assert!(!local.join("journal/a.md").exists());
    // the remote keeps no copy: this one is the last, in the trash
    let trashed: Vec<_> = fs::read_dir(local.join(sync_paths::TRASH_DIR))
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(trashed.len(), 1);
    assert!(trashed[0].ends_with("-journal__a.md"), "{trashed:?}");
    assert_eq!(
        fs::read_to_string(local.join(sync_paths::TRASH_DIR).join(&trashed[0])).unwrap(),
        "text"
    );
}

#[test]
fn a_snapshot_from_a_newer_build_stops_the_pass_before_anything_changes() {
    let local = temp_dir("state-newer");
    let provider = MockProvider::new();
    let path = ".hypomnema/state/lists.jsonl";
    let base = "{\"id\":1,\"name\":\"Shop\",\"updated_at\":\"t0\",\"updated_by\":\"d\"}\n";
    in_sync(&provider, &local, path, base);
    let (_, marker) = provider.read_file(&root().absolute(path)).unwrap();
    provider
        .write_file(
            &root().absolute(path),
            b"{\"id\":1,\"name\":\"Shop\",\"shelf\":2,\"updated_at\":\"t1\",\"updated_by\":\"desk\"}\n",
            Some(&marker),
        )
        .unwrap();
    provider
        .write_file("vault/journal/new.md", b"from the desktop", None)
        .unwrap();

    let err = sync_vault(&provider, &local, &root(), PHONE, NOW, 30, |_, _| {})
        .unwrap_err()
        .to_string();

    assert!(err.contains("newer version"), "{err}");
    assert_eq!(read(&local, path), base);
    assert!(!local.join("journal/new.md").exists());
}

#[test]
fn a_snapshot_whose_rebuild_failed_merges_again_instead_of_overwriting() {
    let local = temp_dir("state-forget");
    let provider = MockProvider::new();
    let path = ".hypomnema/state/tasks.jsonl";
    let theirs = "{\"id\":1,\"title\":\"a\",\"updated_at\":\"t0\",\"updated_by\":\"d\"}\n\
                  {\"id\":2,\"title\":\"theirs\",\"updated_at\":\"t1\",\"updated_by\":\"desk\"}\n";
    in_sync(&provider, &local, path, theirs);
    // the old database's export, which lacks the merged-in row
    write(
        &local,
        path,
        "{\"id\":1,\"title\":\"a\",\"updated_at\":\"t0\",\"updated_by\":\"d\"}\n",
    );

    forget_state_agreement(&local, &root()).unwrap();
    sync(&provider, &local);

    let uploaded = provider.read_file(&root().absolute(path)).unwrap().0;
    assert!(String::from_utf8(uploaded).unwrap().contains("\"theirs\""));
    assert!(read(&local, path).contains("\"theirs\""));
}

#[test]
fn a_note_that_simply_stops_being_listed_counts_as_deleted_there() {
    let local = temp_dir("delete-no-tombstone");
    let provider = MockProvider::new();
    in_sync(&provider, &local, "journal/a.md", "text");
    provider.vanish("vault/journal/a.md");

    let report = sync(&provider, &local);

    assert_eq!(report.removed_locally, 1);
    assert!(!local.join("journal/a.md").exists());
    assert_eq!(report.uploaded, 0);
}

#[test]
fn a_task_file_created_twice_at_once_is_merged_and_the_copy_discarded() {
    let local = temp_dir("duplicate-state");
    let provider = MockProvider::new();
    let path = ".hypomnema/state/tasks.jsonl";
    let one = "{\"id\":1,\"title\":\"one\",\"updated_at\":\"t1\",\"updated_by\":\"desk\"}\n";
    let two = "{\"id\":2,\"title\":\"two\",\"updated_at\":\"t1\",\"updated_by\":\"phone\"}\n";
    provider
        .write_file(&root().absolute(path), one.as_bytes(), None)
        .unwrap();
    provider.add_duplicate(&root().absolute(path), two.as_bytes());

    let report = sync(&provider, &local);

    let merged = read(&local, path);
    assert!(merged.contains("\"one\""));
    assert!(merged.contains("\"two\""));
    assert!(report.state_changed);
    assert_eq!(report.uploaded, 1);
    let uploaded = provider.read_file(&root().absolute(path)).unwrap().0;
    assert_eq!(String::from_utf8(uploaded).unwrap(), merged);
    assert_eq!(provider.discarded.lock().unwrap().len(), 1);
}

#[test]
fn a_note_created_twice_at_once_keeps_the_other_as_a_conflicted_copy() {
    let local = temp_dir("duplicate-prose");
    let provider = MockProvider::new();
    provider
        .write_file("vault/journal/a.md", b"first", None)
        .unwrap();
    provider.add_duplicate("vault/journal/a.md", b"second");

    let report = sync(&provider, &local);

    assert_eq!(read(&local, "journal/a.md"), "first");
    let copy = "journal/a (conflicted copy duplicate 2026-09-08).md";
    assert_eq!(read(&local, copy), "second");
    assert_eq!(report.conflicted_copies, vec![copy.to_string()]);
    assert_eq!(provider.discarded.lock().unwrap().len(), 1);
    // The copy goes up as a file of its own.
    assert_eq!(
        provider.read_file(&root().absolute(copy)).unwrap().0,
        b"second"
    );
}

#[test]
fn an_identical_duplicate_is_just_discarded() {
    let local = temp_dir("duplicate-same");
    let provider = MockProvider::new();
    provider
        .write_file("vault/journal/a.md", b"same", None)
        .unwrap();
    provider.add_duplicate("vault/journal/a.md", b"same");

    let report = sync(&provider, &local);

    assert!(report.conflicted_copies.is_empty());
    assert_eq!(report.merged, 0);
    assert_eq!(provider.discarded.lock().unwrap().len(), 1);
}

#[test]
fn a_duplicate_with_nothing_local_to_merge_into_is_kept_for_later() {
    let local = temp_dir("duplicate-unreadable");
    let provider = MockProvider::new();
    provider
        .write_file("vault/journal/a.md", b"first", None)
        .unwrap();
    provider.make_unreadable("vault/journal/a.md");
    provider.add_duplicate("vault/journal/a.md", b"second");

    let report = sync(&provider, &local);

    assert_eq!(report.failed, vec!["vault/journal/a.md".to_string()]);
    assert!(provider.discarded.lock().unwrap().is_empty());
}

#[test]
fn a_note_deleted_there_but_edited_here_survives_and_is_re_uploaded() {
    let local = temp_dir("delete-there-edit-here");
    let provider = MockProvider::new();
    in_sync(&provider, &local, "journal/a.md", "text");
    let (_, marker) = provider.read_file("vault/journal/a.md").unwrap();
    provider
        .delete_file("vault/journal/a.md", Some(&marker))
        .unwrap();
    write(&local, "journal/a.md", "my edit after their delete");

    let report = sync(&provider, &local);

    assert_eq!(report.removed_locally, 0);
    assert_eq!(report.uploaded, 1);
    assert_eq!(
        provider.read_file("vault/journal/a.md").unwrap().0,
        b"my edit after their delete"
    );
    assert_eq!(sync_conflicts::load(&local).len(), 1);
}

#[test]
fn the_database_is_never_uploaded_or_downloaded() {
    let local = temp_dir("no-db");
    let provider = MockProvider::new();
    write(&local, ".hypomnema/app.db", "sqlite");
    provider
        .write_file("vault/.hypomnema/app.db", b"theirs", None)
        .unwrap();

    let report = sync(&provider, &local);

    assert_eq!(report.uploaded, 0);
    assert_eq!(report.downloaded, 0);
    assert_eq!(
        fs::read_to_string(local.join(".hypomnema/app.db")).unwrap(),
        "sqlite"
    );
}

#[test]
fn what_is_waiting_to_go_up_is_answerable_with_no_network() {
    let local = temp_dir("standing");
    let provider = MockProvider::new();
    in_sync(&provider, &local, "journal/a.md", "sent");
    in_sync(&provider, &local, "journal/b.md", "sent");
    assert_eq!(standing(&local, &root()).unwrap().pending, 0);

    // Three kinds of pending change, none of which needs a request
    // to notice: an edit, a new file, and a deletion.
    write(&local, "journal/a.md", "edited offline");
    write(&local, "journal/c.md", "written offline");
    fs::remove_file(local.join("journal/b.md")).unwrap();

    assert_eq!(standing(&local, &root()).unwrap().pending, 3);

    sync(&provider, &local);
    assert_eq!(standing(&local, &root()).unwrap().pending, 0);
}

#[test]
fn what_is_waiting_honours_this_vaults_sync_ignore_before_any_pass() {
    let local = temp_dir("standing-ignore");
    write(&local, ".hypomnemasyncignore", "drafts/\n");
    write(&local, "drafts/one.md", "kept on this device");
    write(&local, "drafts/two.md", "kept on this device");
    write(&local, "journal/a.md", "to send");

    // no pass has loaded this vault's patterns: the file is the authority
    let pending = standing(&local, &root()).unwrap().pending;

    // journal/a.md and the ignore file itself, which is synced
    assert_eq!(pending, 2);
}

#[test]
fn an_ignored_file_is_neither_uploaded_nor_downloaded() {
    let local = temp_dir("ignore-pass");
    let provider = MockProvider::new();
    write(&local, ".hypomnemasyncignore", "drafts/\n");
    write(&local, "drafts/mine.md", "stays on this device");
    provider
        .write_file("vault/drafts/theirs.md", b"stays over there", None)
        .unwrap();

    sync(&provider, &local);

    assert!(provider.read_file("vault/drafts/mine.md").is_err());
    assert!(!local.join("drafts/theirs.md").exists());
    assert!(provider.read_file("vault/.hypomnemasyncignore").is_ok());
}

/// A folder put under the ignore file after it synced is missing from
/// the pass's listing because the pass skips it - which must not read as
/// the remote having lost most of the vault.
#[test]
fn ignoring_a_synced_folder_is_not_mistaken_for_a_wiped_remote() {
    let local = temp_dir("ignore-synced-folder");
    let provider = MockProvider::new();
    for i in 0..12 {
        in_sync(&provider, &local, &format!("journal/{i}.md"), "text");
    }
    in_sync(&provider, &local, "notes/a.md", "kept");
    write(&local, ".hypomnemasyncignore", "journal/\n");

    let report = sync_vault(&provider, &local, &root(), PHONE, NOW, 30, |_, _| {}).unwrap();

    assert_eq!(report.removed_locally, 0);
    assert_eq!(report.removed_remotely, 0);
    for i in 0..12 {
        assert!(provider.read_file(&format!("vault/journal/{i}.md")).is_ok());
        assert!(local.join(format!("journal/{i}.md")).exists());
    }
}

#[test]
fn a_file_ignored_after_it_synced_is_not_left_waiting_to_go_up() {
    let local = temp_dir("ignore-synced-file");
    let provider = MockProvider::new();
    for i in 0..12 {
        in_sync(&provider, &local, &format!("notes/{i}.md"), "text");
    }
    in_sync(&provider, &local, "private.md", "mine");
    write(&local, ".hypomnemasyncignore", "private.md\n");

    sync(&provider, &local);

    assert_eq!(standing(&local, &root()).unwrap().pending, 0);
    assert!(provider.read_file("vault/private.md").is_ok());
    assert!(local.join("private.md").exists());
}

#[test]
fn a_failed_pass_is_remembered_so_the_screen_can_say_so() {
    let local = temp_dir("last-pass");
    fs::create_dir_all(local.join(".hypomnema/sync")).unwrap();
    record_pass(&local, NOW, Some("no network".into()));

    let standing = standing(&local, &root()).unwrap();

    assert_eq!(standing.last_pass_at.as_deref(), Some(NOW));
    assert_eq!(standing.last_error.as_deref(), Some("no network"));
}

#[test]
fn conflicted_copies_are_named_after_the_device_and_the_day() {
    assert_eq!(
        conflicted_copy_path("journal/2026-09-08.md", "phone", "2026-09-08"),
        "journal/2026-09-08 (conflicted copy phone 2026-09-08).md"
    );
    assert_eq!(
        conflicted_copy_path("Inbox", "phone", "2026-09-08"),
        "Inbox (conflicted copy phone 2026-09-08)"
    );
    // A dotfile is all extension: it must not become
    // " (conflicted copy ...).hypomnemaignore" with an empty name.
    assert_eq!(
        conflicted_copy_path(".hypomnemaignore", "phone", "2026-09-08"),
        ".hypomnemaignore (conflicted copy phone 2026-09-08)"
    );
}

#[test]
fn a_wiped_remote_stops_the_pass_before_anything_is_deleted_here() {
    let local = temp_dir("guard-wiped");
    let provider = MockProvider::new();
    for i in 0..12 {
        in_sync(&provider, &local, &format!("journal/{i}.md"), "text");
    }
    for i in 0..12 {
        let path = format!("vault/journal/{i}.md");
        let (_, marker) = provider.read_file(&path).unwrap();
        provider.delete_file(&path, Some(&marker)).unwrap();
    }

    let err = sync_vault(&provider, &local, &root(), PHONE, NOW, 30, |_, _| {}).unwrap_err();

    assert!(matches!(
        err,
        Error::RemoteWiped {
            known: 12,
            gone: 12
        }
    ));
    for i in 0..12 {
        assert!(local.join(format!("journal/{i}.md")).exists());
    }
    assert_eq!(load_manifest(&local).len(), 12);
}

#[test]
fn deleting_a_few_files_out_of_many_passes_the_guard() {
    let local = temp_dir("guard-few");
    let provider = MockProvider::new();
    for i in 0..12 {
        in_sync(&provider, &local, &format!("journal/{i}.md"), "text");
    }
    for i in 0..3 {
        let path = format!("vault/journal/{i}.md");
        let (_, marker) = provider.read_file(&path).unwrap();
        provider.delete_file(&path, Some(&marker)).unwrap();
    }

    let report = sync(&provider, &local);

    assert_eq!(report.removed_locally, 3);
}

#[test]
fn a_guard_of_100_percent_lets_even_a_full_wipe_through() {
    let local = temp_dir("guard-off");
    let provider = MockProvider::new();
    for i in 0..12 {
        in_sync(&provider, &local, &format!("journal/{i}.md"), "text");
    }
    for i in 0..12 {
        let path = format!("vault/journal/{i}.md");
        let (_, marker) = provider.read_file(&path).unwrap();
        provider.delete_file(&path, Some(&marker)).unwrap();
    }

    let report = sync_vault(&provider, &local, &root(), PHONE, NOW, 100, |_, _| {}).unwrap();

    assert_eq!(report.removed_locally, 12);
}
