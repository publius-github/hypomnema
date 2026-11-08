use super::*;
use crate::db;

fn conn() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    db::migrate(&conn).unwrap();
    conn
}

#[test]
fn backlinks_match_wiki_links_only_in_title_and_description() {
    let conn = conn();
    task_create(
        &conn,
        &NewTask {
            title: "review [[Alpha Project]]".into(),
            ..Default::default()
        },
    )
    .unwrap();
    task_create(
        &conn,
        &NewTask {
            title: "notes".into(),
            description_md: "see [[alpha project.MD]] for details".into(),
            ..Default::default()
        },
    )
    .unwrap();
    // a plain mention is not a task backlink - titles are short
    // imperative strings, substring matches would be noise
    task_create(
        &conn,
        &NewTask {
            title: "alpha project standup".into(),
            ..Default::default()
        },
    )
    .unwrap();

    let hits = backlinks(&conn, "Alpha Project", "Alpha Project.md").unwrap();
    assert_eq!(hits.len(), 2);
    assert!(hits.iter().all(|h| h.preview.contains("[[")));

    let none = backlinks(&conn, "Beta", "Beta.md").unwrap();
    assert!(none.is_empty());
}

#[test]
fn ensure_inbox_creates_a_manual_favorite_once() {
    let conn = conn();
    let inbox = ensure_inbox(&conn, "Inbox").unwrap();
    assert!(!inbox.auto);
    assert!(inbox.favorite);

    // idempotent: the same list comes back, nothing new is created
    let again = ensure_inbox(&conn, "Inbox").unwrap();
    assert_eq!(again.id, inbox.id);
    assert_eq!(lists_all(&conn).unwrap().len(), 1);
}

#[test]
fn ensure_inbox_matches_case_insensitively_and_falls_back_on_empty() {
    let conn = conn();
    let inbox = ensure_inbox(&conn, "  ").unwrap();
    assert_eq!(inbox.name, "Inbox");
    let same = ensure_inbox(&conn, "inbox").unwrap();
    assert_eq!(same.id, inbox.id);
}

#[test]
fn ensure_inbox_promotes_an_auto_namesake() {
    let conn = conn();
    let auto = list_ensure(&conn, "Inbox").unwrap();
    assert!(auto.auto);
    let inbox = ensure_inbox(&conn, "Inbox").unwrap();
    assert_eq!(inbox.id, auto.id);
    assert!(!inbox.auto);
    assert!(inbox.favorite);
}

#[test]
fn ensure_inbox_adopts_an_existing_manual_list_untouched() {
    let conn = conn();
    let manual = list_create(&conn, "Inbox", None, false).unwrap();
    assert!(!manual.favorite);
    let inbox = ensure_inbox(&conn, "Inbox").unwrap();
    assert_eq!(inbox.id, manual.id);
    // adopting must not force the favorite flag onto a user's list
    assert!(!inbox.favorite);
}

