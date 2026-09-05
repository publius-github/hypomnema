//! Two-way text mirror of the manual tasks under `<vault>/.hypomnema/tasks/`:
//! one Markdown file per list (its backlog) plus `scheduled.md` with the
//! dated tasks from today onward, grouped by date. The files are meant
//! for bulk editing: the app rewrites them after every change, and a
//! watcher imports outside edits back into the database.
//!
//! Only manual tasks are mirrored. Generated tasks (recurring, scheduled
//! events, birthdays) already have a text source of truth in config/*.yml
//! and mirroring them here would put two authorities in conflict.
//!
//! Sync protocol per line: the trailing `^<id>` is the stable key. A
//! line keeping its id updates that task, a line without an id creates a
//! task, and a task whose line disappeared from its file is deleted
//! (soft delete - restorable until the engine purges it after 24h).
//!
//! With `config.tasks_mirror_ids` off the key is left out of the files
//! (they read as plain checklists) and a line is matched back to its
//! task by title instead - editing the text of a line then replaces the
//! task rather than renaming it.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::{Error, Result};
use crate::tasks::{self, NewTask, Task, TaskPatch};

const SCHEDULED_MARKER: &str = "<!-- hypomnema:scheduled -->";
const LIST_MARKER_PREFIX: &str = "<!-- hypomnema:list:";

const FORMAT_HELP: &str = "<!-- Bulk-editable task mirror. One task per line: \"- [ ] title\"; [x] = done, [z] = postponed; an optional HH:MM right after the checkbox is the task time; \"! \" before the title marks priority; a two-space indented line is a subtask of the task above. The trailing ^id is the sync key: keep it when editing a line, leave it out on new lines, and deleting a whole line deletes that task. Recurring/scheduled/birthday tasks are not mirrored here - edit the YAML files in .hypomnema/config/ instead. -->";

/// Same help, for vaults with the sync keys turned off: without an id a
/// line is matched by its text, which changes what editing one means.
const FORMAT_HELP_NO_IDS: &str = "<!-- Bulk-editable task mirror. One task per line: \"- [ ] title\"; [x] = done, [z] = postponed; an optional HH:MM right after the checkbox is the task time; \"! \" before the title marks priority; a two-space indented line is a subtask of the task above. Lines carry no sync key here (Settings > Files), so a line is matched to its task by text: retyping a title replaces the task, and deleting a whole line deletes it. Recurring/scheduled/birthday tasks are not mirrored here - edit the YAML files in .hypomnema/config/ instead. -->";

fn list_marker(id: i64) -> String {
    format!("{LIST_MARKER_PREFIX}{id} -->")
}

/// A list name turned into a safe file stem.
fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();
    if cleaned.is_empty() {
        "list".into()
    } else {
        cleaned
    }
}

fn render_line(task: &Task, indent: usize, ids: bool) -> String {
    let mark = match task.status.as_str() {
        "done" => "x",
        "postponed" => "z",
        _ => " ",
    };
    let mut line = format!("{}- [{mark}] ", "  ".repeat(indent));
    if let Some(time) = &task.time {
        line.push_str(time);
        line.push(' ');
    }
    if task.priority {
        line.push_str("! ");
    }
    line.push_str(task.title.trim());
    if ids {
        line.push_str(&format!(" ^{}", task.id));
    }
    line
}

