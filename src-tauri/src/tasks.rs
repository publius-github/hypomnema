use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{Error, Result};
use crate::ids;

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
    /// "todo" (working queue: done tasks swept overnight) or
    /// "checklist" (checked items stay until unchecked; no postponed
    /// state in the UI).
    #[ts(type = "\"todo\" | \"checklist\"")]
    pub kind: String,
    /// Group this list is folded into, if any: the list panel then
    /// shows the group instead of the list.
    #[ts(type = "number | null")]
    pub group_id: Option<i64>,
}

/// A named folder in the list panel: the panel shows the group, its
/// member lists live behind a drill-in.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ListGroup {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    #[ts(type = "number")]
    pub sort_order: i64,
    pub color: Option<String>,
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
    /// See [`STATUSES`].
    #[ts(type = "\"todo\" | \"done\" | \"postponed\" | \"waiting\" | \"dropped\"")]
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
        kind: row.get("kind")?,
        group_id: row.get("group_id")?,
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

/// The active (non-archived) list holding this name, if any. Names are
/// unique among active lists only - archived ones keep their name but
/// never block a new or renamed list (migration 015).
fn active_list_named(conn: &Connection, name: &str) -> Result<Option<List>> {
    conn.query_row(
        "SELECT * FROM lists WHERE name = ?1 AND archived = 0",
        [name],
        row_to_list,
    )
    .optional()
    .map_err(Into::into)
}

/// Folds an auto list into `target`: its tasks move over and the row
/// goes away. An auto list is just the engine's holder for a `{List}`
/// prefix, so a user list taking that name takes its tasks too - which
/// is what `list_ensure` would have done had the user list existed
/// first.
fn absorb_auto_list(conn: &Connection, auto_id: i64, target_id: i64) -> Result<()> {
    conn.execute(
        "UPDATE tasks SET list_id = ?1 WHERE list_id = ?2",
        (target_id, auto_id),
    )?;
    conn.execute("DELETE FROM lists WHERE id = ?1", [auto_id])?;
    Ok(())
}

pub fn list_create(conn: &Connection, name: &str, color: Option<&str>, auto: bool) -> Result<List> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::State("list name cannot be empty".into()));
    }
    // an existing auto list of that name IS this list as far as the
    // engine is concerned: adopt it instead of failing on the name
    if !auto {
        if let Some(existing) = active_list_named(conn, name)? {
            if !existing.auto {
                return Err(Error::State(format!(
                    "a list named \"{name}\" already exists"
                )));
            }
            conn.execute(
                "UPDATE lists SET auto = 0, color = COALESCE(?2, color) WHERE id = ?1",
                (existing.id, color),
            )?;
            return Ok(List {
                auto: false,
                color: color.map(str::to_owned).or(existing.color),
                ..existing
            });
        }
    }
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM lists",
        [],
        |row| row.get(0),
    )?;
    let id = ids::fresh(conn, ids::Table::Lists, Some(&ids::list_seed(name)))?;
    // an auto list is the engine's doing, not a decision anyone made:
    // stamped as untouched, so a real edit on another device outranks it
    let (stamp_at, stamp_by) = if auto {
        (Some(ids::UNTOUCHED_AT), Some(ids::UNTOUCHED_BY))
    } else {
        (None, None)
    };
    conn.execute(
        "INSERT INTO lists (id, name, sort_order, color, auto, updated_at, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, name, next, color, auto as i64, stamp_at, stamp_by],
    )?;
    conn.query_row("SELECT * FROM lists WHERE id = ?1", [id], row_to_list)
        .map_err(Into::into)
}