#[test]
fn create_keeps_category_prefix_and_never_routes_to_a_list() {
    let conn = conn();
    let task = task_create(
        &conn,
        &NewTask {
            title: "{05 Finance} pay bills".into(),
            ..Default::default()
        },
    )
    .unwrap();
    // the prefix is a text category label, not a list route
    assert_eq!(task.title, "{05 Finance} pay bills");
    assert_eq!(task.list_id, None);
    assert!(lists_all(&conn).unwrap().is_empty());

    // an explicit target list is the only way in at creation
    let target = list_create(&conn, "Inbox", None, false).unwrap();
    let direct = task_create(
        &conn,
        &NewTask {
            title: "{05 Finance} categorized".into(),
            list_id: Some(target.id),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(direct.list_id, Some(target.id));
    assert_eq!(direct.title, "{05 Finance} categorized");
}

#[test]
fn rename_over_an_archived_namesake_is_allowed() {
    let conn = conn();
    let old = list_create(&conn, "Work", None, false).unwrap();
    list_archive(&conn, old.id).unwrap();
    let current = list_create(&conn, "Stuff", None, false).unwrap();
    list_rename(&conn, current.id, "Work").unwrap();
    let names: Vec<String> = lists_all(&conn)
        .unwrap()
        .into_iter()
        .map(|l| l.name)
        .collect();
    assert!(names.contains(&"Work".to_string()));
    // the archived one keeps its name and stays archived
    assert_eq!(lists_archived(&conn).unwrap().len(), 1);
}

#[test]
fn rename_onto_a_live_list_reports_the_clash() {
    let conn = conn();
    list_create(&conn, "Work", None, false).unwrap();
    let other = list_create(&conn, "Stuff", None, false).unwrap();
    let err = list_rename(&conn, other.id, "Work").unwrap_err();
    assert!(err.to_string().contains("already exists"), "{err}");
}

#[test]
fn rename_absorbs_an_auto_list_of_the_same_name() {
    let conn = conn();
    let auto = list_ensure(&conn, "Work").unwrap();
    assert!(auto.auto);
    let task = task_create(
        &conn,
        &NewTask {
            title: "generated".into(),
            list_id: Some(auto.id),
            ..Default::default()
        },
    )
    .unwrap();
    let mine = list_create(&conn, "Stuff", None, false).unwrap();
    list_rename(&conn, mine.id, "Work").unwrap();
    let lists = lists_all(&conn).unwrap();
    assert_eq!(lists.len(), 1, "the auto list folded into the renamed one");
    assert_eq!(task_get(&conn, task.id).unwrap().list_id, Some(mine.id));
    // and the engine keeps generating into the user's list now
    assert_eq!(list_ensure(&conn, "Work").unwrap().id, mine.id);
}

#[test]
fn creating_a_list_adopts_the_auto_list_of_that_name() {
    let conn = conn();
    let auto = list_ensure(&conn, "Work").unwrap();
    let created = list_create(&conn, "Work", None, false).unwrap();
    assert_eq!(created.id, auto.id);
    assert!(!created.auto);
}

#[test]
fn restoring_a_list_whose_name_was_taken_reports_the_clash() {
    let conn = conn();
    let old = list_create(&conn, "Work", None, false).unwrap();
    list_archive(&conn, old.id).unwrap();
    list_create(&conn, "Work", None, false).unwrap();
    let err = list_unarchive(&conn, old.id).unwrap_err();
    assert!(err.to_string().contains("rename it"), "{err}");
}

#[test]
fn priority_allowed_on_generated_tasks() {
    let conn = conn();
    conn.execute(
        "INSERT INTO tasks (title, created_at, origin, rule_key, period_key)
             VALUES ('gen', '2026-01-01T00:00:00Z', 'recurring', 'abc', '2026-08-28T06:00')",
        [],
    )
    .unwrap();
    let id = conn.last_insert_rowid();
    let starred = task_update(
        &conn,
        id,
        &TaskPatch {
            priority: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(starred.priority);
    let cleared = task_update(
        &conn,
        id,
        &TaskPatch {
            priority: Some(false),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(!cleared.priority);
}

#[test]
fn priority_flag_toggles_via_patch() {
    let conn = conn();
    let task = task_create(
        &conn,
        &NewTask {
            title: "p".into(),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(!task.priority);
    let starred = task_update(
        &conn,
        task.id,
        &TaskPatch {
            priority: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(starred.priority);
}

#[test]
fn create_and_snapshot_within_window() {
    let conn = conn();
    let in_window = task_create(
        &conn,
        &NewTask {
            title: "in window".into(),
            scheduled_date: Some("2026-08-28".into()),
            ..Default::default()
        },
    )
    .unwrap();
    task_create(
        &conn,
        &NewTask {
            title: "outside".into(),
            scheduled_date: Some("2026-10-01".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let unscheduled = task_create(
        &conn,
        &NewTask {
            title: "backlog".into(),
            ..Default::default()
        },
    )
    .unwrap();

    let snapshot = tasks_snapshot(&conn, "2026-08-28", "2026-09-04").unwrap();
    let ids: Vec<i64> = snapshot.iter().map(|t| t.id).collect();
    assert!(ids.contains(&in_window.id));
    assert!(ids.contains(&unscheduled.id));
    assert_eq!(ids.len(), 2);
}

#[test]
fn list_reorder_rewrites_sort_order_within_the_list_only() {
    let conn = conn();
    let list = list_create(&conn, "Inbox", None, false).unwrap();
    let other = list_create(&conn, "Other", None, false).unwrap();
    let make = |list_id: i64, title: &str| {
        task_create(
            &conn,
            &NewTask {
                title: title.into(),
                list_id: Some(list_id),
                ..Default::default()
            },
        )
        .unwrap()
    };
    let a = make(list.id, "a");
    let b = make(list.id, "b");
    let c = make(list.id, "c");
    let foreign = make(other.id, "x");

    // move c to the front; the foreign id in the payload is ignored
    list_reorder(&conn, list.id, &[c.id, a.id, b.id, foreign.id]).unwrap();
    let order: Vec<(i64, i64)> = {
        let mut stmt = conn
            .prepare("SELECT id, sort_order FROM tasks WHERE list_id = ?1 ORDER BY sort_order")
            .unwrap();
        let rows = stmt
            .query_map([list.id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        rows.collect::<rusqlite::Result<_>>().unwrap()
    };
    assert_eq!(order, vec![(c.id, 0), (a.id, 1), (b.id, 2)]);
    assert_eq!(task_get(&conn, foreign.id).unwrap().sort_order, 0);
}

#[test]
fn manual_list_tasks_stay_in_snapshot_regardless_of_date() {
    let conn = conn();
    let list = list_create(&conn, "Trips", None, false).unwrap();
    let task = task_create(
        &conn,
        &NewTask {
            title: "book flights".into(),
            list_id: Some(list.id),
            scheduled_date: Some("2027-05-01".into()),
            ..Default::default()
        },
    )
    .unwrap();
    // the date is far outside the grid window, but the task still
    // belongs to its list column
    let snapshot = tasks_snapshot(&conn, "2026-08-28", "2026-09-04").unwrap();
    assert!(snapshot.iter().any(|t| t.id == task.id));
}

#[test]
fn subtasks_always_included_and_cascade_on_delete() {
    let conn = conn();
    let parent = task_create(
        &conn,
        &NewTask {
            title: "parent".into(),
            scheduled_date: Some("2026-08-28".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let sub = task_create(
        &conn,
        &NewTask {
            title: "sub".into(),
            parent_task_id: Some(parent.id),
            ..Default::default()
        },
    )
    .unwrap();

    let snapshot = tasks_snapshot(&conn, "2026-08-28", "2026-08-29").unwrap();
    assert!(snapshot.iter().any(|t| t.id == sub.id));

    // delete is hard and cascades: the pair is gone from the table
    task_delete(&conn, parent.id).unwrap();
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 0);
}

#[test]
fn restore_brings_back_parent_and_subtask_with_original_ids() {
    let conn = conn();
    let list = list_create(&conn, "Inbox", None, false).unwrap();
    let parent = task_create(
        &conn,
        &NewTask {
            title: "parent".into(),
            list_id: Some(list.id),
            scheduled_date: Some("2026-09-07".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let sub = task_create(
        &conn,
        &NewTask {
            title: "sub".into(),
            parent_task_id: Some(parent.id),
            ..Default::default()
        },
    )
    .unwrap();
    let deleted = task_delete(&conn, parent.id).unwrap();
    assert_eq!(deleted.tasks.len(), 2);

    let restored = task_restore(&conn, &deleted).unwrap();
    assert_eq!(restored.len(), 2);
    let back = task_get(&conn, parent.id).unwrap();
    assert_eq!(back.title, "parent");
    assert_eq!(back.list_id, Some(list.id));
    let sub_back = task_get(&conn, sub.id).unwrap();
    assert_eq!(sub_back.parent_task_id, Some(parent.id));
}

#[test]
fn restore_remaps_ids_when_the_original_is_taken() {
    let conn = conn();
    let parent = task_create(
        &conn,
        &NewTask {
            title: "parent".into(),
            ..Default::default()
        },
    )
    .unwrap();
    task_create(
        &conn,
        &NewTask {
            title: "sub".into(),
            parent_task_id: Some(parent.id),
            ..Default::default()
        },
    )
    .unwrap();
    let deleted = task_delete(&conn, parent.id).unwrap();
    // both freed ids get taken by other rows before the undo (a
    // merge bringing in another device's rows, say)
    let sub_id = deleted.tasks.iter().find(|t| t.title == "sub").unwrap().id;
    for (id, title) in [(parent.id, "usurper"), (sub_id, "usurper 2")] {
        conn.execute(
            "INSERT INTO tasks (id, title, created_at) VALUES (?1, ?2, '2026-01-01T00:00:00Z')",
            (id, title),
        )
        .unwrap();
    }
    let usurper = task_get(&conn, parent.id).unwrap();

    let restored = task_restore(&conn, &deleted).unwrap();
    assert_eq!(restored.len(), 2);
    let new_parent = restored.iter().find(|t| t.title == "parent").unwrap();
    let new_sub = restored.iter().find(|t| t.title == "sub").unwrap();
    assert_ne!(new_parent.id, parent.id);
    assert_eq!(new_sub.parent_task_id, Some(new_parent.id));
    assert_eq!(task_get(&conn, usurper.id).unwrap().title, "usurper");
}

#[test]
fn restore_skips_when_the_engine_regenerated_the_instance() {
    let conn = conn();
    conn.execute(
        "INSERT INTO tasks (title, created_at, origin, rule_key, period_key)
             VALUES ('gen', '2026-01-01T00:00:00Z', 'recurring', 'abc', '2026-09-07T06:00')",
        [],
    )
    .unwrap();
    let id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO rule_runs (rule_key, period_key, generated_at)
             VALUES ('abc', '2026-09-07T06:00', '2026-09-07T06:00:00Z')",
        [],
    )
    .unwrap();
    let deleted = task_delete(&conn, id).unwrap();
    assert!(deleted.rule_run.is_some());
    // the engine brings the instance back before the undo click
    conn.execute(
        "INSERT INTO tasks (title, created_at, origin, rule_key, period_key)
             VALUES ('gen', '2026-01-01T00:00:00Z', 'recurring', 'abc', '2026-09-07T06:00')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO rule_runs (rule_key, period_key, generated_at)
             VALUES ('abc', '2026-09-07T06:00', '2026-09-07T06:00:00Z')",
        [],
    )
    .unwrap();

    let restored = task_restore(&conn, &deleted).unwrap();
    assert!(
        restored.is_empty(),
        "regenerated instance must not duplicate"
    );
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE rule_key = 'abc'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn restore_reinstates_the_rule_runs_ledger_row() {
    let conn = conn();
    conn.execute(
        "INSERT INTO tasks (title, created_at, origin, rule_key, period_key)
             VALUES ('gen', '2026-01-01T00:00:00Z', 'recurring', 'abc', '2026-09-07T06:00')",
        [],
    )
    .unwrap();
    let id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO rule_runs (rule_key, period_key, generated_at)
             VALUES ('abc', '2026-09-07T06:00', '2026-09-07T06:00:00Z')",
        [],
    )
    .unwrap();
    let deleted = task_delete(&conn, id).unwrap();
    let ledger: i64 = conn
        .query_row("SELECT COUNT(*) FROM rule_runs", [], |r| r.get(0))
        .unwrap();
    assert_eq!(ledger, 0, "delete drops the ledger row");

    task_restore(&conn, &deleted).unwrap();
    let ledger: i64 = conn
        .query_row("SELECT COUNT(*) FROM rule_runs", [], |r| r.get(0))
        .unwrap();
    assert_eq!(ledger, 1, "restore puts the ledger row back");
}

#[test]
fn status_change_sets_and_clears_completed_at() {
    let conn = conn();
    let task = task_create(
        &conn,
        &NewTask {
            title: "t".into(),
            ..Default::default()
        },
    )
    .unwrap();

    let done = task_update(
        &conn,
        task.id,
        &TaskPatch {
            status: Some("done".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(done.completed_at.is_some());

    let reopened = task_update(
        &conn,
        task.id,
        &TaskPatch {
            status: Some("todo".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(reopened.completed_at.is_none());
}

#[test]
fn overdue_survives_the_status_cycle() {
    // done -> postponed -> todo on an overdue task must not lose the
    // mark; the UI hides it on done cards, the flag stays truthful
    let conn = conn();
    let task = task_create(
        &conn,
        &NewTask {
            title: "t".into(),
            ..Default::default()
        },
    )
    .unwrap();
    conn.execute("UPDATE tasks SET overdue = 1 WHERE id = ?1", [task.id])
        .unwrap();

    for status in ["done", "postponed", "todo"] {
        let updated = task_update(
            &conn,
            task.id,
            &TaskPatch {
                status: Some(status.into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(updated.overdue, "overdue lost at status '{status}'");
    }
}

#[test]
fn patch_moves_between_day_and_list() {
    let conn = conn();
    let list = list_create(&conn, "Inbox", None, false).unwrap();
    let task = task_create(
        &conn,
        &NewTask {
            title: "t".into(),
            scheduled_date: Some("2026-08-28".into()),
            ..Default::default()
        },
    )
    .unwrap();

    let moved = task_update(
        &conn,
        task.id,
        &TaskPatch {
            list_id: Some(Some(list.id)),
            scheduled_date: Some(None),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(moved.list_id, Some(list.id));
    assert_eq!(moved.scheduled_date, None);
}

#[test]
fn malformed_dates_and_times_are_rejected_or_normalized() {
    let conn = conn();
    assert!(task_create(
        &conn,
        &NewTask {
            title: "bad".into(),
            scheduled_date: Some("28/08/2026".into()),
            ..Default::default()
        },
    )
    .is_err());

    // non-padded input would break lexicographic window filtering
    let task = task_create(
        &conn,
        &NewTask {
            title: "pad".into(),
            scheduled_date: Some("2026-8-5".into()),
            time: Some("9:30".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(task.scheduled_date.as_deref(), Some("2026-08-05"));
    assert_eq!(task.time.as_deref(), Some("09:30"));

    assert!(task_update(
        &conn,
        task.id,
        &TaskPatch {
            scheduled_date: Some(Some("soon".into())),
            ..Default::default()
        },
    )
    .is_err());
    let patched = task_update(
        &conn,
        task.id,
        &TaskPatch {
            scheduled_date: Some(Some("2026-9-1".into())),
            time: Some(None),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(patched.scheduled_date.as_deref(), Some("2026-09-01"));
    assert_eq!(patched.time, None);
}

#[test]
fn list_kind_roundtrips_and_rejects_unknown_values() {
    let conn = conn();
    let list = list_create(&conn, "Groceries", None, false).unwrap();
    assert_eq!(list.kind, "todo");

    list_set_meta(&conn, list.id, None, "", "checklist").unwrap();
    let lists = lists_all(&conn).unwrap();
    assert_eq!(lists[0].kind, "checklist");

    let err = list_set_meta(&conn, list.id, None, "", "grocery").unwrap_err();
    assert!(err.to_string().contains("invalid list kind"), "{err}");
}

#[test]
fn bulk_status_covers_the_list_and_its_subtasks_only() {
    let conn = conn();
    let list = list_create(&conn, "Groceries", None, false).unwrap();
    let other = list_create(&conn, "Other", None, false).unwrap();
    let item = task_create(
        &conn,
        &NewTask {
            title: "milk".into(),
            list_id: Some(list.id),
            ..Default::default()
        },
    )
    .unwrap();
    let sub = task_create(
        &conn,
        &NewTask {
            title: "2 liters".into(),
            parent_task_id: Some(item.id),
            ..Default::default()
        },
    )
    .unwrap();
    // postponed rows are reset along with the rest by the bulk action
    task_update(
        &conn,
        item.id,
        &TaskPatch {
            status: Some("postponed".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let foreign = task_create(
        &conn,
        &NewTask {
            title: "elsewhere".into(),
            list_id: Some(other.id),
            ..Default::default()
        },
    )
    .unwrap();

    let changed = list_set_all_statuses(&conn, list.id, true).unwrap();
    assert_eq!(changed.len(), 2);
    assert_eq!(task_get(&conn, item.id).unwrap().status, "done");
    assert!(task_get(&conn, item.id).unwrap().completed_at.is_some());
    assert_eq!(task_get(&conn, sub.id).unwrap().status, "done");
    assert_eq!(task_get(&conn, foreign.id).unwrap().status, "todo");

    let changed = list_set_all_statuses(&conn, list.id, false).unwrap();
    assert_eq!(changed.len(), 2);
    assert_eq!(task_get(&conn, item.id).unwrap().status, "todo");
    assert!(task_get(&conn, item.id).unwrap().completed_at.is_none());
    assert_eq!(task_get(&conn, sub.id).unwrap().status, "todo");
}

fn set_status(conn: &Connection, id: i64, status: &str) {
    task_update(
        conn,
        id,
        &TaskPatch {
            status: Some(status.into()),
            ..Default::default()
        },
    )
    .unwrap();
}

fn child(conn: &Connection, parent: i64, title: &str) -> i64 {
    task_create(
        conn,
        &NewTask {
            title: title.into(),
            parent_task_id: Some(parent),
            ..Default::default()
        },
    )
    .unwrap()
    .id
}

fn in_list(conn: &Connection, list: i64, title: &str) -> i64 {
    task_create(
        conn,
        &NewTask {
            title: title.into(),
            list_id: Some(list),
            ..Default::default()
        },
    )
    .unwrap()
    .id
}

#[test]
fn uncheck_all_hands_back_what_it_changed_and_undo_restores_it() {
    let conn = conn();
    let list = list_create(&conn, "Packing", None, false).unwrap();
    list_set_meta(&conn, list.id, None, "", "checklist").unwrap();
    let packed = in_list(&conn, list.id, "charger");
    let open = in_list(&conn, list.id, "towel");
    set_status(&conn, packed, "done");
    let stamp = task_get(&conn, packed).unwrap().completed_at;

    let previous = list_set_all_statuses(&conn, list.id, false).unwrap();
    // only the row that changed is handed back, as it was
    assert_eq!(previous.len(), 1);
    assert_eq!(previous[0].id, packed);
    assert_eq!(previous[0].status, "done");
    assert_eq!(task_get(&conn, packed).unwrap().status, "todo");

    assert_eq!(tasks_restore_statuses(&conn, &previous).unwrap(), 1);
    let back = task_get(&conn, packed).unwrap();
    assert_eq!(back.status, "done");
    assert_eq!(back.completed_at, stamp);
    assert_eq!(task_get(&conn, open).unwrap().status, "todo");
}

#[test]
fn a_checklist_category_follows_its_sub_items_and_leads_them() {
    let conn = conn();
    let list = list_create(&conn, "Packing", None, false).unwrap();
    list_set_meta(&conn, list.id, None, "", "checklist").unwrap();
    let docs = in_list(&conn, list.id, "Documents");
    let passport = child(&conn, docs, "passport");
    let insurance = child(&conn, docs, "insurance");
    let visa = child(&conn, docs, "visa");
    set_status(&conn, visa, "dropped");

    set_status(&conn, passport, "done");
    assert_eq!(task_get(&conn, docs).unwrap().status, "todo");
    // the last live sub-item ticks the category; the dropped one is not counted
    set_status(&conn, insurance, "done");
    let category = task_get(&conn, docs).unwrap();
    assert_eq!(category.status, "done");
    assert!(category.completed_at.is_some());
    // unticking one sub-item unticks the category
    set_status(&conn, passport, "todo");
    assert_eq!(task_get(&conn, docs).unwrap().status, "todo");
    assert_eq!(task_get(&conn, insurance).unwrap().status, "done");

    // ticking the category ticks every sub-item, unticking unticks them
    set_status(&conn, docs, "done");
    assert_eq!(task_get(&conn, passport).unwrap().status, "done");
    assert_eq!(task_get(&conn, visa).unwrap().status, "dropped");
    set_status(&conn, docs, "todo");
    assert_eq!(task_get(&conn, passport).unwrap().status, "todo");
    assert_eq!(task_get(&conn, insurance).unwrap().status, "todo");
}

#[test]
fn a_todo_lists_parent_and_subtasks_stay_independent() {
    let conn = conn();
    let list = list_create(&conn, "Inbox", None, false).unwrap();
    let parent = in_list(&conn, list.id, "move house");
    let step = child(&conn, parent, "boxes");
    set_status(&conn, step, "done");
    assert_eq!(task_get(&conn, parent).unwrap().status, "todo");
    set_status(&conn, parent, "done");
    set_status(&conn, parent, "todo");
    assert_eq!(task_get(&conn, step).unwrap().status, "done");
}

#[test]
fn delete_done_skips_checklist_lists() {
    let conn = conn();
    let groceries = list_create(&conn, "Groceries", None, false).unwrap();
    list_set_meta(&conn, groceries.id, None, "", "checklist").unwrap();
    let queue = list_create(&conn, "Inbox", None, false).unwrap();
    let make_done = |list_id: Option<i64>, parent: Option<i64>, title: &str| {
        let task = task_create(
            &conn,
            &NewTask {
                title: title.into(),
                list_id,
                parent_task_id: parent,
                ..Default::default()
            },
        )
        .unwrap();
        task_update(
            &conn,
            task.id,
            &TaskPatch {
                status: Some("done".into()),
                ..Default::default()
            },
        )
        .unwrap()
    };
    let kept = make_done(Some(groceries.id), None, "milk");
    // a done subtask of a checklist item carries no list_id itself
    let kept_sub = make_done(None, Some(kept.id), "2 liters");
    let swept = make_done(Some(queue.id), None, "chore");

    tasks_delete_done(&conn).unwrap();
    let live: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT id FROM tasks WHERE archived_at IS NULL ORDER BY id")
            .unwrap();
        let rows = stmt.query_map([], |r| r.get(0)).unwrap();
        rows.collect::<rusqlite::Result<_>>().unwrap()
    };
    let mut expected = vec![kept.id, kept_sub.id];
    expected.sort();
    assert_eq!(live, expected);
    assert!(task_get(&conn, swept.id).unwrap().id == swept.id);
}

#[test]
fn group_crud_and_membership() {
    let conn = conn();
    let group = group_create(&conn, "Shops").unwrap();
    assert_eq!(group.name, "Shops");

    // names are unique among groups
    let err = group_create(&conn, "Shops").unwrap_err();
    assert!(err.to_string().contains("already exists"), "{err}");

    let list = list_create(&conn, "Lidl", None, false).unwrap();
    assert_eq!(list.group_id, None);
    list_set_group(&conn, list.id, Some(group.id)).unwrap();
    assert_eq!(lists_all(&conn).unwrap()[0].group_id, Some(group.id));

    // a membership pointing at a group that does not exist is refused
    let err = list_set_group(&conn, list.id, Some(999)).unwrap_err();
    assert!(err.to_string().contains("not found"), "{err}");

    group_set_meta(&conn, group.id, "Stores", Some("#3b82f6")).unwrap();
    let groups = groups_all(&conn).unwrap();
    assert_eq!(groups[0].name, "Stores");
    assert_eq!(groups[0].color.as_deref(), Some("#3b82f6"));

    // deleting the group releases the list back to the panel
    group_delete(&conn, group.id).unwrap();
    assert!(groups_all(&conn).unwrap().is_empty());
    assert_eq!(lists_all(&conn).unwrap()[0].group_id, None);
}

#[test]
fn dropped_closes_the_task_and_waiting_keeps_it_open() {
    let conn = conn();
    let task = task_create(
        &conn,
        &NewTask {
            title: "t".into(),
            ..Default::default()
        },
    )
    .unwrap();
    let set = |status: &str| {
        task_update(
            &conn,
            task.id,
            &TaskPatch {
                status: Some(status.into()),
                ..Default::default()
            },
        )
        .unwrap()
    };
    assert!(set("dropped").completed_at.is_some());
    assert!(set("waiting").completed_at.is_none());
}

#[test]
fn invalid_status_rejected() {
    let conn = conn();
    let task = task_create(
        &conn,
        &NewTask {
            title: "t".into(),
            ..Default::default()
        },
    )
    .unwrap();
    let result = task_update(
        &conn,
        task.id,
        &TaskPatch {
            status: Some("later".into()),
            ..Default::default()
        },
    );
    assert!(result.is_err());
}

#[test]
fn a_task_left_with_no_day_and_no_list_goes_to_the_inbox() {
    let conn = conn();
    let today = "2026-10-17".to_string();
    let task = task_create(
        &conn,
        &NewTask {
            title: "call the bank".into(),
            scheduled_date: Some(today.clone()),
            ..Default::default()
        },
    )
    .unwrap();
    // a day task with a date stays where it is
    assert_eq!(
        home_listless(&conn, task.id, "Inbox").unwrap().list_id,
        None
    );

    // clearing its date would leave it in no view at all
    task_update(
        &conn,
        task.id,
        &TaskPatch {
            scheduled_date: Some(None),
            ..Default::default()
        },
    )
    .unwrap();
    let homed = home_listless(&conn, task.id, "Inbox").unwrap();
    let inbox = ensure_inbox(&conn, "Inbox").unwrap();
    assert_eq!(homed.list_id, Some(inbox.id));
    assert_eq!(homed.scheduled_date, None);

    // a subtask carries neither on purpose and is left alone
    let sub = task_create(
        &conn,
        &NewTask {
            title: "find the number".into(),
            parent_task_id: Some(task.id),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(home_listless(&conn, sub.id, "Inbox").unwrap().list_id, None);

    // an Undo whose list is gone lands in the inbox, not nowhere
    let list = list_create(&conn, "Errands", None, false).unwrap();
    let errand = task_create(
        &conn,
        &NewTask {
            title: "post office".into(),
            list_id: Some(list.id),
            ..Default::default()
        },
    )
    .unwrap();
    let deleted = task_delete(&conn, errand.id).unwrap();
    conn.execute("DELETE FROM lists WHERE id = ?1", [list.id])
        .unwrap();
    let restored = task_restore(&conn, &deleted).unwrap();
    assert_eq!(restored[0].list_id, None);
    let homed = home_listless(&conn, restored[0].id, "Inbox").unwrap();
    assert_eq!(homed.list_id, Some(inbox.id));
}

#[test]
fn a_new_group_or_list_lands_after_everything_on_the_panel() {
    let conn = conn();
    let a = list_create(&conn, "A", None, false).unwrap();
    let b = list_create(&conn, "B", None, false).unwrap();
    let group = group_create(&conn, "_checklists").unwrap();
    assert!(group.sort_order > a.sort_order && group.sort_order > b.sort_order);
    let c = list_create(&conn, "C", None, false).unwrap();
    assert!(c.sort_order > group.sort_order);
}

#[test]
fn uncheck_subtasks_resets_one_task_and_its_checklist_category() {
    let conn = conn();
    let list = list_create(&conn, "Grocery", None, false).unwrap();
    list_set_meta(&conn, list.id, None, "", "checklist").unwrap();
    let drinks = in_list(&conn, list.id, "drinks");
    let water = child(&conn, drinks, "water");
    let juice = child(&conn, drinks, "juice");
    let food = in_list(&conn, list.id, "food");
    let bread = child(&conn, food, "bread");
    set_status(&conn, water, "done");
    set_status(&conn, juice, "done");
    set_status(&conn, bread, "done");
    assert_eq!(task_get(&conn, drinks).unwrap().status, "done");

    let previous = task_uncheck_subtasks(&conn, drinks).unwrap();
    // both drinks and the category they had ticked; food untouched
    assert_eq!(previous.len(), 3);
    assert_eq!(task_get(&conn, water).unwrap().status, "todo");
    assert_eq!(task_get(&conn, juice).unwrap().status, "todo");
    assert_eq!(task_get(&conn, drinks).unwrap().status, "todo");
    assert_eq!(task_get(&conn, bread).unwrap().status, "done");

    tasks_restore_statuses(&conn, &previous).unwrap();
    assert_eq!(task_get(&conn, water).unwrap().status, "done");
    assert_eq!(task_get(&conn, drinks).unwrap().status, "done");
}

#[test]
fn uncheck_subtasks_in_a_todo_list_leaves_the_parent_alone() {
    let conn = conn();
    let list = list_create(&conn, "Inbox", None, false).unwrap();
    let parent = in_list(&conn, list.id, "trip");
    let step = child(&conn, parent, "tickets");
    set_status(&conn, step, "done");
    set_status(&conn, parent, "done");
    let previous = task_uncheck_subtasks(&conn, parent).unwrap();
    assert_eq!(previous.len(), 1);
    assert_eq!(task_get(&conn, step).unwrap().status, "todo");
    assert_eq!(task_get(&conn, parent).unwrap().status, "done");
}

#[test]
fn delete_done_subtasks_keeps_the_rest_and_undoes() {
    let conn = conn();
    let list = list_create(&conn, "Inbox", None, false).unwrap();
    let parent = in_list(&conn, list.id, "trip");
    let tickets = child(&conn, parent, "tickets");
    let visa = child(&conn, parent, "visa");
    let hotel = child(&conn, parent, "hotel");
    set_status(&conn, tickets, "done");
    set_status(&conn, visa, "done");
    set_status(&conn, hotel, "postponed");

    let deleted = task_delete_done_subtasks(&conn, parent).unwrap();
    assert_eq!(deleted.tasks.len(), 2);
    assert!(task_get(&conn, tickets).is_err());
    assert!(task_get(&conn, visa).is_err());
    assert_eq!(task_get(&conn, hotel).unwrap().status, "postponed");
    assert_eq!(task_get(&conn, parent).unwrap().status, "todo");

    let restored = task_restore(&conn, &deleted).unwrap();
    assert_eq!(restored.len(), 2);
    assert_eq!(
        task_get(&conn, tickets).unwrap().parent_task_id,
        Some(parent)
    );
    assert_eq!(task_get(&conn, visa).unwrap().status, "done");
}