/// UI-like order inside a group: timed tasks first by time, then the
/// manual sort order.
fn ui_order(tasks: &mut [&Task]) {
    tasks.sort_by(|a, b| {
        (a.time.is_none(), &a.time, a.sort_order, a.id).cmp(&(
            b.time.is_none(),
            &b.time,
            b.sort_order,
            b.id,
        ))
    });
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

/// Rewrites the mirror files from the database. Returns every managed
/// file with its content (changed or not) so the caller can update the
/// self-write suppression map for the watcher. Paths in `skip` are left
/// untouched and excluded from the result: the watcher passes the files
/// whose import just failed, so a canonical rewrite never clobbers an
/// edit the user still has to fix.
pub fn export(
    conn: &Connection,
    tasks_dir: &Path,
    today: &str,
    skip: &HashSet<PathBuf>,
    ids: bool,
) -> Result<Vec<(PathBuf, String)>> {
    let help = if ids { FORMAT_HELP } else { FORMAT_HELP_NO_IDS };
    fs::create_dir_all(tasks_dir)?;
    let lists = tasks::lists_all(conn)?;
    let parents = tasks::manual_parent_tasks(conn)?;
    let mut subs: HashMap<i64, Vec<&Task>> = HashMap::new();
    let all_subs = tasks::subtasks_all(conn)?;
    for sub in &all_subs {
        if let Some(pid) = sub.parent_task_id {
            subs.entry(pid).or_default().push(sub);
        }
    }

    let mut written: Vec<(PathBuf, String)> = Vec::new();
    let mut expected: HashSet<PathBuf> = HashSet::new();
    // "scheduled" is reserved for the dated file
    let mut used_names: HashSet<String> = HashSet::from(["scheduled".to_string()]);

    for list in &lists {
        let mut backlog: Vec<&Task> = parents
            .iter()
            .filter(|t| t.scheduled_date.is_none() && t.list_id == Some(list.id))
            .collect();
        // engine-created lists earn a file only when they actually hold
        // a manual backlog, like they earn a dashboard column
        if list.auto && backlog.is_empty() {
            continue;
        }
        ui_order(&mut backlog);
        let mut name = sanitize_name(&list.name);
        if !used_names.insert(name.to_lowercase()) {
            name = format!("{name} ({})", list.id);
            used_names.insert(name.to_lowercase());
        }
        let mut content = format!("{}\n{help}\n\n", list_marker(list.id));
        for task in &backlog {
            content.push_str(&render_line(task, 0, ids));
            content.push('\n');
            for sub in subs.get(&task.id).into_iter().flatten() {
                content.push_str(&render_line(sub, 1, ids));
                content.push('\n');
            }
        }
        let path = tasks_dir.join(format!("{name}.md"));
        expected.insert(path.clone());
        if !skip.contains(&path) {
            write_if_changed(&path, &content)?;
            written.push((path, content));
        }
    }

    // scheduled.md: manual dated tasks from today onward (older done
    // days belong to History; older undone tasks are carried to today
    // by the engine anyway)
    let mut by_date: BTreeMap<&str, Vec<&Task>> = BTreeMap::new();
    for task in &parents {
        if let Some(date) = &task.scheduled_date {
            if date.as_str() >= today {
                by_date.entry(date).or_default().push(task);
            }
        }
    }
    let mut content = format!("{SCHEDULED_MARKER}\n{help}\n");
    for (date, group) in &mut by_date {
        ui_order(group);
        content.push_str(&format!("\n## {date}\n\n"));
        for task in group.iter() {
            content.push_str(&render_line(task, 0, ids));
            content.push('\n');
            for sub in subs.get(&task.id).into_iter().flatten() {
                content.push_str(&render_line(sub, 1, ids));
                content.push('\n');
            }
        }
    }
    let path = tasks_dir.join("scheduled.md");
    expected.insert(path.clone());
    if !skip.contains(&path) {
        write_if_changed(&path, &content)?;
        written.push((path, content));
    }

    // drop managed files whose list is gone (archived, renamed); files
    // without our marker are left alone
    if let Ok(entries) = fs::read_dir(tasks_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") || expected.contains(&path) {
                continue;
            }
            let first = fs::read_to_string(&path)
                .ok()
                .and_then(|c| c.lines().next().map(str::to_string))
                .unwrap_or_default();
            if first.trim().starts_with(LIST_MARKER_PREFIX) || first.trim() == SCHEDULED_MARKER {
                let _ = fs::remove_file(&path);
            }
        }
    }
    Ok(written)
}

struct Line {
    status: &'static str,
    time: Option<String>,
    priority: bool,
    title: String,
    id: Option<i64>,
}

