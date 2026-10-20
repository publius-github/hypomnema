//! Two-way text mirror of the manual tasks under `<vault>/.hypomnema/tasks/`:
//! one Markdown file per list (its backlog) plus `scheduled.md` with the
//! dated tasks from today onward, grouped by date. The files are meant
//! for bulk editing: the app rewrites them after every change, and a
//! watcher imports outside edits back into the database.
//!
//! Manual tasks are mirrored with full authority (per-list files and
//! scheduled.md). Generated tasks (recurring, scheduled events,
//! birthdays) keep their text source of truth in config/*.yml; agenda.md
//! mirrors their instances read-mostly - statuses, priority and time
//! sync back, titles/dates do not, and deleting lines changes nothing -
//! so a phone editing the vault over a file sync can drive the day
//! without a second authority over the YAML.
//!
//! Every export also stores a copy of each file under
//! `.hypomnema/state/mirror-base/` - the merge base. An import compares
//! the incoming file against that base and applies only the fields the
//! file actually changed, and deletes only tasks the base knew: a stale
//! file arriving from a file sync (any folder-sync client) neither clobbers
//! newer app-side edits nor deletes tasks it never saw.
//!
//! A list file's header also carries the list's group as a plain
//! `<!-- group: Name -->` line: without it a group is invisible from the
//! vault, and the tasks folder is where bulk edits happen. Editing that
//! line moves the list (creating the group when the name is new); an
//! empty name means no group, and a file with no group line at all
//! leaves the membership alone.
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

use crate::error::{Error, IoContext, Result};
use crate::tasks::{self, NewTask, Task, TaskPatch};

const SCHEDULED_MARKER: &str = "<!-- hypomnema:scheduled -->";
const AGENDA_MARKER: &str = "<!-- hypomnema:agenda -->";
const TODAY_MARKER: &str = "<!-- hypomnema:today -->";
const LIST_MARKER_PREFIX: &str = "<!-- hypomnema:list:";
/// The list's group, on its own comment line under the marker. Written
/// in plain words rather than an id because the point of it is to be
/// edited: a list's group is otherwise invisible from the vault, and the
/// tasks folder is where bulk edits happen.
const GROUP_PREFIX: &str = "<!-- group:";

const GROUP_HELP: &str = "<!-- ^ the list's group: type a name to move this list into that group (created if it does not exist yet), or leave it empty for no group. -->";

const TODAY_HELP: &str = "<!-- Read-only day sheet, regenerated on every change - edits here are ignored. Check tasks off in the app or in the other mirror files. -->";

const AGENDA_HELP: &str = "<!-- Agenda of generated tasks (recurring, scheduled events, birthdays) from today onward, grouped by day. Check a box ([x] done, [z] postponed, [xz] done but waiting, [zz] dropped (not done), [ ] open), set an HH:MM time after the checkbox or toggle the \"! \" priority mark and it syncs back. Title and date edits do NOT sync - the YAML files in .hypomnema/config/ own them. A new line without an id creates a manual task on that day; deleting lines changes nothing, the app rewrites this file. -->";

const FORMAT_HELP: &str = "<!-- Bulk-editable task mirror. One task per line: \"- [ ] title\"; [x] = done, [z] = postponed, [xz] = done but waiting, [zz] = dropped (not done); an optional HH:MM right after the checkbox is the task time; \"! \" before the title marks priority; a two-space indented line is a subtask of the task above. The trailing ^id is the sync key: keep it when editing a line, leave it out on new lines, and deleting a whole line deletes that task. Recurring/scheduled/birthday tasks are not mirrored here - edit the YAML files in .hypomnema/config/ instead. -->";

/// Same help, for vaults with the sync keys turned off: without an id a
/// line is matched by its text, which changes what editing one means.
const FORMAT_HELP_NO_IDS: &str = "<!-- Bulk-editable task mirror. One task per line: \"- [ ] title\"; [x] = done, [z] = postponed, [xz] = done but waiting, [zz] = dropped (not done); an optional HH:MM right after the checkbox is the task time; \"! \" before the title marks priority; a two-space indented line is a subtask of the task above. Lines carry no sync key here (Settings > Data), so a line is matched to its task by text: retyping a title replaces the task, and deleting a whole line deletes it. Recurring/scheduled/birthday tasks are not mirrored here - edit the YAML files in .hypomnema/config/ instead. -->";

