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
    /// Favorite lists sort ahead of the rest in the list zone.
    pub favorite: bool,
    /// Free-text description shown in the list dialog.
    pub description: String,
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
    /// Firing cadence of the generating rule ("daily" | "weekly" |
    /// "monthly" | "yearly"); None for manual and one-off tasks.
    pub cadence: Option<String>,
    /// The date a generated task was originally scheduled for; unlike
    /// scheduled_date it survives overdue carry-over.
    pub origin_date: Option<String>,
    /// Priority tasks sit in their own group on top of a list column.
    pub priority: bool,
    /// Provenance of a generated task (diagnostics in the task dialog:
    /// which rule and period produced this instance).
    pub rule_key: Option<String>,
    pub period_key: Option<String>,
    /// "[SAT#1]"-style marker for recurring rules whose cron pins
    /// concrete weekdays; None for everything else.
    pub dow_label: Option<String>,
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
    pub priority: Option<bool>,
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
        cadence: row.get("cadence")?,
        origin_date: row.get("origin_date")?,
        priority: row.get::<_, i64>("priority")? != 0,
        rule_key: row.get("rule_key")?,
        period_key: row.get("period_key")?,
        dow_label: row.get("dow_label")?,
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
        favorite: row.get::<_, i64>("favorite")? != 0,
        description: row.get("description")?,
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

/// Cosmetic list metadata from the list dialog: color (None clears it)
/// and description.
pub fn list_set_meta(
    conn: &Connection,
    id: i64,
    color: Option<&str>,
    description: &str,
) -> Result<()> {
    let updated = conn.execute(
        "UPDATE lists SET color = ?1, description = ?2 WHERE id = ?3",
        (color, description, id),
    )?;
    if updated == 0 {
        return Err(Error::State(format!("list {id} not found")));
    }
    Ok(())
}

pub fn list_set_favorite(conn: &Connection, id: i64, favorite: bool) -> Result<()> {
    let updated = conn.execute(
        "UPDATE lists SET favorite = ?1 WHERE id = ?2",
        (favorite as i64, id),
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

pub fn lists_archived(conn: &Connection) -> Result<Vec<List>> {
    let mut stmt = conn.prepare("SELECT * FROM lists WHERE archived = 1 ORDER BY name")?;
    let lists = stmt
        .query_map([], row_to_list)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(lists)
}

/// Restores an archived list. The auto flag is cleared: an explicit
/// restore means the user wants the list visible in the list zone.
pub fn list_unarchive(conn: &Connection, id: i64) -> Result<()> {
    let updated = conn.execute(
        "UPDATE lists SET archived = 0, auto = 0 WHERE id = ?1",
        [id],
    )?;
    if updated == 0 {
        return Err(Error::State(format!("list {id} not found")));
    }
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

/// Substring search over titles and descriptions across the whole
/// history, newest dates first, unscheduled tasks last. Subtasks are
/// excluded; the parent is what the user looks for.
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
         WHERE (title LIKE ?1 ESCAPE '\\'
                OR description_md LIKE ?1 ESCAPE '\\')
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

/// All live manual top-level tasks - the source set of the text mirror
/// (backlog per list + scheduled days).
pub fn manual_parent_tasks(conn: &Connection) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM tasks
         WHERE archived_at IS NULL AND origin = 'manual' AND parent_task_id IS NULL
         ORDER BY sort_order, id",
    )?;
    let tasks = stmt
        .query_map([], row_to_task)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(tasks)
}

/// All live subtasks, ordered like the UI lists them under a parent.
pub fn subtasks_all(conn: &Connection) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM tasks
         WHERE archived_at IS NULL AND parent_task_id IS NOT NULL
         ORDER BY sort_order, id",
    )?;
    let tasks = stmt
        .query_map([], row_to_task)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(tasks)
}

pub fn task_create(conn: &Connection, new: &NewTask) -> Result<Task> {
    let title = new.title.trim().to_string();
    if title.is_empty() {
        return Err(Error::State("task title cannot be empty".into()));
    }
    // A {Category} prefix typed by the user is just a text label on the
    // task (rendered as a chip) - it never routes to or creates a list.
    // Lists are assigned only explicitly: the target column, the modal
    // dropdown or a drag. The engine's YAML {List} routing is separate
    // and stays in engine::parse_item.
    let list_id = new.list_id;
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
    if let Some(priority) = patch.priority {
        // the engine also clears the flag on generated tasks every pass,
        // but the API must refuse up front instead of silently reverting
        if priority {
            let origin: String =
                conn.query_row("SELECT origin FROM tasks WHERE id = ?1", [id], |row| {
                    row.get(0)
                })?;
            if origin != "manual" {
                return Err(Error::State(
                    "priority is only available on manual tasks; generated tasks mirror their config"
                        .into(),
                ));
            }
        }
        conn.execute(
            "UPDATE tasks SET priority = ?1 WHERE id = ?2",
            (priority as i64, id),
        )?;
    }
    tx.commit()?;
    task_get(conn, id)
}

/// Rewrites sort_order for the given tasks of a list to match the given
/// order (drag-to-reorder inside a list column). One transaction; ids
/// not belonging to the list are ignored.
pub fn list_reorder(conn: &Connection, list_id: i64, ordered_ids: &[i64]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt =
            tx.prepare("UPDATE tasks SET sort_order = ?1 WHERE id = ?2 AND list_id = ?3")?;
        for (index, id) in ordered_ids.iter().enumerate() {
            stmt.execute((index as i64, id, list_id))?;
        }
    }
    tx.commit()?;
    Ok(())
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

/// Maintenance helper (Settings): removes every task marked done, with
/// subtasks of done parents. Soft delete, like task_delete: hard-deleting
/// a generated task would erase the tombstone that stops the engine from
/// regenerating a still-current period as a fresh todo.
pub fn tasks_delete_done(conn: &Connection) -> Result<usize> {
    Ok(conn.execute(
        "UPDATE tasks SET archived_at = ?1
         WHERE archived_at IS NULL
           AND (status = 'done'
                OR parent_task_id IN (SELECT id FROM tasks
                                      WHERE status = 'done' AND archived_at IS NULL))",
        [Utc::now().to_rfc3339()],
    )?)
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
    fn priority_rejected_on_generated_tasks() {
        let conn = conn();
        conn.execute(
            "INSERT INTO tasks (title, created_at, origin, rule_key, period_key)
             VALUES ('gen', '2026-01-01T00:00:00Z', 'recurring', 'abc', '2026-08-28T06:00')",
            [],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        let result = task_update(
            &conn,
            id,
            &TaskPatch {
                priority: Some(true),
                ..Default::default()
            },
        );
        assert!(result.is_err());
        // clearing the flag stays allowed
        task_update(
            &conn,
            id,
            &TaskPatch {
                priority: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
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