/// Returns the list with the given name, creating it if missing.
/// Backs the `{List Name}` prefix of YAML items (req. 3). An archived
/// match is revived as an auto list: its tasks must keep grouping in
/// the day columns, and the auto flag keeps it out of the list zone.
pub fn list_ensure(conn: &Connection, name: &str) -> Result<List> {
    // active lists win over archived namesakes: only one of them can
    // be active, and that is the list the user is looking at
    let existing = conn
        .query_row(
            "SELECT * FROM lists WHERE name = ?1 ORDER BY archived, id LIMIT 1",
            [name],
            row_to_list,
        )
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

/// Returns the quick-capture target list, creating it if missing. The
/// capture surface must always be visible and easy to spot, so unlike
/// `list_ensure` the list is created manual + favorite (never hidden
/// while empty, sorts first in the list zone). An existing active list
/// of that name - manual or auto, matched case-insensitively - is
/// adopted as-is; an auto match is promoted to a manual favorite.
pub fn ensure_inbox(conn: &Connection, name: &str) -> Result<List> {
    let name = name.trim();
    let name = if name.is_empty() { "Inbox" } else { name };
    let existing = conn
        .query_row(
            "SELECT * FROM lists
             WHERE name = ?1 COLLATE NOCASE AND archived = 0
             ORDER BY auto, id LIMIT 1",
            [name],
            row_to_list,
        )
        .optional()?;
    match existing {
        Some(list) if list.auto => {
            conn.execute(
                "UPDATE lists SET auto = 0, favorite = 1 WHERE id = ?1",
                [list.id],
            )?;
            Ok(List {
                auto: false,
                favorite: true,
                ..list
            })
        }
        Some(list) => Ok(list),
        None => {
            let list = list_create(conn, name, None, false)?;
            list_set_favorite(conn, list.id, true)?;
            Ok(List {
                favorite: true,
                ..list
            })
        }
    }
}

/// Renames a list. Only another *active* list can block the name - an
/// archived namesake is history the user cannot see, and an auto list
/// of that name is absorbed (same rule as `list_create`).
pub fn list_rename(conn: &Connection, id: i64, name: &str) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::State("list name cannot be empty".into()));
    }
    // absorbing and renaming are one step: a failure between them would
    // leave the tasks moved and the list still under its old name
    let tx = conn.unchecked_transaction()?;
    if let Some(existing) = active_list_named(&tx, name)? {
        if existing.id != id {
            if !existing.auto {
                return Err(Error::State(format!(
                    "a list named \"{name}\" already exists"
                )));
            }
            absorb_auto_list(&tx, existing.id, id)?;
        }
    }
    let updated = tx.execute("UPDATE lists SET name = ?1 WHERE id = ?2", (name, id))?;
    if updated == 0 {
        return Err(Error::State(format!("list {id} not found")));
    }
    tx.commit()?;
    Ok(())
}

/// List metadata from the list dialog: color (None clears it),
/// description and kind ("todo" | "checklist").
pub fn list_set_meta(
    conn: &Connection,
    id: i64,
    color: Option<&str>,
    description: &str,
    kind: &str,
) -> Result<()> {
    if !["todo", "checklist"].contains(&kind) {
        return Err(Error::State(format!("invalid list kind: {kind}")));
    }
    let updated = conn.execute(
        "UPDATE lists SET color = ?1, description = ?2, kind = ?3 WHERE id = ?4",
        (color, description, kind, id),
    )?;
    if updated == 0 {
        return Err(Error::State(format!("list {id} not found")));
    }
    Ok(())
}

/// Checks or unchecks every task of a list at once (the checklist bulk
/// actions in the list dialog): top-level tasks of the list and their
/// subtasks. Postponed rows are reset along with the rest - the bulk
/// action defines the whole list's state. Returns how many rows changed.
pub fn list_set_all_statuses(conn: &Connection, id: i64, done: bool) -> Result<usize> {
    let status = if done { "done" } else { "todo" };
    let completed_at = done.then(|| Utc::now().to_rfc3339());
    Ok(conn.execute(
        "UPDATE tasks SET status = ?1, completed_at = ?2
         WHERE archived_at IS NULL
           AND status != ?1
           AND (list_id = ?3
                OR parent_task_id IN (SELECT id FROM tasks
                                      WHERE list_id = ?3 AND archived_at IS NULL))",
        (status, completed_at, id),
    )?)
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

fn row_to_group(row: &Row) -> rusqlite::Result<ListGroup> {
    Ok(ListGroup {
        id: row.get("id")?,
        name: row.get("name")?,
        sort_order: row.get("sort_order")?,
        color: row.get("color")?,
    })
}

pub fn groups_all(conn: &Connection) -> Result<Vec<ListGroup>> {
    let mut stmt = conn.prepare("SELECT * FROM list_groups ORDER BY sort_order, name")?;
    let groups = stmt
        .query_map([], row_to_group)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(groups)
}

pub fn group_create(conn: &Connection, name: &str) -> Result<ListGroup> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::State("group name cannot be empty".into()));
    }
    let clash: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM list_groups WHERE name = ?1)",
        [name],
        |row| row.get(0),
    )?;
    if clash {
        return Err(Error::State(format!(
            "a group named \"{name}\" already exists"
        )));
    }
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM list_groups",
        [],
        |row| row.get(0),
    )?;
    let id = ids::fresh(conn, ids::Table::ListGroups, Some(&ids::group_seed(name)))?;
    conn.execute(
        "INSERT INTO list_groups (id, name, sort_order) VALUES (?1, ?2, ?3)",
        (id, name, next),
    )?;
    conn.query_row(
        "SELECT * FROM list_groups WHERE id = ?1",
        [id],
        row_to_group,
    )
    .map_err(Into::into)
}