struct Entry {
    date: Option<String>,
    line: Line,
    subs: Vec<Line>,
}

fn parse_task_line(t: &str) -> std::result::Result<Line, String> {
    let (status, rest) = if let Some(r) = t.strip_prefix("- [ ] ") {
        ("todo", r)
    } else if let Some(r) = t
        .strip_prefix("- [x] ")
        .or_else(|| t.strip_prefix("- [X] "))
    {
        ("done", r)
    } else if let Some(r) = t
        .strip_prefix("- [z] ")
        .or_else(|| t.strip_prefix("- [Z] "))
        // [>] is what versions before 0.41 wrote; still read, never written
        .or_else(|| t.strip_prefix("- [>] "))
    {
        ("postponed", r)
    } else if t.starts_with("- [") {
        return Err(format!(
            "unrecognized checkbox in '{t}' (use [ ], [x] or [z])"
        ));
    } else if let Some(r) = t.strip_prefix("- ") {
        // a plain bullet is accepted as a new open task (bulk paste)
        ("todo", r)
    } else {
        return Err(format!("cannot parse '{t}' - expected '- [ ] title'"));
    };

    let mut rest = rest.trim();
    let mut id = None;
    if let Some(pos) = rest.rfind(" ^") {
        let cand = &rest[pos + 2..];
        if !cand.is_empty() && cand.bytes().all(|b| b.is_ascii_digit()) {
            id = cand.parse::<i64>().ok();
            rest = rest[..pos].trim_end();
        }
    }
    let mut time = None;
    let b = rest.as_bytes();
    if b.len() >= 5
        && b[0].is_ascii_digit()
        && b[1].is_ascii_digit()
        && b[2] == b':'
        && b[3].is_ascii_digit()
        && b[4].is_ascii_digit()
        && (b.len() == 5 || b[5] == b' ')
    {
        time = Some(rest[..5].to_string());
        rest = rest[5..].trim_start();
    }
    let mut priority = false;
    if let Some(r) = rest.strip_prefix("! ") {
        priority = true;
        rest = r.trim_start();
    }
    let title = rest.trim();
    if title.is_empty() {
        return Err(format!("task line '{t}' has no title"));
    }
    Ok(Line {
        status,
        time,
        priority,
        title: title.to_string(),
        id,
    })
}

/// Parses a mirror file. Strict on purpose: an unparseable line aborts
/// the whole import (nothing is applied), because silently skipping a
/// line would delete the task it referred to.
fn parse_content(content: &str, scheduled: bool) -> Result<Vec<Entry>> {
    let mut entries: Vec<Entry> = Vec::new();
    let mut date: Option<String> = None;
    for (i, raw) in content.lines().enumerate() {
        let n = i + 1;
        let t = raw.trim();
        if t.is_empty() || t.starts_with("<!--") {
            continue;
        }
        if let Some(heading) = t.strip_prefix('#') {
            if !scheduled {
                continue; // free-form headings allowed in list files
            }
            let cand = heading.trim_start_matches('#').trim();
            let parsed = chrono::NaiveDate::parse_from_str(cand, "%Y-%m-%d").map_err(|_| {
                Error::State(format!(
                    "line {n}: expected a '## YYYY-MM-DD' date heading, got '{cand}'"
                ))
            })?;
            date = Some(parsed.format("%Y-%m-%d").to_string());
            continue;
        }
        let indent = raw.len() - raw.trim_start().len();
        let line = parse_task_line(t).map_err(|msg| Error::State(format!("line {n}: {msg}")))?;
        if indent > 0 {
            entries
                .last_mut()
                .ok_or_else(|| Error::State(format!("line {n}: subtask without a parent task")))?
                .subs
                .push(line);
        } else {
            if scheduled && date.is_none() {
                return Err(Error::State(format!(
                    "line {n}: task before any '## YYYY-MM-DD' heading"
                )));
            }
            entries.push(Entry {
                date: date.clone(),
                line,
                subs: Vec::new(),
            });
        }
    }
    Ok(entries)
}