fn list_marker(id: i64) -> String {
    format!("{LIST_MARKER_PREFIX}{id} -->")
}

fn group_line(name: Option<&str>) -> String {
    format!("{GROUP_PREFIX} {} -->", name.unwrap_or("").trim())
}

/// The group name a list file asks for: `None` when the file carries no
/// group line at all (an older export, or a hand-made file - leave the
/// membership alone), `Some("")` when the line is there but empty (no
/// group). Only the header is searched: a `<!-- group: -->` further down
/// is prose, not a directive.
fn parse_group_line(content: &str) -> Option<String> {
    content.lines().take(6).map(str::trim).find_map(|line| {
        line.strip_prefix(GROUP_PREFIX)
            .and_then(|rest| rest.strip_suffix("-->"))
            .map(|name| name.trim().to_string())
    })
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
        "waiting" => "xz",
        "dropped" => "zz",
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

/// Which optional mirror files an export writes - a snapshot of the
/// config's tasks_mirror_* switches.
pub struct ExportOptions {
    /// Trailing `^id` sync keys on mirrored lines.
    pub ids: bool,
    /// Write agenda.md with the generated instances.
    pub agenda: bool,
    /// `Some(days)` writes the read-only today.md day sheet covering
    /// that many days.
    pub today_file: Option<u32>,
    /// Leave a file alone when the disk copy differs from its merge base:
    /// that is an outside edit the watcher has not imported yet, and an
    /// app-side rewrite would lose it. The watcher itself turns this off,
    /// having just imported whatever the disk held.
    pub preserve_pending: bool,
}

/// `{X}` title prefix as the category, like the day columns and the
/// Calendar day list group it; the rest is the display text.
pub(crate) fn split_category(title: &str) -> (Option<&str>, &str) {
    let trimmed = title.trim_start();
    if let Some(rest) = trimmed.strip_prefix('{') {
        if let Some(end) = rest.find('}') {
            let category = rest[..end].trim();
            if !category.is_empty() {
                return (Some(category), rest[end + 1..].trim_start());
            }
        }
    }
    (None, title)
}

/// A mirror-style task line without the `^id` key (nothing in today.md
/// syncs back, so it carries no identity).
fn render_plain_line(task: &Task, title: &str) -> String {
    let mark = match task.status.as_str() {
        "done" => "x",
        "postponed" => "z",
        "waiting" => "xz",
        "dropped" => "zz",
        _ => " ",
    };
    let mut line = format!("- [{mark}] ");
    if let Some(time) = &task.time {
        line.push_str(time);
        line.push(' ');
    }
    if task.priority {
        line.push_str("! ");
    }
    line.push_str(title.trim());
    line.push('\n');
    line
}

/// Content of the read-only today.md day sheet: focus phrase, today's
/// reminders and schedule blocks, then Overdue and one section per
/// covered day with the tasks grouped by category ({X} prefix, else the
/// list name). Empty sections are omitted.
fn today_content(conn: &Connection, config_dir: &Path, today: &str, days: u32) -> Result<String> {
    let start = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d")
        .map_err(|_| Error::State(format!("invalid date '{today}'")))?;
    let dates: Vec<String> = (0..days.max(1) as i64)
        .map(|i| {
            (start + chrono::Duration::days(i))
                .format("%Y-%m-%d")
                .to_string()
        })
        .collect();
    let end_exclusive = (start + chrono::Duration::days(days.max(1) as i64))
        .format("%Y-%m-%d")
        .to_string();
    let context = crate::reminders::dashboard_context(conn, config_dir, &dates)?;
    let lists = tasks::lists_all(conn)?;
    let snapshot = tasks::tasks_snapshot(conn, today, &end_exclusive)?;
    let in_window = |t: &Task| {
        t.parent_task_id.is_none()
            && t.scheduled_date
                .as_deref()
                .map(|d| d >= today && d < end_exclusive.as_str())
                .unwrap_or(false)
    };
    let group_of = |t: &Task| -> String {
        let (category, _) = split_category(&t.title);
        category
            .map(str::to_string)
            .or_else(|| {
                t.list_id
                    .and_then(|id| lists.iter().find(|l| l.id == id).map(|l| l.name.clone()))
            })
            .unwrap_or_default()
    };

    let mut out = format!(
        "{TODAY_MARKER}\n{TODAY_HELP}\n\n# {}\n",
        start.format("%A, %Y-%m-%d")
    );
    if let Some(focus) = &context.focus {
        out.push_str(&format!("\n> {focus}\n"));
    }
    if let Some(day) = context.days.first() {
        if !day.reminders.is_empty() {
            out.push_str("\n## Reminders\n\n");
            for reminder in &day.reminders {
                out.push_str(&format!("- {reminder}\n"));
            }
        }
    }
    if !context.blocks.is_empty() {
        out.push_str("\n## Schedule\n\n");
        for block in &context.blocks {
            out.push_str(&format!(
                "- {} - {} {}\n",
                block.from, block.to, block.label
            ));
        }
    }
    // carried-over tasks sit on today wearing the overdue flag; they get
    // their own section instead of blending into the day's plan
    let overdue_open = |t: &Task| t.overdue && !tasks::is_closed(&t.status);
    let mut overdue: Vec<&Task> = snapshot
        .iter()
        .filter(|t| in_window(t) && overdue_open(t))
        .collect();
    if !overdue.is_empty() {
        ui_order(&mut overdue);
        out.push_str("\n## Overdue\n\n");
        for task in overdue {
            let (_, title) = split_category(&task.title);
            out.push_str(&render_plain_line(task, title));
        }
    }
    for (i, date) in dates.iter().enumerate() {
        let day_tasks: Vec<&Task> = snapshot
            .iter()
            .filter(|t| {
                in_window(t) && t.scheduled_date.as_deref() == Some(date) && !overdue_open(t)
            })
            .collect();
        if day_tasks.is_empty() {
            continue;
        }
        if i == 0 {
            out.push_str("\n## Today\n");
        } else {
            let day = start + chrono::Duration::days(i as i64);
            out.push_str(&format!("\n## {}\n", day.format("%A, %Y-%m-%d")));
        }
        // BTreeMap: uncategorized ("") first, then categories by name
        let mut groups: BTreeMap<String, Vec<&Task>> = BTreeMap::new();
        for task in day_tasks {
            groups.entry(group_of(task)).or_default().push(task);
        }
        for (category, mut group) in groups {
            ui_order(&mut group);
            if category.is_empty() {
                out.push('\n');
            } else {
                out.push_str(&format!("\n### {category}\n\n"));
            }
            for task in group {
                let (_, title) = split_category(&task.title);
                out.push_str(&render_plain_line(task, title));
            }
        }
    }
    Ok(out)
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

/// Is the disk copy an outside edit not yet imported? Only answerable
/// when a base exists: a file the app never exported has no pending edit.
fn has_pending_edit(path: &Path, base_dir: &Path) -> bool {
    let Some(name) = path.file_name() else {
        return false;
    };
    let Ok(base) = fs::read_to_string(base_dir.join(name)) else {
        return false;
    };
    fs::read_to_string(path).is_ok_and(|disk| disk != base)
}

/// One managed file's write, shared by every file the export emits.
fn write_managed(
    path: PathBuf,
    content: String,
    base_dir: &Path,
    skip: &HashSet<PathBuf>,
    preserve_pending: bool,
    written: &mut Vec<(PathBuf, String)>,
) -> Result<()> {
    if skip.contains(&path) {
        return Ok(());
    }
    if preserve_pending && has_pending_edit(&path, base_dir) {
        return Ok(());
    }
    write_if_changed(&path, &content)?;
    written.push((path, content));
    Ok(())
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
    base_dir: &Path,
    config_dir: &Path,
    today: &str,
    skip: &HashSet<PathBuf>,
    opts: &ExportOptions,
) -> Result<Vec<(PathBuf, String)>> {
    let ids = opts.ids;
    let help = if ids { FORMAT_HELP } else { FORMAT_HELP_NO_IDS };
    fs::create_dir_all(tasks_dir).at(tasks_dir)?;
    let lists = tasks::lists_all(conn)?;
    let groups = tasks::groups_all(conn)?;
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
    // "scheduled", "agenda" and "today" are reserved for the managed files
    let mut used_names: HashSet<String> = HashSet::from([
        "scheduled".to_string(),
        "agenda".to_string(),
        "today".to_string(),
    ]);

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
        let group_name = list
            .group_id
            .and_then(|gid| groups.iter().find(|g| g.id == gid))
            .map(|g| g.name.as_str());
        let mut content = format!(
            "{}\n{}\n{GROUP_HELP}\n{help}\n\n",
            list_marker(list.id),
            group_line(group_name)
        );
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
        write_managed(
            path,
            content,
            base_dir,
            skip,
            opts.preserve_pending,
            &mut written,
        )?;
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
    write_managed(
        path,
        content,
        base_dir,
        skip,
        opts.preserve_pending,
        &mut written,
    )?;

    // agenda.md: generated instances from today onward, statuses sync
    // back (see AGENDA_HELP); off = the file is cleaned up below
    if opts.agenda {
        let generated = tasks::generated_parent_tasks(conn)?;
        let mut by_date: BTreeMap<&str, Vec<&Task>> = BTreeMap::new();
        for task in &generated {
            if let Some(date) = &task.scheduled_date {
                if date.as_str() >= today {
                    by_date.entry(date).or_default().push(task);
                }
            }
        }
        let mut content = format!("{AGENDA_MARKER}\n{AGENDA_HELP}\n");
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
        let path = tasks_dir.join("agenda.md");
        expected.insert(path.clone());
        write_managed(
            path,
            content,
            base_dir,
            skip,
            opts.preserve_pending,
            &mut written,
        )?;
    }

    // today.md: the read-only day sheet; off = cleaned up below
    if let Some(days) = opts.today_file {
        let content = today_content(conn, config_dir, today, days)?;
        let path = tasks_dir.join("today.md");
        expected.insert(path.clone());
        write_managed(
            path,
            content,
            base_dir,
            skip,
            opts.preserve_pending,
            &mut written,
        )?;
    }

    // drop managed files whose list is gone (archived, renamed); files
    // without our marker are left alone
    if let Ok(entries) = fs::read_dir(tasks_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            // a file whose import just failed (a conflicted copy, a
            // rename that clashed) stays for the user to fix; deleting
            // it here would throw away the very lines the error is about
            if path.extension().and_then(|e| e.to_str()) != Some("md")
                || expected.contains(&path)
                || skip.contains(&path)
            {
                continue;
            }
            let first = fs::read_to_string(&path)
                .ok()
                .and_then(|c| c.lines().next().map(str::to_string))
                .unwrap_or_default();
            if first.trim().starts_with(LIST_MARKER_PREFIX)
                || first.trim() == SCHEDULED_MARKER
                || first.trim() == AGENDA_MARKER
                || first.trim() == TODAY_MARKER
            {
                let _ = fs::remove_file(&path);
            }
        }
    }

    // the merge base follows every successful write; skipped files keep
    // their previous base (their content was never applied), and bases
    // of removed managed files go with them
    fs::create_dir_all(base_dir).at(base_dir)?;
    for (path, content) in &written {
        // today.md is never merged, so it needs no base copy
        if path.file_name().and_then(|n| n.to_str()) == Some("today.md") {
            continue;
        }
        if let Some(name) = path.file_name() {
            write_if_changed(&base_dir.join(name), content)?;
        }
    }
    if let Ok(entries) = fs::read_dir(base_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if !expected
                .iter()
                .any(|p| p.file_name() == Some(name.as_os_str()))
            {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(written)
}

#[derive(PartialEq)]
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

fn parse_task_line(t: &str, ids: bool) -> std::result::Result<Line, String> {
    let (status, rest) = if let Some(r) = t.strip_prefix("- [ ] ") {
        ("todo", r)
    } else if let Some(r) = t
        .strip_prefix("- [x] ")
        .or_else(|| t.strip_prefix("- [X] "))
    {
        ("done", r)
    } else if let Some(r) = t
        .strip_prefix("- [xz] ")
        .or_else(|| t.strip_prefix("- [XZ] "))
    {
        ("waiting", r)
    } else if let Some(r) = t
        .strip_prefix("- [zz] ")
        .or_else(|| t.strip_prefix("- [ZZ] "))
    {
        ("dropped", r)
    } else if let Some(r) = t
        .strip_prefix("- [z] ")
        .or_else(|| t.strip_prefix("- [Z] "))
        // [>] is what versions before 0.41 wrote; still read, never written
        .or_else(|| t.strip_prefix("- [>] "))
    {
        ("postponed", r)
    } else if t.starts_with("- [") {
        return Err(format!(
            "unrecognized checkbox in '{t}' (use [ ], [x], [z], [xz] or [zz])"
        ));
    } else if let Some(r) = t.strip_prefix("- ") {
        // a plain bullet is accepted as a new open task (bulk paste)
        ("todo", r)
    } else {
        return Err(format!("cannot parse '{t}' - expected '- [ ] title'"));
    };

    let mut rest = rest.trim();
    let mut id = None;
    if !ids {
        // with the keys off the files carry none: a title that happens to
        // end in ` ^12` must not hijack task 12
    } else if let Some(pos) = rest.rfind(" ^") {
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
fn parse_content(content: &str, scheduled: bool, ids: bool) -> Result<Vec<Entry>> {
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
        let line =
            parse_task_line(t, ids).map_err(|msg| Error::State(format!("line {n}: {msg}")))?;
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

/// Which part of the task set a mirror file stands for, by its marker
/// line (or, for a brand-new file, a new list named after it). Renaming a
/// list's file renames the list; `changed` records that and a list the
/// file created.
fn import_scope(
    conn: &Connection,
    lists: &[tasks::List],
    stem: &str,
    first: &str,
    changed: &mut bool,
) -> Result<Scope> {
    Ok(if let Some(raw) = first.strip_prefix(LIST_MARKER_PREFIX) {
        let digits: String = raw.chars().take_while(|c| c.is_ascii_digit()).collect();
        let id: i64 = digits
            .parse()
            .map_err(|_| Error::State(format!("{stem}.md: malformed list marker")))?;
        let list = lists
            .iter()
            .find(|l| l.id == id)
            .ok_or_else(|| Error::State(format!("{stem}.md: unknown list id {id}")))?;
        // renaming the file renames the list - unless the stem is the
        // export's own collision form `Name (id)` (a reserved name, two
        // lists differing only by case), which is not a rename at all
        let clean = sanitize_name(&list.name);
        if clean != stem && format!("{clean} ({id})") != stem {
            tasks::list_rename(conn, id, stem)?;
            *changed = true;
        }
        Scope::List(id)
    } else if first == SCHEDULED_MARKER {
        // a marker under the wrong name is a duplicate (a file-sync
        // "conflicted copy"); importing it would double-apply its lines
        if stem != "scheduled" {
            return Err(Error::State(format!(
                "{stem}.md: carries the scheduled marker but is not scheduled.md - \
                 likely a sync conflict copy; merge or delete it"
            )));
        }
        Scope::Scheduled
    } else if first == AGENDA_MARKER {
        if stem != "agenda" {
            return Err(Error::State(format!(
                "{stem}.md: carries the agenda marker but is not agenda.md - \
                 likely a sync conflict copy; merge or delete it"
            )));
        }
        Scope::Agenda
    } else {
        // a brand-new file becomes a new list named after it
        match lists.iter().find(|l| l.name == stem) {
            Some(list) => Scope::List(list.id),
            None => {
                *changed = true;
                Scope::List(tasks::list_create(conn, stem, None, false)?.id)
            }
        }
    })
}

/// The three-way field merge for a line whose task exists: a file value
/// applies only when it differs from the base (or there is no base), so
/// an unchanged line never overrides an app-side edit. `None` when there
/// is nothing to change.
fn existing_task_patch(
    task: &Task,
    entry: &Entry,
    base_entry: Option<&Entry>,
    base_sort: Option<i64>,
    sort_order: i64,
    scope: &Scope,
) -> Option<TaskPatch> {
    let agenda = matches!(scope, Scope::Agenda);
    let base_line = base_entry.map(|e| &e.line);
    let mut patch = TaskPatch::default();
    let mut dirty = false;
    // per-field three-way rule: the file value applies only
    // when it differs from the base (or there is no base) -
    // an unchanged line never overrides an app-side edit
    if !agenda
        && task.title != entry.line.title
        && base_line.is_none_or(|b| b.title != entry.line.title)
    {
        patch.title = Some(entry.line.title.clone());
        dirty = true;
    }
    if task.status != entry.line.status && base_line.is_none_or(|b| b.status != entry.line.status) {
        patch.status = Some(entry.line.status.to_string());
        dirty = true;
    }
    if task.time != entry.line.time && base_line.is_none_or(|b| b.time != entry.line.time) {
        patch.time = Some(entry.line.time.clone());
        dirty = true;
    }
    if task.priority != entry.line.priority
        && base_line.is_none_or(|b| b.priority != entry.line.priority)
    {
        patch.priority = Some(entry.line.priority);
        dirty = true;
    }
    if !agenda {
        if task.sort_order != sort_order && base_sort.is_none_or(|b| b != sort_order) {
            patch.sort_order = Some(sort_order);
            dirty = true;
        }
        match scope {
            Scope::List(id) => {
                // membership is presence in the file; a line
                // unchanged since the base is no signal to
                // pull a task the app moved elsewhere back
                if base_entry.is_none() {
                    if task.list_id != Some(*id) {
                        patch.list_id = Some(Some(*id));
                        dirty = true;
                    }
                    if task.scheduled_date.is_some() {
                        patch.scheduled_date = Some(None);
                        dirty = true;
                    }
                }
            }
            Scope::Scheduled => {
                if task.scheduled_date != entry.date
                    && base_entry.is_none_or(|e| e.date != entry.date)
                {
                    patch.scheduled_date = Some(entry.date.clone());
                    dirty = true;
                }
            }
            Scope::Agenda => {}
        }
    }
    dirty.then_some(patch)
}

/// The subtask lines under one parent, merged the same three-way way as
/// the parents: matched by `^id` (or by text with the keys off), a field
/// applies only when it differs from the base, a stale line of a sub
/// deleted app-side is skipped, and absence deletes only subs the base
/// knew about (any sub, without a base). Returns whether anything changed.
fn import_subtasks(
    conn: &Connection,
    pid: i64,
    subs: &[Line],
    existing_subs: &[&Task],
    base_subs: &[Line],
    has_base: bool,
    ids: bool,
) -> Result<bool> {
    let mut changed = false;
    let sub_by_id: HashMap<i64, &Task> = existing_subs.iter().map(|t| (t.id, *t)).collect();
    let base_sub_for = |sub: &Line| -> Option<&Line> {
        sub.id
            .and_then(|id| base_subs.iter().find(|b| b.id == Some(id)))
            .or_else(|| {
                if ids {
                    return None;
                }
                base_subs.iter().find(|b| b.title == sub.title)
            })
    };
    let mut sub_seen: HashSet<i64> = HashSet::new();
    for (i, sub) in subs.iter().enumerate() {
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
                let base_sub = base_sub_for(sub);
                let mut patch = TaskPatch::default();
                let mut dirty = false;
                if existing_sub.title != sub.title && base_sub.is_none_or(|b| b.title != sub.title)
                {
                    patch.title = Some(sub.title.clone());
                    dirty = true;
                }
                if existing_sub.status != sub.status
                    && base_sub.is_none_or(|b| b.status != sub.status)
                {
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
                // a stale line of a sub deleted app-side: skip, like
                // the parent-level rule above
                if let (Some(_), Some(b)) = (sub.id, base_sub_for(sub)) {
                    if *b == *sub {
                        continue;
                    }
                }
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
    for existing_sub in existing_subs.iter().copied() {
        if !sub_seen.contains(&existing_sub.id) {
            // with a base at hand, absence deletes only subs the
            // file was told about
            let known_to_base = !has_base
                || base_subs.iter().any(|b| {
                    b.id == Some(existing_sub.id) || (!ids && b.title == existing_sub.title)
                });
            if known_to_base {
                tasks::task_delete(conn, existing_sub.id)?;
                changed = true;
            }
        }
    }
    Ok(changed)
}

enum Scope {
    List(i64),
    Scheduled,
    Agenda,
}

/// Moves a list into the group its file names, creating the group when
/// the name is new and clearing the membership when the name is empty.
/// Returns whether anything actually changed.
fn apply_group(conn: &Connection, list_id: i64, name: &str) -> Result<bool> {
    let current = tasks::lists_all(conn)?
        .iter()
        .find(|l| l.id == list_id)
        .and_then(|l| l.group_id);
    let target = if name.is_empty() {
        None
    } else {
        let groups = tasks::groups_all(conn)?;
        let wanted = name.to_lowercase();
        match groups.iter().find(|g| g.name.to_lowercase() == wanted) {
            Some(group) => Some(group.id),
            None => Some(tasks::group_create(conn, name)?.id),
        }
    };
    if target == current {
        return Ok(false);
    }
    tasks::list_set_group(conn, list_id, target)?;
    Ok(true)
}

/// Applies an edited mirror file to the database. Returns whether
/// anything actually changed. `today` bounds the scheduled scope: only
/// tasks the file is responsible for can be deleted by their absence.
///
/// `base` is the file as the app last exported it (mirror-base copy).
/// With a base at hand the import is a three-way merge: a field is
/// applied only when the file differs from the base (a human changed
/// it), a task is deleted by absence only when the base knew it, and a
/// line whose task vanished app-side is not resurrected. Without a base
/// the file wins wholesale, as before.
pub fn import_file(
    conn: &Connection,
    path: &Path,
    content: &str,
    today: &str,
    ids: bool,
    base: Option<&str>,
) -> Result<bool> {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("list")
        .to_string();
    let first = content.lines().next().unwrap_or("").trim().to_string();
    // today.md is a read-only export: nothing in it syncs back, and it
    // must never fall through to the new-list branch below
    if first == TODAY_MARKER {
        return Ok(false);
    }
    let lists = tasks::lists_all(conn)?;
    let mut changed = false;
    let scope = import_scope(conn, &lists, &stem, &first, &mut changed)?;

    // The group line is a field like any other in the three-way merge:
    // applied only when the file differs from the base, so a stale copy
    // arriving from a file sync cannot pull a list back into a group it
    // was moved out of here. A file with no group line at all (an older
    // export, a hand-made file) leaves the membership alone.
    if let Scope::List(list_id) = &scope {
        if let Some(asked) = parse_group_line(content) {
            let known = base.and_then(parse_group_line);
            if known.as_deref() != Some(asked.as_str()) && apply_group(conn, *list_id, &asked)? {
                changed = true;
            }
        }
    }

    let agenda = matches!(scope, Scope::Agenda);
    let dated = matches!(scope, Scope::Scheduled | Scope::Agenda);
    let entries = parse_content(content, dated, ids)?;
    // an unparseable base was never our own export - ignore it
    let base_entries: Option<Vec<Entry>> = base.and_then(|b| parse_content(b, dated, ids).ok());

    // NOTE: no outer transaction - task_update opens its own; the parse
    // above already rejected every malformed line, so a mid-apply error
    // (disk, constraint) can only leave a prefix applied, which the
    // following export normalizes back into the file.
    let manual_parents = tasks::manual_parent_tasks(conn)?;
    let generated_parents = if agenda {
        tasks::generated_parent_tasks(conn)?
    } else {
        Vec::new()
    };
    let parents: Vec<&Task> = manual_parents
        .iter()
        .chain(generated_parents.iter())
        .collect();
    let by_id: HashMap<i64, &Task> = parents.iter().map(|t| (t.id, *t)).collect();
    let scope_ids: HashSet<i64> = manual_parents
        .iter()
        .filter(|t| match &scope {
            Scope::List(id) => t.scheduled_date.is_none() && t.list_id == Some(*id),
            Scope::Scheduled => t
                .scheduled_date
                .as_deref()
                .map(|d| d >= today)
                .unwrap_or(false),
            // the agenda never deletes by absence
            Scope::Agenda => false,
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

    // Base lookups: entry index by id, by title for id-less vaults (the
    // date joins the key in dated files - generated titles repeat across
    // days), and each base entry's position within its group.
    let mut base_by_id: HashMap<i64, usize> = HashMap::new();
    let mut base_by_title: HashMap<(String, Option<String>), usize> = HashMap::new();
    let mut base_order: HashMap<usize, i64> = HashMap::new();
    if let Some(be) = &base_entries {
        let mut counters: HashMap<String, i64> = HashMap::new();
        for (i, e) in be.iter().enumerate() {
            let group = e.date.clone().unwrap_or_default();
            let index = counters.entry(group).or_insert(0);
            base_order.insert(i, *index);
            *index += 1;
            if let Some(id) = e.line.id {
                base_by_id.insert(id, i);
            }
            let key = (
                e.line.title.clone(),
                if dated { e.date.clone() } else { None },
            );
            base_by_title.entry(key).or_insert(i);
        }
    }

    // Which task each line stands for. An explicit ^id always wins;
    // with the keys turned off the files carry none, so a line claims
    // the first not-yet-claimed task in scope with the same text (in the
    // agenda: the same text on the same day, any origin).
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
                    if claimed.contains(&task.id) || task.title != entry.line.title {
                        return false;
                    }
                    if agenda {
                        task.scheduled_date == entry.date
                    } else {
                        scope_ids.contains(&task.id)
                    }
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

        let base_idx = resolved_id
            .and_then(|id| base_by_id.get(&id).copied())
            .or_else(|| {
                if ids {
                    return None;
                }
                let key = (
                    entry.line.title.clone(),
                    if dated { entry.date.clone() } else { None },
                );
                base_by_title.get(&key).copied()
            });
        let base_entry = base_idx.and_then(|i| base_entries.as_deref().map(|be| &be[i]));

        let existing = resolved_id.and_then(|id| by_id.get(&id).copied());
        let pid = match existing {
            Some(task) => {
                let base_sort = base_idx.and_then(|i| base_order.get(&i)).copied();
                let patch =
                    existing_task_patch(task, entry, base_entry, base_sort, sort_order, &scope);
                if let Some(patch) = patch {
                    tasks::task_update(conn, task.id, &patch)?;
                    changed = true;
                }
                task.id
            }
            None => {
                // a line whose id the database no longer knows: when the
                // base carries the identical line, the task was deleted
                // app-side and this file is just stale - skip instead of
                // resurrecting it
                if entry.line.id.is_some() {
                    if let Some(b) = entry
                        .line
                        .id
                        .and_then(|id| base_by_id.get(&id).copied())
                        .and_then(|i| base_entries.as_deref().map(|be| &be[i]))
                    {
                        if b.line == entry.line && b.date == entry.date {
                            continue;
                        }
                    }
                }
                let created = tasks::task_create(
                    conn,
                    &NewTask {
                        title: entry.line.title.clone(),
                        list_id: match &scope {
                            Scope::List(id) => Some(*id),
                            Scope::Scheduled | Scope::Agenda => None,
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
        let base_subs: &[Line] = base_entry.map(|e| e.subs.as_slice()).unwrap_or(&[]);
        if import_subtasks(
            conn,
            pid,
            &entry.subs,
            &existing_subs,
            base_subs,
            base_entries.is_some(),
            ids,
        )? {
            changed = true;
        }
    }

    for id in scope_ids {
        if !seen.contains(&id) {
            // same rule at the top level: a base-aware import deletes
            // only tasks the file knew about - a stale file cannot
            // delete a task created after it was written
            let known_to_base = match &base_entries {
                None => true,
                Some(be) => be.iter().any(|e| {
                    e.line.id == Some(id)
                        || (!ids
                            && by_id
                                .get(&id)
                                .is_some_and(|task| e.line.title == task.title))
                }),
            };
            if known_to_base {
                tasks::task_delete(conn, id)?;
                changed = true;
            }
        }
    }
    Ok(changed)
}

#[cfg(test)]
mod tests;