/// Rename and recolor in one step, mirroring the group dialog's Save.
pub fn group_set_meta(conn: &Connection, id: i64, name: &str, color: Option<&str>) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::State("group name cannot be empty".into()));
    }
    let clash: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM list_groups WHERE name = ?1 AND id != ?2)",
        (name, id),
        |row| row.get(0),
    )?;
    if clash {
        return Err(Error::State(format!(
            "a group named \"{name}\" already exists"
        )));
    }
    let updated = conn.execute(
        "UPDATE list_groups SET name = ?1, color = ?2 WHERE id = ?3",
        (name, color, id),
    )?;
    if updated == 0 {
        return Err(Error::State(format!("group {id} not found")));
    }
    Ok(())
}

/// Deletes a group; its member lists return to the panel (the FK's
/// ON DELETE SET NULL clears their group_id).
pub fn group_delete(conn: &Connection, id: i64) -> Result<()> {
    let deleted = conn.execute("DELETE FROM list_groups WHERE id = ?1", [id])?;
    if deleted == 0 {
        return Err(Error::State(format!("group {id} not found")));
    }
    Ok(())
}

/// Moves a list into a group (or out of every group with None).
pub fn list_set_group(conn: &Connection, id: i64, group_id: Option<i64>) -> Result<()> {
    if let Some(gid) = group_id {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM list_groups WHERE id = ?1)",
            [gid],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(Error::State(format!("group {gid} not found")));
        }
    }
    let updated = conn.execute(
        "UPDATE lists SET group_id = ?1 WHERE id = ?2",
        (group_id, id),
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
    // the name is free among archived lists, so a restore can collide
    // with a list created in the meantime
    let name: String = conn
        .query_row("SELECT name FROM lists WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .optional()?
        .ok_or_else(|| Error::State(format!("list {id} not found")))?;
    if let Some(existing) = active_list_named(conn, &name)? {
        if existing.id != id {
            return Err(Error::State(format!(
                "a list named \"{name}\" already exists - rename it before restoring this one"
            )));
        }
    }
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
/// window, everything unscheduled (list zone), manual list tasks with
/// ANY date (they stay in their list column even when the date is far
/// outside the grid), and all their subtasks. Overdue carry-over (M2)
/// will move older tasks into the window before this query runs, so a
/// plain range filter is enough for the rest.
pub fn tasks_snapshot(conn: &Connection, start_date: &str, end_date: &str) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM tasks
         WHERE archived_at IS NULL
           AND (
             parent_task_id IS NOT NULL
             OR scheduled_date IS NULL
             OR (scheduled_date >= ?1 AND scheduled_date < ?2)
             OR (origin = 'manual' AND list_id IS NOT NULL)
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
         ORDER BY scheduled_date IS NULL, scheduled_date DESC, created_at DESC, id DESC
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

/// All live generated top-level tasks (recurring, scheduled events,
/// birthdays) - the agenda mirror's source set.
pub fn generated_parent_tasks(conn: &Connection) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM tasks
         WHERE archived_at IS NULL AND origin != 'manual' AND parent_task_id IS NULL
         ORDER BY scheduled_date, time IS NULL, time, sort_order, id",
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

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct TaskBacklinkHit {
    pub task: Task,
    pub preview: String,
}

/// Live top-level tasks whose title or description carries a [[wiki
/// link]] to the note. Links only - plain-text mentions inside short
/// imperative titles are nearly all noise. Newest tasks first, same cap
/// as the note scan.
pub fn backlinks(conn: &Connection, stem: &str, full_name: &str) -> Result<Vec<TaskBacklinkHit>> {
    let stem = stem.trim().to_lowercase();
    let full_name = full_name.trim().to_lowercase();
    if stem.is_empty() {
        return Ok(vec![]);
    }
    // cheap SQL prefilter; the real match is verified per line below
    let mut stmt = conn.prepare(
        "SELECT * FROM tasks
         WHERE archived_at IS NULL AND parent_task_id IS NULL
           AND (title LIKE '%[[%' OR description_md LIKE '%[[%')
         ORDER BY created_at DESC, id DESC LIMIT 500",
    )?;
    let candidates = stmt
        .query_map([], row_to_task)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut hits = Vec::new();
    for task in candidates {
        let preview: Option<String> = std::iter::once(task.title.as_str())
            .chain(task.description_md.lines())
            .find(|line| {
                crate::kb::wiki_targets(line)
                    .iter()
                    .any(|t| *t == stem || *t == full_name)
            })
            .map(|line| line.trim().chars().take(120).collect());
        if let Some(preview) = preview {
            hits.push(TaskBacklinkHit { task, preview });
            if hits.len() >= crate::kb::SEARCH_MAX_HITS {
                break;
            }
        }
    }
    Ok(hits)
}

/// A title is one Markdown mirror line: a newline inside it would split
/// the line in two and break the round trip.
fn normalize_title(title: &str) -> String {
    title
        .split(['\r', '\n'])
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn task_create(conn: &Connection, new: &NewTask) -> Result<Task> {
    let title = normalize_title(&new.title);
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
    let id = ids::fresh(conn, ids::Table::Tasks, None)?;
    conn.execute(
        "INSERT INTO tasks (id, title, description_md, list_id, scheduled_date, time,
                            color, sort_order, parent_task_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        (
            id,
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
    task_get(conn, id)
}

/// Every status a task can hold. `todo`, `postponed` and `waiting` (done
/// on the user's side, still waiting on someone else) are open: carried
/// over, listed as upcoming. `done` and `dropped` (not done, taken off
/// the plan) are closed: swept, pruned, never carried - and only `done`
/// counts as a completion. SQL spells the closed pair out as
/// `status IN ('done', 'dropped')`; the engine additionally never deletes
/// a `waiting` row as a duplicate, since the user has acted on it.
pub const STATUSES: &[&str] = &["todo", "done", "postponed", "waiting", "dropped"];

/// Done or dropped: nothing is left to act on.
pub fn is_closed(status: &str) -> bool {
    matches!(status, "done" | "dropped")
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
        if !STATUSES.contains(&status.as_str()) {
            return Err(Error::State(format!("invalid status: {status}")));
        }
        // the moment a task left the plan, for the sweeps and retention
        let completed_at = if is_closed(status) {
            Some(Utc::now().to_rfc3339())
        } else {
            None
        };
        // overdue survives the status cycle: cycling an overdue task
        // through done and back to todo must not silently drop the mark
        // (the UI hides it on done cards; the flag stays truthful)
        conn.execute(
            "UPDATE tasks SET status = ?1, completed_at = ?2 WHERE id = ?3",
            (status, completed_at, id),
        )?;
    }
    if let Some(title) = &patch.title {
        let title = normalize_title(title);
        if title.is_empty() {
            return Err(Error::State("task title cannot be empty".into()));
        }
        conn.execute("UPDATE tasks SET title = ?1 WHERE id = ?2", (title, id))?;
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct RuleRun {
    pub rule_key: String,
    pub period_key: String,
    pub generated_at: String,
}

/// Everything a task delete removed, in restorable form: the task rows
/// (parent first, then subtasks) plus the rule_runs ledger row of a
/// generated instance. Round-trips through the frontend so an Undo
/// toast can hand it back to `task_restore`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct DeletedTasks {
    pub tasks: Vec<Task>,
    pub rule_run: Option<RuleRun>,
}

/// Hard delete: the row and its subtasks disappear from the database as
/// if they never existed. For a generated instance the rule_runs ledger
/// row goes with it, so a still-current period regenerates on the next
/// engine run - deleting a generated task is never how you get rid of
/// it, editing its config file is. Returns what was removed so the
/// frontend can offer Undo.
pub fn task_delete(conn: &Connection, id: i64) -> Result<DeletedTasks> {
    let tx = conn.unchecked_transaction()?;
    let mut stmt = tx.prepare(
        "SELECT * FROM tasks WHERE id = ?1 OR parent_task_id = ?1
         ORDER BY parent_task_id IS NOT NULL, id",
    )?;
    let rows = stmt
        .query_map([id], row_to_task)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);
    let rule_run = tx
        .query_row(
            "SELECT r.rule_key, r.period_key, r.generated_at FROM rule_runs r
             JOIN tasks t ON t.rule_key = r.rule_key AND t.period_key = r.period_key
             WHERE t.id = ?1",
            [id],
            |row| {
                Ok(RuleRun {
                    rule_key: row.get(0)?,
                    period_key: row.get(1)?,
                    generated_at: row.get(2)?,
                })
            },
        )
        .optional()?;
    tx.execute(
        "DELETE FROM rule_runs
         WHERE (rule_key, period_key) IN
               (SELECT rule_key, period_key FROM tasks
                WHERE id = ?1 AND rule_key IS NOT NULL AND period_key IS NOT NULL)",
        [id],
    )?;
    tx.execute(
        "DELETE FROM tasks WHERE id = ?1 OR parent_task_id = ?1",
        [id],
    )?;
    tx.commit()?;
    Ok(DeletedTasks {
        tasks: rows,
        rule_run,
    })
}

/// Puts a just-deleted task (with its subtasks) back - the Undo of
/// `task_delete`. Original ids are kept while still free; an occupied id
/// gets a fresh one, with subtask parent links remapped. When the engine
/// already regenerated the same (rule, period) instance in the meantime
/// the restore is skipped (undoing then would duplicate the card) and an
/// empty vec comes back. A subtask whose parent vanished, or a list_id
/// whose list row is gone (auto-list absorb), degrade gracefully: the
/// row is skipped / the reference is cleared.
pub fn task_restore(conn: &Connection, deleted: &DeletedTasks) -> Result<Vec<Task>> {
    let tx = conn.unchecked_transaction()?;
    if let Some(run) = &deleted.rule_run {
        let regenerated: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM tasks
                           WHERE rule_key = ?1 AND period_key = ?2 AND archived_at IS NULL)",
            (&run.rule_key, &run.period_key),
            |row| row.get(0),
        )?;
        if regenerated {
            return Ok(vec![]);
        }
        tx.execute(
            "INSERT OR IGNORE INTO rule_runs (rule_key, period_key, generated_at)
             VALUES (?1, ?2, ?3)",
            (&run.rule_key, &run.period_key, &run.generated_at),
        )?;
    }
    let mut id_map: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    let mut restored = Vec::new();
    for task in &deleted.tasks {
        let parent = match task.parent_task_id {
            Some(pid) => match id_map.get(&pid) {
                Some(mapped) => Some(*mapped),
                // a subtask deleted alone: its parent must still be live
                None => {
                    let alive: bool = tx.query_row(
                        "SELECT EXISTS(SELECT 1 FROM tasks WHERE id = ?1)",
                        [pid],
                        |row| row.get(0),
                    )?;
                    if !alive {
                        continue;
                    }
                    Some(pid)
                }
            },
            None => None,
        };
        let list_id = match task.list_id {
            Some(lid) => {
                let exists: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM lists WHERE id = ?1)",
                    [lid],
                    |row| row.get(0),
                )?;
                exists.then_some(lid)
            }
            None => None,
        };
        let id_free: bool = tx.query_row(
            "SELECT NOT EXISTS(SELECT 1 FROM tasks WHERE id = ?1)",
            [task.id],
            |row| row.get(0),
        )?;
        let id = if id_free {
            task.id
        } else {
            ids::fresh(&tx, ids::Table::Tasks, None)?
        };
        tx.execute(
            "INSERT INTO tasks (id, title, description_md, list_id, scheduled_date, time,
                                status, color, sort_order, parent_task_id, created_at,
                                completed_at, overdue, origin, cadence, origin_date,
                                priority, rule_key, period_key, dow_label)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                     ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
            rusqlite::params![
                id,
                &task.title,
                &task.description_md,
                list_id,
                &task.scheduled_date,
                &task.time,
                &task.status,
                &task.color,
                task.sort_order,
                parent,
                &task.created_at,
                &task.completed_at,
                task.overdue as i64,
                &task.origin,
                &task.cadence,
                &task.origin_date,
                task.priority as i64,
                &task.rule_key,
                &task.period_key,
                &task.dow_label,
            ],
        )?;
        id_map.insert(task.id, id);
        restored.push(task_get(&tx, id)?);
    }
    tx.commit()?;
    Ok(restored)
}

/// Maintenance helper (Settings): removes every closed task (done or
/// dropped), with subtasks of closed parents. Soft delete, like task_delete: hard-deleting
/// a generated task would erase the tombstone that stops the engine from
/// regenerating a still-current period as a fresh todo. Checklist lists
/// are exempt: their checked items are state to keep, not history to
/// sweep.
pub fn tasks_delete_done(conn: &Connection) -> Result<usize> {
    // a subtask carries no list_id of its own; the parent's list decides
    Ok(conn.execute(
        "UPDATE tasks SET archived_at = ?1
         WHERE archived_at IS NULL
           AND NOT EXISTS (
                 SELECT 1 FROM lists l
                 WHERE l.kind = 'checklist'
                   AND l.id = COALESCE(tasks.list_id,
                                       (SELECT p.list_id FROM tasks p
                                        WHERE p.id = tasks.parent_task_id)))
           AND (status IN ('done', 'dropped')
                OR parent_task_id IN (SELECT id FROM tasks
                                      WHERE status IN ('done', 'dropped')
                                        AND archived_at IS NULL))",
        [Utc::now().to_rfc3339()],
    )?)
}

#[cfg(test)]
mod tests;
