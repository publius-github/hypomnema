use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct List {
    pub id: i64,
    pub name: String,
    pub sort_order: i64,
    pub color: Option<String>,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub description_md: String,
    pub list_id: Option<i64>,
    pub scheduled_date: Option<String>,
    pub time: Option<String>,
    pub status: String,
    pub color: Option<String>,
    pub sort_order: i64,
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

pub fn list_create(conn: &Connection, name: &str, color: Option<&str>) -> Result<List> {
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
        "INSERT INTO lists (name, sort_order, color) VALUES (?1, ?2, ?3)",
        (name, next, color),
    )?;
    let id = conn.last_insert_rowid();
    conn.query_row("SELECT * FROM lists WHERE id = ?1", [id], row_to_list)
        .map_err(Into::into)
}

/// Returns the list with the given name, creating it if missing.
/// Backs the `{List Name}` prefix of YAML items (req. 3).
pub fn list_ensure(conn: &Connection, name: &str) -> Result<List> {
    let existing = conn
        .query_row("SELECT * FROM lists WHERE name = ?1", [name], row_to_list)
        .optional()?;
    match existing {
        Some(list) => Ok(list),
        None => list_create(conn, name, None),
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

pub fn task_create(conn: &Connection, new: &NewTask) -> Result<Task> {
    let title = new.title.trim();
    if title.is_empty() {
        return Err(Error::State("task title cannot be empty".into()));
    }
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks
         WHERE COALESCE(scheduled_date, '') = COALESCE(?1, '')
           AND COALESCE(list_id, -1) = COALESCE(?2, -1)",
        (&new.scheduled_date, new.list_id),
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO tasks (title, description_md, list_id, scheduled_date, time,
                            color, sort_order, parent_task_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        (
            title,
            &new.description_md,
            new.list_id,
            &new.scheduled_date,
            &new.time,
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
        conn.execute(
            "UPDATE tasks SET scheduled_date = ?1 WHERE id = ?2",
            (date, id),
        )?;
    }
    if let Some(time) = &patch.time {
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
    task_get(conn, id)
}

pub fn task_delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
    Ok(())
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

        task_delete(&conn, parent.id).unwrap();
        assert!(task_get(&conn, sub.id).is_err());
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
        let list = list_create(&conn, "Inbox", None).unwrap();
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
