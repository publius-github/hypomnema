//! Full-fidelity text snapshot of the database's authoritative state
//! under `.hypomnema/state/`, and the restore path that rebuilds app.db
//! from it. Together with the config YAMLs and the task mirror this
//! makes the database a disposable cache: everything the app cannot
//! re-derive lives in text files, so a vault carried by a file sync
//! (Dropbox and friends) is complete without its .db file, and a second
//! device rebuilds its own local database from the same files.
//!
//! Format: one JSON object per line (JSONL), rows sorted by their stable
//! key, so file diffs stay line-local. These files are written by the
//! app for the app - the human-editable surfaces remain the config
//! YAMLs and the task mirror.
//!
//! What is covered and why:
//! - tasks.jsonl - every task row including provenance (rule/period
//!   keys, cadence, origin_date), archived tombstones and subtask links;
//!   the mirror carries only the human-facing fields.
//! - lists.jsonl - list metadata (color, favorite, description, archived,
//!   kind, group membership).
//! - list_groups.jsonl - the list-panel groups lists fold into.
//! - rule_runs.jsonl - the dedup ledger; losing it would regenerate
//!   every still-current period as a fresh todo.
//! - rule_seen.jsonl - first-seen dates; losing it would re-run catch-up
//!   for old rules from scratch.
//! - weekly_focus.jsonl - the ISO-week -> phrase pin of the focus
//!   rotation.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

#[derive(Serialize, Deserialize)]
struct TaskRow {
    id: i64,
    title: String,
    description_md: String,
    list_id: Option<i64>,
    scheduled_date: Option<String>,
    time: Option<String>,
    status: String,
    color: Option<String>,
    sort_order: i64,
    parent_task_id: Option<i64>,
    created_at: String,
    completed_at: Option<String>,
    overdue: i64,
    origin: String,
    rule_key: Option<String>,
    period_key: Option<String>,
    archived_at: Option<String>,
    cadence: Option<String>,
    origin_date: Option<String>,
    priority: i64,
    dow_label: Option<String>,
    /// Merge stamps (db.rs migration 016). Optional in both directions on
    /// purpose: a snapshot written by an older build has no such fields
    /// and must still restore, and an older build reading this file
    /// ignores them rather than choking - which is what lets two devices
    /// on different versions share one vault.
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    updated_by: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct ListRow {
    id: i64,
    name: String,
    sort_order: i64,
    color: Option<String>,
    archived: i64,
    auto: i64,
    favorite: i64,
    description: String,
    // snapshots written before the list-kind column default to 'todo'
    #[serde(default = "default_list_kind")]
    kind: String,
    #[serde(default)]
    group_id: Option<i64>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    updated_by: Option<String>,
}

fn default_list_kind() -> String {
    "todo".to_string()
}

#[derive(Serialize, Deserialize)]
struct GroupRow {
    id: i64,
    name: String,
    sort_order: i64,
    color: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    updated_by: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct RuleRunRow {
    rule_key: String,
    period_key: String,
    generated_at: String,
}

#[derive(Serialize, Deserialize)]
struct RuleSeenRow {
    rule_key: String,
    first_seen: String,
}

#[derive(Serialize, Deserialize)]
struct FocusRow {
    iso_year: i64,
    iso_week: i64,
    phrase_index: i64,
}

fn write_if_changed(path: &Path, content: &str) -> Result<()> {
    if fs::read_to_string(path)
        .map(|c| c == content)
        .unwrap_or(false)
    {
        return Ok(());
    }
    crate::vault::write_atomic(path, content)
}

fn to_jsonl<T: Serialize>(rows: &[T]) -> Result<String> {
    let mut out = String::new();
    for row in rows {
        out.push_str(
            &serde_json::to_string(row).map_err(|e| Error::State(format!("state export: {e}")))?,
        );
        out.push('\n');
    }
    Ok(out)
}

/// A file the snapshot may lack (older exports) reads as empty; a file
/// that exists but does not parse is an error like tasks.jsonl - an empty
/// `rule_runs` would make the engine regenerate every current period.
fn from_jsonl_optional<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Vec<T>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    from_jsonl(path)
}

fn from_jsonl<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Vec<T>> {
    let content = fs::read_to_string(path)?;
    let mut rows = Vec::new();
    for (i, line) in content.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        rows.push(serde_json::from_str(line).map_err(|e| {
            Error::State(format!(
                "{}: line {}: {e}",
                path.file_name().unwrap_or_default().to_string_lossy(),
                i + 1
            ))
        })?);
    }
    Ok(rows)
}

