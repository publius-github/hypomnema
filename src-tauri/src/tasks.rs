use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct List {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    #[ts(type = "number")]
    pub sort_order: i64,
    pub color: Option<String>,
    pub archived: bool,
    /// Created by the engine (a `{List}` prefix or Birthdays), not by
    /// the user; hidden from the dashboard list zone while empty.
    pub auto: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Task {
    #[ts(type = "number")]
    pub id: i64,
    pub title: String,
    pub description_md: String,
    #[ts(type = "number | null")]
    pub list_id: Option<i64>,
    pub scheduled_date: Option<String>,
    pub time: Option<String>,
    #[ts(type = "\"todo\" | \"done\" | \"postponed\"")]
    pub status: String,
    pub color: Option<String>,
    #[ts(type = "number")]
    pub sort_order: i64,
    #[ts(type = "number | null")]
    pub parent_task_id: Option<i64>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub overdue: bool,
    pub origin: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct NewTask {
    pub title: String,
    #[serde(default)]
    pub description_md: String,
    pub list_id: Option<i64>,
    pub scheduled_date: Option<String>,
    pub time: Option<String>,
    pub color: Option<String>,
    pub parent_task_id: Option<i64>,
}

/// Patch for task_update: `Some(inner)` sets the column (inner `None`
/// clears a nullable column), `None` leaves it untouched.
#[derive(Debug, Default, Deserialize)]
pub struct TaskPatch {
    pub title: Option<String>,
    pub description_md: Option<String>,
    #[serde(default, with = "double_option")]
    pub list_id: Option<Option<i64>>,
    #[serde(default, with = "double_option")]
    pub scheduled_date: Option<Option<String>>,
    #[serde(default, with = "double_option")]
    pub time: Option<Option<String>>,
    pub status: Option<String>,
    #[serde(default, with = "double_option")]
    pub color: Option<Option<String>>,
    pub sort_order: Option<i64>,
}

mod double_option {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
    {
        Ok(Some(Option::<T>::deserialize(deserializer)?))
    }
}

/// The whole date model relies on lexicographic ordering of zero-padded
/// YYYY-MM-DD strings (carry-over, snapshot windows, search order); a
/// malformed date stored verbatim would silently fall out of every
/// window and vanish from the grid. Validate and normalize on the way in.
fn normalize_date(date: &str) -> Result<String> {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|d| d.format("%Y-%m-%d").to_string())
        .map_err(|_| Error::State(format!("invalid date '{date}', expected YYYY-MM-DD")))
}

fn normalize_time(time: &str) -> Result<String> {
    chrono::NaiveTime::parse_from_str(time, "%H:%M")
        .map(|t| t.format("%H:%M").to_string())
        .map_err(|_| Error::State(format!("invalid time '{time}', expected HH:MM")))
}

fn row_to_task(row: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get("id")?,
        title: row.get("title")?,
        description_md: row.get("description_md")?,
        list_id: row.get("list_id")?,
        scheduled_date: row.get("scheduled_date")?,
        time: row.get("time")?,
        status: row.get("status")?,
        color: row.get("color")?,
        sort_order: row.get("sort_order")?,
        parent_task_id: row.get("parent_task_id")?,
        created_at: row.get("created_at")?,
        completed_at: row.get("completed_at")?,
        overdue: row.get::<_, i64>("overdue")? != 0,
        origin: row.get("origin")?,
    })
}

fn row_to_list(row: &Row) -> rusqlite::Result<List> {
    Ok(List {
        id: row.get("id")?,
        name: row.get("name")?,
        sort_order: row.get("sort_order")?,
        color: row.get("color")?,
        archived: row.get::<_, i64>("archived")? != 0,
        auto: row.get::<_, i64>("auto")? != 0,
    })
}

pub fn lists_all(conn: &Connection) -> Result<Vec<List>> {
    let mut stmt =
        conn.prepare("SELECT * FROM lists WHERE archived = 0 ORDER BY sort_order, name")?;
    let lists = stmt
        .query_map([], row_to_list)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(lists)
}

pub fn list_create(conn: &Connection, name: &str, color: Option<&str>, auto: bool) -> Result<List> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::State("list name cannot be empty".into()));
    }
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM lists",
        [],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO lists (name, sort_order, color, auto) VALUES (?1, ?2, ?3, ?4)",
        (name, next, color, auto as i64),
    )?;
    let id = conn.last_insert_rowid();
    conn.query_row("SELECT * FROM lists WHERE id = ?1", [id], row_to_list)
        .map_err(Into::into)
}

