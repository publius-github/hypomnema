use super::*;
use crate::db;
use crate::tasks::{list_create, task_create, task_get, task_update};

const TODAY: &str = "2026-08-29";

fn setup(tag: &str) -> (Connection, PathBuf) {
    let dir = std::env::temp_dir().join(format!("hypomnema-mirror-{tag}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let conn = Connection::open_in_memory().unwrap();
    db::migrate(&conn).unwrap();
    (conn, dir)
}

fn new_task(title: &str) -> NewTask {
    NewTask {
        title: title.into(),
        ..Default::default()
    }
}

fn opts(ids: bool, agenda: bool) -> ExportOptions {
    ExportOptions {
        ids,
        agenda,
        today_file: None,
        preserve_pending: false,
    }
}

#[test]
fn export_then_reimport_is_a_noop() {
    let (conn, dir) = setup("noop");
    let list = list_create(&conn, "Groceries", None, false).unwrap();
    let parent = task_create(
        &conn,
        &NewTask {
            list_id: Some(list.id),
            time: Some("09:30".into()),
            ..new_task("buy milk")
        },
    )
    .unwrap();
    task_create(
        &conn,
        &NewTask {
            parent_task_id: Some(parent.id),
            ..new_task("find coupon")
        },
    )
    .unwrap();
    task_create(
        &conn,
        &NewTask {
            scheduled_date: Some("2026-09-01".into()),
            ..new_task("call mom")
        },
    )
    .unwrap();

    let written = export(
        &conn,
        &dir,
        &dir.join("base"),
        &dir.join("config"),
        TODAY,
        &HashSet::new(),
        &opts(true, false),
    )
    .unwrap();
    assert_eq!(written.len(), 2); // Groceries.md + scheduled.md
    for (path, content) in &written {
        assert!(!import_file(&conn, path, content, TODAY, true, None).unwrap());
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn group_line_round_trips_and_moves_the_list() {
    let (conn, dir) = setup("group");
    let list = list_create(&conn, "Reading", None, false).unwrap();
    let group = tasks::group_create(&conn, "Personal").unwrap();
    tasks::list_set_group(&conn, list.id, Some(group.id)).unwrap();

    let written = export(
        &conn,
        &dir,
        &dir.join("base"),
        &dir.join("config"),
        TODAY,
        &HashSet::new(),
        &opts(true, false),
    )
    .unwrap();
    let (path, exported) = written
        .iter()
        .find(|(p, _)| p.file_name().unwrap() == "Reading.md")
        .unwrap();
    assert!(exported.contains("<!-- group: Personal -->"));
    // the group the file already names is not a change
    assert!(!import_file(&conn, path, exported, TODAY, true, Some(exported)).unwrap());

    // a name the vault has never seen creates the group
    let moved = exported.replace("<!-- group: Personal -->", "<!-- group: Work -->");
    assert!(import_file(&conn, path, &moved, TODAY, true, Some(exported)).unwrap());
    let groups = tasks::groups_all(&conn).unwrap();
    let work = groups.iter().find(|g| g.name == "Work").unwrap();
    let after = tasks::lists_all(&conn).unwrap();
    assert_eq!(
        after.iter().find(|l| l.id == list.id).unwrap().group_id,
        Some(work.id)
    );

    // an empty name releases the list
    let released = moved.replace("<!-- group: Work -->", "<!-- group: -->");
    assert!(import_file(&conn, path, &released, TODAY, true, Some(&moved)).unwrap());
    let after = tasks::lists_all(&conn).unwrap();
    assert_eq!(
        after.iter().find(|l| l.id == list.id).unwrap().group_id,
        None
    );

    // a file with no group line at all leaves the membership alone
    tasks::list_set_group(&conn, list.id, Some(work.id)).unwrap();
    let headerless = format!("{}\n\n- [ ] something\n", list_marker(list.id));
    import_file(&conn, path, &headerless, TODAY, true, None).unwrap();
    let after = tasks::lists_all(&conn).unwrap();
    assert_eq!(
        after.iter().find(|l| l.id == list.id).unwrap().group_id,
        Some(work.id)
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn import_applies_bulk_edits() {
    let (conn, dir) = setup("edit");
    let list = list_create(&conn, "Inbox", None, false).unwrap();
    let keep = task_create(
        &conn,
        &NewTask {
            list_id: Some(list.id),
            ..new_task("keep me")
        },
    )
    .unwrap();
    let drop_me = task_create(
        &conn,
        &NewTask {
            list_id: Some(list.id),
            ..new_task("drop me")
        },
    )
    .unwrap();

    let content = format!(
        "{}\n\n- [x] 08:00 keep me renamed ^{}\n- new one\n  - [ ] its subtask\n",
        list_marker(list.id),
        keep.id
    );
    let path = dir.join("Inbox.md");
    assert!(import_file(&conn, &path, &content, TODAY, true, None).unwrap());

    let kept = task_get(&conn, keep.id).unwrap();
    assert_eq!(kept.title, "keep me renamed");
    assert_eq!(kept.status, "done");
    assert_eq!(kept.time.as_deref(), Some("08:00"));
    // the removed line soft-deleted its task
    let parents = tasks::manual_parent_tasks(&conn).unwrap();
    assert!(!parents.iter().any(|t| t.id == drop_me.id));
    let new_one = parents.iter().find(|t| t.title == "new one").unwrap();
    assert_eq!(new_one.list_id, Some(list.id));
    let subs = tasks::subtasks_all(&conn).unwrap();
    assert!(subs
        .iter()
        .any(|s| s.parent_task_id == Some(new_one.id) && s.title == "its subtask"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn scheduled_file_moves_dates_and_deletes_in_window_only() {
    let (conn, dir) = setup("sched");
    let movable = task_create(
        &conn,
        &NewTask {
            scheduled_date: Some("2026-09-01".into()),
            ..new_task("move me")
        },
    )
    .unwrap();
    let past_done = task_create(
        &conn,
        &NewTask {
            scheduled_date: Some("2026-08-01".into()),
            ..new_task("history")
        },
    )
    .unwrap();
    task_update(
        &conn,
        past_done.id,
        &TaskPatch {
            status: Some("done".into()),
            ..Default::default()
        },
    )
    .unwrap();

    let content = format!(
        "{SCHEDULED_MARKER}\n\n## 2026-09-05\n\n- [ ] ! move me ^{}\n- [>] fresh one\n",
        movable.id
    );
    let path = dir.join("scheduled.md");
    assert!(import_file(&conn, &path, &content, TODAY, true, None).unwrap());

    let moved = task_get(&conn, movable.id).unwrap();
    assert_eq!(moved.scheduled_date.as_deref(), Some("2026-09-05"));
    assert!(moved.priority);
    let parents = tasks::manual_parent_tasks(&conn).unwrap();
    // a past-dated task is outside the file's scope: never deleted
    assert!(parents.iter().any(|t| t.id == past_done.id));
    let fresh = parents.iter().find(|t| t.title == "fresh one").unwrap();
    assert_eq!(fresh.status, "postponed");
    assert_eq!(fresh.scheduled_date.as_deref(), Some("2026-09-05"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn new_file_creates_a_list_and_malformed_lines_abort() {
    let (conn, dir) = setup("newlist");
    let path = dir.join("Reading.md");
    assert!(import_file(&conn, &path, "- [ ] some book\n", TODAY, true, None).unwrap());
    let lists = tasks::lists_all(&conn).unwrap();
    let list = lists.iter().find(|l| l.name == "Reading").unwrap();
    let parents = tasks::manual_parent_tasks(&conn).unwrap();
    assert!(parents
        .iter()
        .any(|t| t.list_id == Some(list.id) && t.title == "some book"));

    // a bad checkbox aborts the whole file: nothing gets deleted
    let bad = format!("{}\n- [?] broken\n", list_marker(list.id));
    assert!(import_file(&conn, &path, &bad, TODAY, true, None).is_err());
    assert_eq!(tasks::manual_parent_tasks(&conn).unwrap().len(), 1);
    let _ = fs::remove_dir_all(&dir);
}

/// With the sync keys off the files carry no ids at all, and a
/// round trip still has to be a no-op: every line finds its task by
/// text, so nothing is recreated and nothing is deleted.
#[test]
fn id_less_mirror_round_trips_by_title() {
    let (conn, dir) = setup("no-ids");
    let list = list_create(&conn, "Errands", None, false).unwrap();
    let parent = task_create(
        &conn,
        &NewTask {
            list_id: Some(list.id),
            ..new_task("post office")
        },
    )
    .unwrap();
    task_create(
        &conn,
        &NewTask {
            parent_task_id: Some(parent.id),
            ..new_task("stamps")
        },
    )
    .unwrap();

    let written = export(
        &conn,
        &dir,
        &dir.join("base"),
        &dir.join("config"),
        TODAY,
        &HashSet::new(),
        &opts(false, false),
    )
    .unwrap();
    let (path, content) = written
        .iter()
        .find(|(p, _)| p.file_name().unwrap() == "Errands.md")
        .unwrap();
    assert!(!content.contains(&format!("^{}", parent.id)));
    assert!(!import_file(&conn, path, content, TODAY, false, None).unwrap());
    assert_eq!(tasks::manual_parent_tasks(&conn).unwrap().len(), 1);
    assert_eq!(tasks::subtasks_all(&conn).unwrap().len(), 1);

    // ticking the box off the file still reaches the same task
    let edited = content.replace("- [ ] post office", "- [x] post office");
    assert!(import_file(&conn, path, &edited, TODAY, false, None).unwrap());
    assert_eq!(task_get(&conn, parent.id).unwrap().status, "done");
    let _ = fs::remove_dir_all(&dir);
}

/// [z] is what postponed tasks are written as now; [>] from older
/// versions still parses, so an un-rewritten file keeps working.
#[test]
fn postponed_reads_both_markers_and_writes_z() {
    let (conn, dir) = setup("postponed");
    let list = list_create(&conn, "Later", None, false).unwrap();
    let path = dir.join("Later.md");
    let content = format!("{}\n- [>] old marker\n", list_marker(list.id));
    assert!(import_file(&conn, &path, &content, TODAY, true, None).unwrap());
    let parents = tasks::manual_parent_tasks(&conn).unwrap();
    assert_eq!(parents[0].status, "postponed");

    let written = export(
        &conn,
        &dir,
        &dir.join("base"),
        &dir.join("config"),
        TODAY,
        &HashSet::new(),
        &opts(true, false),
    )
    .unwrap();
    let (_, out) = written
        .iter()
        .find(|(p, _)| p.file_name().unwrap() == "Later.md")
        .unwrap();
    assert!(out.contains("- [z] old marker"));
    assert!(!out.contains("- [>]"));
    let _ = fs::remove_dir_all(&dir);
}

/// waiting and dropped round-trip through their two-letter markers
#[test]
fn waiting_and_dropped_markers_round_trip() {
    let (conn, dir) = setup("waiting-dropped");
    let list = list_create(&conn, "Waits", None, false).unwrap();
    let path = dir.join("Waits.md");
    let content = format!(
        "{}\n- [xz] asked the landlord\n- [ZZ] old idea\n",
        list_marker(list.id)
    );
    assert!(import_file(&conn, &path, &content, TODAY, true, None).unwrap());
    let parents = tasks::manual_parent_tasks(&conn).unwrap();
    let status_of = |title: &str| {
        parents
            .iter()
            .find(|t| t.title == title)
            .map(|t| t.status.clone())
    };
    assert_eq!(status_of("asked the landlord").as_deref(), Some("waiting"));
    assert_eq!(status_of("old idea").as_deref(), Some("dropped"));

    let written = export(
        &conn,
        &dir,
        &dir.join("base"),
        &dir.join("config"),
        TODAY,
        &HashSet::new(),
        &opts(true, false),
    )
    .unwrap();
    let (_, out) = written
        .iter()
        .find(|(p, _)| p.file_name().unwrap() == "Waits.md")
        .unwrap();
    assert!(out.contains("- [xz] asked the landlord"));
    assert!(out.contains("- [zz] old idea"));
    let _ = fs::remove_dir_all(&dir);
}

fn make_generated(conn: &Connection, title: &str, date: &str) -> i64 {
    conn.execute(
        "INSERT INTO tasks (title, created_at, origin, rule_key, period_key,
                                scheduled_date, cadence)
             VALUES (?1, '2026-01-01T00:00:00Z', 'recurring', ?2, ?3, ?4, 'daily')",
        (title, format!("rk-{title}"), date, date),
    )
    .unwrap();
    conn.last_insert_rowid()
}

#[test]
fn agenda_mirrors_generated_and_syncs_status_only() {
    let (conn, dir) = setup("agenda");
    let base_dir = dir.join("base");
    let gen_id = make_generated(&conn, "morning routine", "2026-08-30");

    let written = export(
        &conn,
        &dir,
        &base_dir,
        &dir.join("config"),
        TODAY,
        &HashSet::new(),
        &opts(true, true),
    )
    .unwrap();
    let (path, content) = written
        .iter()
        .find(|(p, _)| p.file_name().unwrap() == "agenda.md")
        .unwrap();
    assert!(content.contains("## 2026-08-30"));
    assert!(content.contains(&format!("- [ ] morning routine ^{gen_id}")));
    // base copy follows the export
    assert!(base_dir.join("agenda.md").exists());

    // check the box, rename the title, and quick-add a manual line
    let edited = content
        .replace(
            &format!("- [ ] morning routine ^{gen_id}"),
            &format!("- [x] renamed by phone ^{gen_id}\n- [ ] buy milk"),
        )
        .to_string();
    assert!(import_file(&conn, path, &edited, TODAY, true, Some(content)).unwrap());
    let gen = task_get(&conn, gen_id).unwrap();
    assert_eq!(gen.status, "done", "status syncs back");
    assert_eq!(gen.title, "morning routine", "title edits do not sync");
    let manual = tasks::manual_parent_tasks(&conn).unwrap();
    let added = manual.iter().find(|t| t.title == "buy milk").unwrap();
    assert_eq!(added.scheduled_date.as_deref(), Some("2026-08-30"));

    // wiping the agenda deletes nothing
    let wiped = format!("{AGENDA_MARKER}\n");
    assert!(!import_file(&conn, path, &wiped, TODAY, true, Some(content)).unwrap());
    assert!(task_get(&conn, gen_id).is_ok());
    assert_eq!(tasks::manual_parent_tasks(&conn).unwrap().len(), 1);

    // turning the agenda off cleans the file up
    export(
        &conn,
        &dir,
        &base_dir,
        &dir.join("config"),
        TODAY,
        &HashSet::new(),
        &opts(true, false),
    )
    .unwrap();
    assert!(!dir.join("agenda.md").exists());
    assert!(!base_dir.join("agenda.md").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn base_merge_keeps_app_side_edits_over_unchanged_lines() {
    let (conn, dir) = setup("base-fields");
    let list = list_create(&conn, "Inbox", None, false).unwrap();
    let a = task_create(
        &conn,
        &NewTask {
            list_id: Some(list.id),
            ..new_task("alpha")
        },
    )
    .unwrap();
    let b = task_create(
        &conn,
        &NewTask {
            list_id: Some(list.id),
            ..new_task("beta")
        },
    )
    .unwrap();
    let base = format!(
        "{}\n\n- [ ] alpha ^{}\n- [ ] beta ^{}\n",
        list_marker(list.id),
        a.id,
        b.id
    );
    // app-side: alpha got done AFTER the base was written
    task_update(
        &conn,
        a.id,
        &TaskPatch {
            status: Some("done".into()),
            ..Default::default()
        },
    )
    .unwrap();
    // the file ticks beta but still shows alpha open (stale view)
    let file = format!(
        "{}\n\n- [ ] alpha ^{}\n- [x] beta ^{}\n",
        list_marker(list.id),
        a.id,
        b.id
    );
    let path = dir.join("Inbox.md");
    assert!(import_file(&conn, &path, &file, TODAY, true, Some(&base)).unwrap());
    assert_eq!(
        task_get(&conn, a.id).unwrap().status,
        "done",
        "unchanged line must not roll back the app-side edit"
    );
    assert_eq!(task_get(&conn, b.id).unwrap().status, "done");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn base_merge_deletes_only_what_the_base_knew() {
    let (conn, dir) = setup("base-del");
    let list = list_create(&conn, "Inbox", None, false).unwrap();
    let old = task_create(
        &conn,
        &NewTask {
            list_id: Some(list.id),
            ..new_task("old task")
        },
    )
    .unwrap();
    let fresh = task_create(
        &conn,
        &NewTask {
            list_id: Some(list.id),
            ..new_task("created after the base")
        },
    )
    .unwrap();
    // the base knows only the old task; the file removed its line
    let base = format!("{}\n\n- [ ] old task ^{}\n", list_marker(list.id), old.id);
    let file = format!("{}\n", list_marker(list.id));
    let path = dir.join("Inbox.md");
    assert!(import_file(&conn, &path, &file, TODAY, true, Some(&base)).unwrap());
    let parents = tasks::manual_parent_tasks(&conn).unwrap();
    assert!(
        !parents.iter().any(|t| t.id == old.id),
        "a line removed by the user deletes its task"
    );
    assert!(
        parents.iter().any(|t| t.id == fresh.id),
        "a task the file never saw survives"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn base_merge_does_not_resurrect_a_deleted_task() {
    let (conn, dir) = setup("base-resurrect");
    let list = list_create(&conn, "Inbox", None, false).unwrap();
    let gone = task_create(
        &conn,
        &NewTask {
            list_id: Some(list.id),
            ..new_task("deleted in app")
        },
    )
    .unwrap();
    let base = format!(
        "{}\n\n- [ ] deleted in app ^{}\n",
        list_marker(list.id),
        gone.id
    );
    crate::tasks::task_delete(&conn, gone.id).unwrap();
    // a stale file still carries the identical line
    let path = dir.join("Inbox.md");
    assert!(!import_file(&conn, &path, &base, TODAY, true, Some(&base)).unwrap());
    assert!(tasks::manual_parent_tasks(&conn).unwrap().is_empty());

    // but a line the user actually edited becomes a new task
    let edited = base.replace("- [ ] deleted in app", "- [ ] deleted in app, take two");
    assert!(import_file(&conn, &path, &edited, TODAY, true, Some(&base)).unwrap());
    let parents = tasks::manual_parent_tasks(&conn).unwrap();
    assert_eq!(parents.len(), 1);
    assert_eq!(parents[0].title, "deleted in app, take two");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn conflicted_copy_of_a_managed_file_is_rejected() {
    let (conn, dir) = setup("conflict-copy");
    let content = format!("{SCHEDULED_MARKER}\n\n## 2026-09-01\n\n- [ ] duplicated\n");
    let copy = dir.join("scheduled (conflicted copy).md");
    let err = import_file(&conn, &copy, &content, TODAY, true, None).unwrap_err();
    assert!(err.to_string().contains("conflict copy"), "{err}");
    assert!(tasks::manual_parent_tasks(&conn).unwrap().is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn export_sweep_keeps_a_file_whose_import_failed() {
    let (conn, dir) = setup("sweep-skip");
    let content = format!("{SCHEDULED_MARKER}\n\n## 2026-09-01\n\n- [ ] duplicated\n");
    let copy = dir.join("scheduled (conflicted copy).md");
    fs::write(&copy, &content).unwrap();
    assert!(import_file(&conn, &copy, &content, TODAY, true, None).is_err());
    let failed: HashSet<PathBuf> = [copy.clone()].into_iter().collect();
    export(
        &conn,
        &dir,
        &dir.join("base"),
        &dir.join("config"),
        TODAY,
        &failed,
        &opts(true, false),
    )
    .unwrap();
    // the lines only present in the copy would be gone with it
    assert!(copy.exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn export_leaves_an_unimported_outside_edit_alone() {
    let (conn, dir) = setup("pending-edit");
    let list = list_create(&conn, "Inbox", None, false).unwrap();
    let preserve = ExportOptions {
        preserve_pending: true,
        ..opts(true, false)
    };
    let run_export = |skip: &HashSet<PathBuf>, o: &ExportOptions| {
        export(
            &conn,
            &dir,
            &dir.join("base"),
            &dir.join("config"),
            TODAY,
            skip,
            o,
        )
        .unwrap()
    };
    run_export(&HashSet::new(), &preserve);
    let file = dir.join("Inbox.md");
    let edited = format!(
        "{}- [ ] typed outside\n",
        fs::read_to_string(&file).unwrap()
    );
    fs::write(&file, &edited).unwrap();
    // an app-side change exports again: the outside line must survive
    tasks::task_create(
        &conn,
        &tasks::NewTask {
            title: "from the app".into(),
            list_id: Some(list.id),
            ..Default::default()
        },
    )
    .unwrap();
    run_export(&HashSet::new(), &preserve);
    assert_eq!(fs::read_to_string(&file).unwrap(), edited);
    // the watcher path (having imported the disk) does rewrite it
    run_export(&HashSet::new(), &opts(true, false));
    assert!(fs::read_to_string(&file).unwrap().contains("from the app"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn ids_off_a_trailing_caret_number_is_title_text() {
    let (conn, dir) = setup("ids-off-caret");
    let list = list_create(&conn, "Inbox", None, false).unwrap();
    let victim = tasks::task_create(
        &conn,
        &tasks::NewTask {
            title: "untouched".into(),
            list_id: Some(list.id),
            ..Default::default()
        },
    )
    .unwrap();
    let path = dir.join("Inbox.md");
    let content = format!(
        "{}\n\n- [ ] review PR ^{}\n- [ ] untouched\n",
        list_marker(list.id),
        victim.id
    );
    assert!(import_file(&conn, &path, &content, TODAY, false, None).unwrap());
    let mut titles: Vec<String> = tasks::manual_parent_tasks(&conn)
        .unwrap()
        .into_iter()
        .map(|t| t.title)
        .collect();
    titles.sort();
    assert_eq!(
        titles,
        vec![format!("review PR ^{}", victim.id), "untouched".to_string()]
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn export_removes_files_of_archived_lists_and_keeps_foreign_md() {
    let (conn, dir) = setup("stale");
    let list = list_create(&conn, "Temp", None, false).unwrap();
    export(
        &conn,
        &dir,
        &dir.join("base"),
        &dir.join("config"),
        TODAY,
        &HashSet::new(),
        &opts(true, false),
    )
    .unwrap();
    assert!(dir.join("Temp.md").exists());
    fs::write(dir.join("notes.md"), "my own file\n").unwrap();

    tasks::list_archive(&conn, list.id).unwrap();
    export(
        &conn,
        &dir,
        &dir.join("base"),
        &dir.join("config"),
        TODAY,
        &HashSet::new(),
        &opts(true, false),
    )
    .unwrap();
    assert!(!dir.join("Temp.md").exists());
    assert!(dir.join("notes.md").exists());
    assert!(dir.join("scheduled.md").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn today_file_exports_a_read_only_day_sheet() {
    let (conn, dir) = setup("today");
    let list = list_create(&conn, "Work", None, false).unwrap();
    task_create(
        &conn,
        &NewTask {
            scheduled_date: Some(TODAY.into()),
            time: Some("09:00".into()),
            list_id: Some(list.id),
            ..new_task("standup")
        },
    )
    .unwrap();
    task_create(
        &conn,
        &NewTask {
            scheduled_date: Some("2026-08-30".into()),
            ..new_task("{Health} run")
        },
    )
    .unwrap();

    let written = export(
        &conn,
        &dir,
        &dir.join("base"),
        &dir.join("config"),
        TODAY,
        &HashSet::new(),
        &ExportOptions {
            ids: true,
            agenda: false,
            today_file: Some(2),
            preserve_pending: false,
        },
    )
    .unwrap();
    let (_, content) = written
        .iter()
        .find(|(p, _)| p.file_name().unwrap() == "today.md")
        .unwrap();
    assert!(content.starts_with(TODAY_MARKER));
    assert!(content.contains("## Today"));
    assert!(content.contains("### Work"));
    assert!(content.contains("- [ ] 09:00 standup"));
    // the extra day gets its own dated section; the category comes
    // from the {X} prefix and the prefix leaves the line itself
    assert!(content.contains("2026-08-30"));
    assert!(content.contains("### Health"));
    assert!(content.contains("- [ ] run"));
    // read-only: no sync keys, no merge-base copy
    assert!(!content.contains('^'));
    assert!(!dir.join("base").join("today.md").exists());

    // nothing in it syncs back, even a checked-off line
    let edited = content.replace("- [ ] 09:00 standup", "- [x] 09:00 standup");
    let applied = import_file(&conn, &dir.join("today.md"), &edited, TODAY, true, None).unwrap();
    assert!(!applied);
    let parents = tasks::manual_parent_tasks(&conn).unwrap();
    assert!(parents.iter().all(|t| t.status == "todo"));

    // turning the flag off sweeps the file away like other managed files
    export(
        &conn,
        &dir,
        &dir.join("base"),
        &dir.join("config"),
        TODAY,
        &HashSet::new(),
        &opts(true, false),
    )
    .unwrap();
    assert!(!dir.join("today.md").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_markerless_today_file_is_left_alone() {
    let (conn, dir) = setup("today-markerless");
    fs::write(dir.join("today.md"), "my own notes\n").unwrap();
    export(
        &conn,
        &dir,
        &dir.join("base"),
        &dir.join("config"),
        TODAY,
        &HashSet::new(),
        &opts(true, false),
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(dir.join("today.md")).unwrap(),
        "my own notes\n"
    );
    let _ = fs::remove_dir_all(&dir);
}