/// Writes the snapshot. Ordered queries keep the files byte-stable
/// between unchanged exports, so write_if_changed skips the disk.
pub fn export(conn: &Connection, state_dir: &Path) -> Result<()> {
    fs::create_dir_all(state_dir)?;

    let tasks: Vec<TaskRow> = conn
        .prepare("SELECT * FROM tasks ORDER BY id")?
        .query_map([], |r| {
            Ok(TaskRow {
                id: r.get("id")?,
                title: r.get("title")?,
                description_md: r.get("description_md")?,
                list_id: r.get("list_id")?,
                scheduled_date: r.get("scheduled_date")?,
                time: r.get("time")?,
                status: r.get("status")?,
                color: r.get("color")?,
                sort_order: r.get("sort_order")?,
                parent_task_id: r.get("parent_task_id")?,
                created_at: r.get("created_at")?,
                completed_at: r.get("completed_at")?,
                overdue: r.get("overdue")?,
                origin: r.get("origin")?,
                rule_key: r.get("rule_key")?,
                period_key: r.get("period_key")?,
                archived_at: r.get("archived_at")?,
                cadence: r.get("cadence")?,
                origin_date: r.get("origin_date")?,
                priority: r.get("priority")?,
                dow_label: r.get("dow_label")?,
                updated_at: r.get("updated_at")?,
                updated_by: r.get("updated_by")?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    write_if_changed(&state_dir.join("tasks.jsonl"), &to_jsonl(&tasks)?)?;

    let lists: Vec<ListRow> = conn
        .prepare("SELECT * FROM lists ORDER BY id")?
        .query_map([], |r| {
            Ok(ListRow {
                id: r.get("id")?,
                name: r.get("name")?,
                sort_order: r.get("sort_order")?,
                color: r.get("color")?,
                archived: r.get("archived")?,
                auto: r.get("auto")?,
                favorite: r.get("favorite")?,
                description: r.get("description")?,
                kind: r.get("kind")?,
                group_id: r.get("group_id")?,
                updated_at: r.get("updated_at")?,
                updated_by: r.get("updated_by")?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    write_if_changed(&state_dir.join("lists.jsonl"), &to_jsonl(&lists)?)?;

    let groups: Vec<GroupRow> = conn
        .prepare("SELECT * FROM list_groups ORDER BY id")?
        .query_map([], |r| {
            Ok(GroupRow {
                id: r.get("id")?,
                name: r.get("name")?,
                sort_order: r.get("sort_order")?,
                color: r.get("color")?,
                updated_at: r.get("updated_at")?,
                updated_by: r.get("updated_by")?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    write_if_changed(&state_dir.join("list_groups.jsonl"), &to_jsonl(&groups)?)?;

    let runs: Vec<RuleRunRow> = conn
        .prepare("SELECT rule_key, period_key, generated_at FROM rule_runs ORDER BY rule_key, period_key")?
        .query_map([], |r| {
            Ok(RuleRunRow {
                rule_key: r.get(0)?,
                period_key: r.get(1)?,
                generated_at: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    write_if_changed(&state_dir.join("rule_runs.jsonl"), &to_jsonl(&runs)?)?;

    let seen: Vec<RuleSeenRow> = conn
        .prepare("SELECT rule_key, first_seen FROM rule_seen ORDER BY rule_key")?
        .query_map([], |r| {
            Ok(RuleSeenRow {
                rule_key: r.get(0)?,
                first_seen: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    write_if_changed(&state_dir.join("rule_seen.jsonl"), &to_jsonl(&seen)?)?;

    let focus: Vec<FocusRow> = conn
        .prepare("SELECT iso_year, iso_week, phrase_index FROM weekly_focus_state ORDER BY iso_year, iso_week")?
        .query_map([], |r| {
            Ok(FocusRow {
                iso_year: r.get(0)?,
                iso_week: r.get(1)?,
                phrase_index: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    write_if_changed(&state_dir.join("weekly_focus.jsonl"), &to_jsonl(&focus)?)?;

    Ok(())
}

/// Rebuilds the database content from the snapshot. Returns false when
/// no snapshot exists (a genuinely fresh vault). Only meant for a fresh,
/// just-migrated database: rows are inserted with their original ids so
/// the task mirror's ^id keys stay valid. One transaction - a broken
/// snapshot leaves the database empty rather than half-restored, and the
/// caller must treat the error as fatal for the open (continuing would
/// overwrite the snapshot files with the empty state).
pub fn restore(conn: &Connection, state_dir: &Path) -> Result<bool> {
    let tasks_path = state_dir.join("tasks.jsonl");
    if !tasks_path.exists() {
        return Ok(false);
    }
    let tasks: Vec<TaskRow> = from_jsonl(&tasks_path)?;
    let lists: Vec<ListRow> = from_jsonl_optional(&state_dir.join("lists.jsonl"))?;
    let groups: Vec<GroupRow> = from_jsonl_optional(&state_dir.join("list_groups.jsonl"))?;
    let runs: Vec<RuleRunRow> = from_jsonl_optional(&state_dir.join("rule_runs.jsonl"))?;
    let seen: Vec<RuleSeenRow> = from_jsonl_optional(&state_dir.join("rule_seen.jsonl"))?;
    let focus: Vec<FocusRow> = from_jsonl_optional(&state_dir.join("weekly_focus.jsonl"))?;

    let tx = conn.unchecked_transaction()?;
    // Two rows under one name are the same thing created on two devices
    // before either synced (their ids were counted up separately, see
    // ids.rs). The first by id stands and the other's members move to
    // it: an active-name clash would otherwise fail the whole restore on
    // the unique index, and two groups of one name are no better. Both
    // devices fold the same merged snapshot the same way.
    let mut group_alias: HashMap<i64, i64> = HashMap::new();
    let mut group_by_name: HashMap<&str, i64> = HashMap::new();
    let groups: Vec<&GroupRow> = groups
        .iter()
        .filter(|g| match group_by_name.get(g.name.as_str()) {
            Some(&kept) => {
                group_alias.insert(g.id, kept);
                false
            }
            None => {
                group_by_name.insert(&g.name, g.id);
                true
            }
        })
        .collect();
    let mut list_alias: HashMap<i64, i64> = HashMap::new();
    let mut list_by_name: HashMap<&str, i64> = HashMap::new();
    let lists: Vec<&ListRow> = lists
        .iter()
        .filter(|l| {
            if l.archived != 0 {
                return true;
            }
            match list_by_name.get(l.name.as_str()) {
                Some(&kept) => {
                    list_alias.insert(l.id, kept);
                    false
                }
                None => {
                    list_by_name.insert(&l.name, l.id);
                    true
                }
            }
        })
        .collect();
    // groups before lists: lists.group_id is an enforced FK
    for g in &groups {
        tx.execute(
            "INSERT OR REPLACE INTO list_groups
                 (id, name, sort_order, color, updated_at, updated_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                g.id,
                g.name,
                g.sort_order,
                g.color,
                g.updated_at,
                g.updated_by
            ],
        )?;
    }
    let group_ids: std::collections::HashSet<i64> = groups.iter().map(|g| g.id).collect();
    for l in &lists {
        // a merged snapshot can reference a group deleted on the other
        // device; dropping the membership beats failing the whole restore
        let group_id = l
            .group_id
            .map(|gid| group_alias.get(&gid).copied().unwrap_or(gid))
            .filter(|gid| group_ids.contains(gid));
        tx.execute(
            "INSERT OR REPLACE INTO lists
                 (id, name, sort_order, color, archived, auto, favorite, description,
                  kind, group_id, updated_at, updated_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![
                l.id,
                l.name,
                l.sort_order,
                l.color,
                l.archived,
                l.auto,
                l.favorite,
                l.description,
                l.kind,
                group_id,
                l.updated_at,
                l.updated_by
            ],
        )?;
    }
    // parents before subtasks: the parent_task_id FK is enforced
    let mut ordered: Vec<&TaskRow> = tasks.iter().collect();
    ordered.sort_by_key(|t| (t.parent_task_id.is_some(), t.id));
    // Same story as group_id above: a merged snapshot can keep a task
    // whose list or parent the other device hard-deleted. A dangling
    // list_id becomes "no list"; a subtask without its parent is dropped
    // (a cascade delete would have taken it anyway).
    let list_ids: std::collections::HashSet<i64> = lists.iter().map(|l| l.id).collect();
    let task_ids: std::collections::HashSet<i64> = tasks.iter().map(|t| t.id).collect();
    let ordered: Vec<&TaskRow> = ordered
        .into_iter()
        .filter(|t| t.parent_task_id.is_none_or(|pid| task_ids.contains(&pid)))
        .collect();
    for t in ordered {
        let list_id = t
            .list_id
            .map(|lid| list_alias.get(&lid).copied().unwrap_or(lid))
            .filter(|lid| list_ids.contains(lid));
        tx.execute(
            "INSERT OR REPLACE INTO tasks
                 (id, title, description_md, list_id, scheduled_date, time, status,
                  color, sort_order, parent_task_id, created_at, completed_at,
                  overdue, origin, rule_key, period_key, archived_at, cadence,
                  origin_date, priority, dow_label, updated_at, updated_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                     ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
            rusqlite::params![
                t.id,
                t.title,
                t.description_md,
                list_id,
                t.scheduled_date,
                t.time,
                t.status,
                t.color,
                t.sort_order,
                t.parent_task_id,
                t.created_at,
                t.completed_at,
                t.overdue,
                t.origin,
                t.rule_key,
                t.period_key,
                t.archived_at,
                t.cadence,
                t.origin_date,
                t.priority,
                t.dow_label,
                t.updated_at,
                t.updated_by
            ],
        )?;
    }
    for r in &runs {
        tx.execute(
            "INSERT OR REPLACE INTO rule_runs (rule_key, period_key, generated_at)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![r.rule_key, r.period_key, r.generated_at],
        )?;
    }
    for s in &seen {
        tx.execute(
            "INSERT OR REPLACE INTO rule_seen (rule_key, first_seen) VALUES (?1, ?2)",
            rusqlite::params![s.rule_key, s.first_seen],
        )?;
    }
    for f in &focus {
        tx.execute(
            "INSERT OR REPLACE INTO weekly_focus_state (iso_year, iso_week, phrase_index)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![f.iso_year, f.iso_week, f.phrase_index],
        )?;
    }
    tx.commit()?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::tasks::{self, NewTask, TaskPatch};
    use std::path::PathBuf;

    fn setup(tag: &str) -> (Connection, PathBuf) {
        let dir = std::env::temp_dir().join(format!("app-pkb-state-{tag}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        (conn, dir)
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn export_restore_round_trip_preserves_everything() {
        let (conn, dir) = setup("roundtrip");
        let list = tasks::list_create(&conn, "Inbox", Some("#ff0000"), false).unwrap();
        let parent = tasks::task_create(
            &conn,
            &NewTask {
                title: "with details".into(),
                description_md: "some **markdown**".into(),
                list_id: Some(list.id),
                time: Some("09:00".into()),
                ..Default::default()
            },
        )
        .unwrap();
        tasks::task_create(
            &conn,
            &NewTask {
                title: "sub".into(),
                parent_task_id: Some(parent.id),
                ..Default::default()
            },
        )
        .unwrap();
        tasks::task_update(
            &conn,
            parent.id,
            &TaskPatch {
                priority: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tasks (title, created_at, origin, rule_key, period_key,
                                scheduled_date, cadence, archived_at)
             VALUES ('gen done', '2026-01-01T00:00:00Z', 'recurring', 'rk',
                     '2026-09-07T06:00', '2026-09-07', 'daily', '2026-09-07T10:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO rule_runs (rule_key, period_key, generated_at)
             VALUES ('rk', '2026-09-07T06:00', '2026-09-07T06:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO rule_seen (rule_key, first_seen) VALUES ('rk', '2026-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO weekly_focus_state (iso_year, iso_week, phrase_index)
             VALUES (2026, 37, 2)",
            [],
        )
        .unwrap();

        export(&conn, &dir).unwrap();

        let (fresh, _) = setup("roundtrip-fresh");
        assert!(restore(&fresh, &dir).unwrap());
        assert_eq!(count(&fresh, "tasks"), 3);
        assert_eq!(count(&fresh, "lists"), 1);
        assert_eq!(count(&fresh, "rule_runs"), 1);
        assert_eq!(count(&fresh, "rule_seen"), 1);
        assert_eq!(count(&fresh, "weekly_focus_state"), 1);

        let restored = tasks::task_get(&fresh, parent.id).unwrap();
        assert_eq!(restored.title, "with details");
        assert_eq!(restored.description_md, "some **markdown**");
        assert_eq!(restored.time.as_deref(), Some("09:00"));
        assert!(restored.priority);
        assert_eq!(restored.list_id, Some(list.id));
        // the archived tombstone survives too (delete-done sweep state)
        let archived: i64 = fresh
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE archived_at IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(archived, 1);

        // a second export from the restored db is byte-identical
        let before = fs::read_to_string(dir.join("tasks.jsonl")).unwrap();
        let dir2 = std::env::temp_dir().join("app-pkb-state-roundtrip2");
        let _ = fs::remove_dir_all(&dir2);
        export(&fresh, &dir2).unwrap();
        let after = fs::read_to_string(dir2.join("tasks.jsonl")).unwrap();
        assert_eq!(before, after);
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&dir2);
    }

    #[test]
    fn groups_roundtrip_and_a_dangling_membership_is_dropped() {
        let (conn, dir) = setup("groups-roundtrip");
        let group = tasks::group_create(&conn, "Shops").unwrap();
        let list = tasks::list_create(&conn, "Lidl", None, false).unwrap();
        tasks::list_set_group(&conn, list.id, Some(group.id)).unwrap();
        export(&conn, &dir).unwrap();

        let (fresh, _) = setup("groups-roundtrip-fresh");
        assert!(restore(&fresh, &dir).unwrap());
        assert_eq!(count(&fresh, "list_groups"), 1);
        let restored_gid: Option<i64> = fresh
            .query_row("SELECT group_id FROM lists WHERE id = ?1", [list.id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(restored_gid, Some(group.id));

        // a merged snapshot can point a list at a group the other device
        // deleted; the membership is dropped, the restore succeeds
        fs::write(dir.join("list_groups.jsonl"), "").unwrap();
        let (fresh2, _) = setup("groups-roundtrip-dangling");
        assert!(restore(&fresh2, &dir).unwrap());
        let dangling_gid: Option<i64> = fresh2
            .query_row("SELECT group_id FROM lists WHERE id = ?1", [list.id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(dangling_gid, None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_lists_of_one_name_from_two_devices_restore_as_one() {
        let (conn, dir) = setup("namesake-lists");
        let list = |id: i64| {
            format!(
                "{{\"id\":{id},\"name\":\"Work\",\"sort_order\":0,\"color\":null,\
                 \"archived\":0,\"auto\":0,\"favorite\":0,\"description\":\"\"}}"
            )
        };
        fs::write(
            dir.join("lists.jsonl"),
            format!("{}\n{}\n", list(3), list(9)),
        )
        .unwrap();
        fs::write(
            dir.join("tasks.jsonl"),
            "{\"id\":1,\"title\":\"from the phone\",\"description_md\":\"\",\"list_id\":9,\
             \"scheduled_date\":null,\"time\":null,\"status\":\"todo\",\"color\":null,\
             \"sort_order\":0,\"parent_task_id\":null,\"created_at\":\"2026-10-14T00:00:00Z\",\
             \"completed_at\":null,\"overdue\":0,\"origin\":\"manual\",\"rule_key\":null,\
             \"period_key\":null,\"archived_at\":null,\"cadence\":null,\"origin_date\":null,\
             \"priority\":0,\"dow_label\":null}\n",
        )
        .unwrap();

        assert!(restore(&conn, &dir).unwrap());

        assert_eq!(count(&conn, "lists"), 1);
        let list_id: i64 = conn
            .query_row("SELECT list_id FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(list_id, 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_without_snapshot_reports_fresh_vault() {
        let (conn, dir) = setup("fresh");
        let empty = dir.join("nothing-here");
        assert!(!restore(&conn, &empty).unwrap());
    }

    #[test]
    fn broken_snapshot_fails_loud_and_applies_nothing() {
        let (conn, dir) = setup("broken");
        fs::write(dir.join("tasks.jsonl"), "{not json}\n").unwrap();
        assert!(restore(&conn, &dir).is_err());
        assert_eq!(count(&conn, "tasks"), 0);
    }
}