/// Returns the list with the given name, creating it if missing.
/// Backs the `{List Name}` prefix of YAML items (req. 3). An archived
/// match is revived as an auto list: its tasks must keep grouping in
/// the day columns, and the auto flag keeps it out of the list zone.
pub fn list_ensure(conn: &Connection, name: &str) -> Result<List> {
    let existing = conn
        .query_row("SELECT * FROM lists WHERE name = ?1", [name], row_to_list)
        .optional()?;
    match existing {
        Some(list) if list.archived => {
            conn.execute(
                "UPDATE lists SET archived = 0, auto = 1 WHERE id = ?1",
                [list.id],
            )?;
            Ok(List {
                archived: false,
                auto: true,
                ..list
            })
        }
        Some(list) => Ok(list),
        None => list_create(conn, name, None, true),
    }
}

pub fn list_rename(conn: &Connection, id: i64, name: &str) -> Result<()> {
    let updated = conn.execute(
        "UPDATE lists SET name = ?1 WHERE id = ?2",
        (name.trim(), id),
    )?;
    if updated == 0 {
        return Err(Error::State(format!("list {id} not found")));
    }
    Ok(())
}

pub fn list_archive(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("UPDATE lists SET archived = 1 WHERE id = ?1", [id])?;
    Ok(())
}

/// Tasks visible on the Dashboard: everything scheduled in the rolling
/// window, everything unscheduled (list zone), and all their subtasks.
/// Overdue carry-over (M2) will move older tasks into the window before
/// this query runs, so a plain range filter is enough here.
pub fn tasks_snapshot(conn: &Connection, start_date: &str, end_date: &str) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM tasks
         WHERE archived_at IS NULL
           AND (
             parent_task_id IS NOT NULL
             OR scheduled_date IS NULL
             OR (scheduled_date >= ?1 AND scheduled_date < ?2)
           )
         ORDER BY time IS NULL, time, sort_order, id",
    )?;
    let tasks = stmt
        .query_map((start_date, end_date), row_to_task)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(tasks)
}

/// Title substring search across the whole history, newest dates first,
/// unscheduled tasks last. Subtasks are excluded; the parent is what
/// the user looks for.
pub fn tasks_search(conn: &Connection, query: &str) -> Result<Vec<Task>> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }
    let pattern = format!(
        "%{}%",
        trimmed
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let mut stmt = conn.prepare(
        "SELECT * FROM tasks
         WHERE title LIKE ?1 ESCAPE '\\'
           AND parent_task_id IS NULL
           AND archived_at IS NULL
         ORDER BY scheduled_date IS NULL, scheduled_date DESC, id DESC
         LIMIT 100",
    )?;
    let tasks = stmt
        .query_map([pattern], row_to_task)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(tasks)
}

pub fn task_create(conn: &Connection, new: &NewTask) -> Result<Task> {
    let mut title = new.title.trim().to_string();
    if title.is_empty() {
        return Err(Error::State("task title cannot be empty".into()));
    }
    // Same {List Name} prefix syntax as the YAML items: an explicit
    // prefix in a typed title wins over the target list and creates the
    // list on the fly, exactly like the engine does. Subtasks live
    // under their parent and keep the braces literally.
    let mut list_id = new.list_id;
    if new.parent_task_id.is_none() {
        let (list, rest) = crate::engine::parse_item(&title);
        if let Some(list) = list {
            list_id = Some(list_ensure(conn, &list)?.id);
            title = rest;
        }
    }
    let scheduled_date = new
        .scheduled_date
        .as_deref()
        .map(normalize_date)
        .transpose()?;
    let time = new.time.as_deref().map(normalize_time).transpose()?;
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks
         WHERE COALESCE(scheduled_date, '') = COALESCE(?1, '')
           AND COALESCE(list_id, -1) = COALESCE(?2, -1)",
        (&scheduled_date, list_id),
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO tasks (title, description_md, list_id, scheduled_date, time,
                            color, sort_order, parent_task_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        (
            &title,
            &new.description_md,
            list_id,
            &scheduled_date,
            &time,
            &new.color,
            next,
            new.parent_task_id,
            Utc::now().to_rfc3339(),
        ),
    )?;
    let id = conn.last_insert_rowid();
    task_get(conn, id)
}

pub fn task_get(conn: &Connection, id: i64) -> Result<Task> {
    conn.query_row("SELECT * FROM tasks WHERE id = ?1", [id], row_to_task)
        .map_err(Into::into)
}