enum Scope {
    List(i64),
    Scheduled,
}

/// Applies an edited mirror file to the database. Returns whether
/// anything actually changed. `today` bounds the scheduled scope: only
/// tasks the file is responsible for can be deleted by their absence.
pub fn import_file(
    conn: &Connection,
    path: &Path,
    content: &str,
    today: &str,
    ids: bool,
) -> Result<bool> {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("list")
        .to_string();
    let first = content.lines().next().unwrap_or("").trim().to_string();
    let lists = tasks::lists_all(conn)?;
    let mut changed = false;

    let scope = if let Some(raw) = first.strip_prefix(LIST_MARKER_PREFIX) {
        let digits: String = raw.chars().take_while(|c| c.is_ascii_digit()).collect();
        let id: i64 = digits
            .parse()
            .map_err(|_| Error::State(format!("{stem}.md: malformed list marker")))?;
        let list = lists
            .iter()
            .find(|l| l.id == id)
            .ok_or_else(|| Error::State(format!("{stem}.md: unknown list id {id}")))?;
        // renaming the file renames the list
        if sanitize_name(&list.name) != stem {
            tasks::list_rename(conn, id, &stem)?;
            changed = true;
        }
        Scope::List(id)
    } else if first == SCHEDULED_MARKER {
        Scope::Scheduled
    } else {
        // a brand-new file becomes a new list named after it
        match lists.iter().find(|l| l.name == stem) {
            Some(list) => Scope::List(list.id),
            None => {
                changed = true;
                Scope::List(tasks::list_create(conn, &stem, None, false)?.id)
            }
        }
    };

    let entries = parse_content(content, matches!(scope, Scope::Scheduled))?;

    // NOTE: no outer transaction - task_update opens its own; the parse
    // above already rejected every malformed line, so a mid-apply error
    // (disk, constraint) can only leave a prefix applied, which the
    // following export normalizes back into the file.
    let parents = tasks::manual_parent_tasks(conn)?;
    let by_id: HashMap<i64, &Task> = parents.iter().map(|t| (t.id, t)).collect();
    let scope_ids: HashSet<i64> = parents
        .iter()
        .filter(|t| match &scope {
            Scope::List(id) => t.scheduled_date.is_none() && t.list_id == Some(*id),
            Scope::Scheduled => t
                .scheduled_date
                .as_deref()
                .map(|d| d >= today)
                .unwrap_or(false),
        })
        .map(|t| t.id)
        .collect();
    let all_subs = tasks::subtasks_all(conn)?;
    let mut subs_by_parent: HashMap<i64, Vec<&Task>> = HashMap::new();
    for sub in &all_subs {
        if let Some(pid) = sub.parent_task_id {
            subs_by_parent.entry(pid).or_default().push(sub);
        }
    }

    // Which task each line stands for. An explicit ^id always wins;
    // with the keys turned off the files carry none, so a line claims
    // the first not-yet-claimed task in scope with the same text.
    let mut resolved: Vec<Option<i64>> = entries
        .iter()
        .map(|entry| entry.line.id.filter(|id| by_id.contains_key(id)))
        .collect();
    if !ids {
        let mut claimed: HashSet<i64> = resolved.iter().flatten().copied().collect();
        for (slot, entry) in resolved.iter_mut().zip(entries.iter()) {
            if slot.is_some() {
                continue;
            }
            *slot = parents
                .iter()
                .find(|task| {
                    scope_ids.contains(&task.id)
                        && !claimed.contains(&task.id)
                        && task.title == entry.line.title
                })
                .map(|task| task.id);
            if let Some(id) = slot {
                claimed.insert(*id);
            }
        }
    }

    let mut seen: HashSet<i64> = HashSet::new();
    let mut counters: HashMap<String, i64> = HashMap::new();
    for (entry, resolved_id) in entries.iter().zip(resolved.iter()) {
        let group = entry.date.clone().unwrap_or_default();
        let index = counters.entry(group).or_insert(0);
        let sort_order = *index;
        *index += 1;

        let existing = resolved_id.and_then(|id| by_id.get(&id).copied());
        let pid = match existing {
            Some(task) => {
                let mut patch = TaskPatch::default();
                let mut dirty = false;
                if task.title != entry.line.title {
                    patch.title = Some(entry.line.title.clone());
                    dirty = true;
                }
                if task.status != entry.line.status {
                    patch.status = Some(entry.line.status.to_string());
                    dirty = true;
                }
                if task.time != entry.line.time {
                    patch.time = Some(entry.line.time.clone());
                    dirty = true;
                }
                if task.priority != entry.line.priority {
                    patch.priority = Some(entry.line.priority);
                    dirty = true;
                }
                if task.sort_order != sort_order {
                    patch.sort_order = Some(sort_order);
                    dirty = true;
                }
                match &scope {
                    Scope::List(id) => {
                        if task.list_id != Some(*id) {
                            patch.list_id = Some(Some(*id));
                            dirty = true;
                        }
                        if task.scheduled_date.is_some() {
                            patch.scheduled_date = Some(None);
                            dirty = true;
                        }
                    }
                    Scope::Scheduled => {
                        if task.scheduled_date != entry.date {
                            patch.scheduled_date = Some(entry.date.clone());
                            dirty = true;
                        }
                    }
                }
                if dirty {
                    tasks::task_update(conn, task.id, &patch)?;
                    changed = true;
                }
                task.id
            }
            None => {
                let created = tasks::task_create(
                    conn,
                    &NewTask {
                        title: entry.line.title.clone(),
                        list_id: match &scope {
                            Scope::List(id) => Some(*id),
                            Scope::Scheduled => None,
                        },
                        scheduled_date: entry.date.clone(),
                        time: entry.line.time.clone(),
                        ..Default::default()
                    },
                )?;
                let mut patch = TaskPatch {
                    sort_order: Some(sort_order),
                    ..Default::default()
                };
                if entry.line.status != "todo" {
                    patch.status = Some(entry.line.status.to_string());
                }
                if entry.line.priority {
                    patch.priority = Some(true);
                }
                tasks::task_update(conn, created.id, &patch)?;
                changed = true;
                created.id
            }
        };
        seen.insert(pid);

        let existing_subs: Vec<&Task> = subs_by_parent.get(&pid).cloned().unwrap_or_default();
        let sub_by_id: HashMap<i64, &Task> = existing_subs.iter().map(|t| (t.id, *t)).collect();
        let mut sub_seen: HashSet<i64> = HashSet::new();
        for (i, sub) in entry.subs.iter().enumerate() {
            let matched = sub
                .id
                .and_then(|id| sub_by_id.get(&id).copied())
                .or_else(|| {
                    if ids {
                        return None;
                    }
                    existing_subs
                        .iter()
                        .find(|existing| {
                            !sub_seen.contains(&existing.id) && existing.title == sub.title
                        })
                        .copied()
                });
            match matched {
                Some(existing_sub) => {
                    let mut patch = TaskPatch::default();
                    let mut dirty = false;
                    if existing_sub.title != sub.title {
                        patch.title = Some(sub.title.clone());
                        dirty = true;
                    }
                    if existing_sub.status != sub.status {
                        patch.status = Some(sub.status.to_string());
                        dirty = true;
                    }
                    if existing_sub.sort_order != i as i64 {
                        patch.sort_order = Some(i as i64);
                        dirty = true;
                    }
                    if dirty {
                        tasks::task_update(conn, existing_sub.id, &patch)?;
                        changed = true;
                    }
                    sub_seen.insert(existing_sub.id);
                }
                None => {
                    let created = tasks::task_create(
                        conn,
                        &NewTask {
                            title: sub.title.clone(),
                            parent_task_id: Some(pid),
                            ..Default::default()
                        },
                    )?;
                    let mut patch = TaskPatch {
                        sort_order: Some(i as i64),
                        ..Default::default()
                    };
                    if sub.status != "todo" {
                        patch.status = Some(sub.status.to_string());
                    }
                    tasks::task_update(conn, created.id, &patch)?;
                    changed = true;
                    sub_seen.insert(created.id);
                }
            }
        }
        for existing_sub in existing_subs {
            if !sub_seen.contains(&existing_sub.id) {
                tasks::task_delete(conn, existing_sub.id)?;
                changed = true;
            }
        }
    }

    for id in scope_ids {
        if !seen.contains(&id) {
            tasks::task_delete(conn, id)?;
            changed = true;
        }
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::tasks::{list_create, task_create, task_get, task_update};

    const TODAY: &str = "2026-08-29";

    fn setup(tag: &str) -> (Connection, PathBuf) {
        let dir = std::env::temp_dir().join(format!("app-pkb-mirror-{tag}"));
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

        let written = export(&conn, &dir, TODAY, &HashSet::new(), true).unwrap();
        assert_eq!(written.len(), 2); // Groceries.md + scheduled.md
        for (path, content) in &written {
            assert!(!import_file(&conn, path, content, TODAY, true).unwrap());
        }
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
        assert!(import_file(&conn, &path, &content, TODAY, true).unwrap());

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
        assert!(import_file(&conn, &path, &content, TODAY, true).unwrap());

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
        assert!(import_file(&conn, &path, "- [ ] some book\n", TODAY, true).unwrap());
        let lists = tasks::lists_all(&conn).unwrap();
        let list = lists.iter().find(|l| l.name == "Reading").unwrap();
        let parents = tasks::manual_parent_tasks(&conn).unwrap();
        assert!(parents
            .iter()
            .any(|t| t.list_id == Some(list.id) && t.title == "some book"));

        // a bad checkbox aborts the whole file: nothing gets deleted
        let bad = format!("{}\n- [?] broken\n", list_marker(list.id));
        assert!(import_file(&conn, &path, &bad, TODAY, true).is_err());
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

        let written = export(&conn, &dir, TODAY, &HashSet::new(), false).unwrap();
        let (path, content) = written
            .iter()
            .find(|(p, _)| p.file_name().unwrap() == "Errands.md")
            .unwrap();
        assert!(!content.contains(&format!("^{}", parent.id)));
        assert!(!import_file(&conn, path, content, TODAY, false).unwrap());
        assert_eq!(tasks::manual_parent_tasks(&conn).unwrap().len(), 1);
        assert_eq!(tasks::subtasks_all(&conn).unwrap().len(), 1);

        // ticking the box off the file still reaches the same task
        let edited = content.replace("- [ ] post office", "- [x] post office");
        assert!(import_file(&conn, path, &edited, TODAY, false).unwrap());
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
        assert!(import_file(&conn, &path, &content, TODAY, true).unwrap());
        let parents = tasks::manual_parent_tasks(&conn).unwrap();
        assert_eq!(parents[0].status, "postponed");

        let written = export(&conn, &dir, TODAY, &HashSet::new(), true).unwrap();
        let (_, out) = written
            .iter()
            .find(|(p, _)| p.file_name().unwrap() == "Later.md")
            .unwrap();
        assert!(out.contains("- [z] old marker"));
        assert!(!out.contains("- [>]"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_removes_files_of_archived_lists_and_keeps_foreign_md() {
        let (conn, dir) = setup("stale");
        let list = list_create(&conn, "Temp", None, false).unwrap();
        export(&conn, &dir, TODAY, &HashSet::new(), true).unwrap();
        assert!(dir.join("Temp.md").exists());
        fs::write(dir.join("notes.md"), "my own file\n").unwrap();

        tasks::list_archive(&conn, list.id).unwrap();
        export(&conn, &dir, TODAY, &HashSet::new(), true).unwrap();
        assert!(!dir.join("Temp.md").exists());
        assert!(dir.join("notes.md").exists());
        assert!(dir.join("scheduled.md").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