pub fn task_update(conn: &Connection, id: i64, patch: &TaskPatch) -> Result<Task> {
    // The patch spans several UPDATEs; an error mid-way must not leave
    // half of it applied.
    let tx = conn.unchecked_transaction()?;
    if let Some(status) = &patch.status {
        if !["todo", "done", "postponed"].contains(&status.as_str()) {
            return Err(Error::State(format!("invalid status: {status}")));
        }
        let completed_at = if status == "done" {
            Some(Utc::now().to_rfc3339())
        } else {
            None
        };
        conn.execute(
            "UPDATE tasks SET status = ?1, completed_at = ?2,
                    overdue = CASE WHEN ?1 = 'done' THEN 0 ELSE overdue END
             WHERE id = ?3",
            (status, completed_at, id),
        )?;
    }
    if let Some(title) = &patch.title {
        conn.execute(
            "UPDATE tasks SET title = ?1 WHERE id = ?2",
            (title.trim(), id),
        )?;
    }
    if let Some(description) = &patch.description_md {
        conn.execute(
            "UPDATE tasks SET description_md = ?1 WHERE id = ?2",
            (description, id),
        )?;
    }
    if let Some(list_id) = &patch.list_id {
        conn.execute("UPDATE tasks SET list_id = ?1 WHERE id = ?2", (list_id, id))?;
    }
    if let Some(date) = &patch.scheduled_date {
        let date = date.as_deref().map(normalize_date).transpose()?;
        conn.execute(
            "UPDATE tasks SET scheduled_date = ?1 WHERE id = ?2",
            (date, id),
        )?;
    }
    if let Some(time) = &patch.time {
        let time = time.as_deref().map(normalize_time).transpose()?;
        conn.execute("UPDATE tasks SET time = ?1 WHERE id = ?2", (time, id))?;
    }
    if let Some(color) = &patch.color {
        conn.execute("UPDATE tasks SET color = ?1 WHERE id = ?2", (color, id))?;
    }
    if let Some(sort_order) = patch.sort_order {
        conn.execute(
            "UPDATE tasks SET sort_order = ?1 WHERE id = ?2",
            (sort_order, id),
        )?;
    }
    tx.commit()?;
    task_get(conn, id)
}

/// Soft delete: the row (and its subtasks) get archived_at set, every
/// query filters them out, and task_restore can undo it. The engine
/// permanently purges archived rows after 24h. The rule_runs ledger row
/// survives either way, so a deleted generated instance never
/// regenerates for the same period.
pub fn task_delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE tasks SET archived_at = ?1 WHERE id = ?2 OR parent_task_id = ?2",
        (Utc::now().to_rfc3339(), id),
    )?;
    Ok(())
}

pub fn task_restore(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE tasks SET archived_at = NULL WHERE id = ?1 OR parent_task_id = ?1",
        [id],
    )?;
    Ok(())
}

/// Debug helper (Settings): wipes every task marked done; subtasks of
/// deleted parents cascade.
pub fn tasks_delete_done(conn: &Connection) -> Result<usize> {
    Ok(conn.execute("DELETE FROM tasks WHERE status = 'done'", [])?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn create_parses_list_prefix_like_yaml_items() {
        let conn = conn();
        let task = task_create(
            &conn,
            &NewTask {
                title: "{05 Finance} pay bills".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(task.title, "pay bills");
        let list = lists_all(&conn)
            .unwrap()
            .into_iter()
            .find(|l| l.name == "05 Finance")
            .expect("list auto-created");
        assert_eq!(task.list_id, Some(list.id));

        // a subtask keeps the braces literally
        let sub = task_create(
            &conn,
            &NewTask {
                title: "{not a list} step".into(),
                parent_task_id: Some(task.id),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(sub.title, "{not a list} step");
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

        // delete is soft: the pair disappears from the snapshot but can
        // be restored as a whole within the undo window
        task_delete(&conn, parent.id).unwrap();
        let after = tasks_snapshot(&conn, "2026-08-28", "2026-08-29").unwrap();
        assert!(!after.iter().any(|t| t.id == parent.id || t.id == sub.id));

        task_restore(&conn, parent.id).unwrap();
        let restored = tasks_snapshot(&conn, "2026-08-28", "2026-08-29").unwrap();
        assert!(restored.iter().any(|t| t.id == parent.id));
        assert!(restored.iter().any(|t| t.id == sub.id));
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
    fn done_clears_overdue_flag() {
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

        let done = task_update(
            &conn,
            task.id,
            &TaskPatch {
                status: Some("done".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!done.overdue);
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
}
