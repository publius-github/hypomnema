//! The Android home-screen list widget's data and its action queue.
//!
//! The widget cannot run the WebView or the core, so it draws from a
//! JSON file the core hands it after every export (`payload`), and it
//! answers a tap by appending a line to a queue file the core watches
//! and applies (`apply_actions`). Both halves are plain functions over a
//! connection, so the desktop builds and tests them; the Android glue
//! around them (the plugin calls, the queue watcher) is `android` below.

// on the desktop only the tests call the data functions: they are kept
// building there so the desktop gates cover them
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::Result;
use crate::tasks::{self, TaskPatch};

/// What a widget tap asked the app to open: a list, with the add field
/// focused for the widget's + button.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct WidgetLaunch {
    #[ts(type = "number")]
    pub list: i64,
    pub add: bool,
}

#[derive(Serialize)]
struct WidgetTask {
    id: i64,
    title: String,
    priority: bool,
    done: bool,
}

#[derive(Serialize)]
struct WidgetList {
    id: i64,
    name: String,
    color: Option<String>,
    kind: String,
    favorite: bool,
    group: Option<String>,
    tasks: Vec<WidgetTask>,
}

#[derive(Serialize)]
struct WidgetData {
    lists: Vec<WidgetList>,
}

/// The JSON the widgets draw from: every active list, favorites first,
/// with the tasks the phone's list screen shows as open - top-level,
/// unscheduled or priority or manual - in that screen's order, and for
/// a checklist its ticked items after them (a todo list sweeps its done
/// tasks, a checklist keeps them until unticked).
pub fn payload(conn: &Connection) -> Result<String> {
    let groups = tasks::groups_all(conn)?;
    let mut lists = tasks::lists_all(conn)?;
    lists.sort_by(|a, b| {
        b.favorite
            .cmp(&a.favorite)
            .then(a.sort_order.cmp(&b.sort_order))
            .then_with(|| a.name.cmp(&b.name))
    });
    let mut stmt = conn.prepare(
        "SELECT id, title, priority, status FROM tasks
         WHERE list_id = ?1 AND parent_task_id IS NULL
           AND (scheduled_date IS NULL OR priority = 1 OR origin = 'manual')
           AND status IN ('todo', 'done')
         ORDER BY status = 'done', priority DESC, time IS NULL, time, sort_order, id",
    )?;
    let mut out = Vec::with_capacity(lists.len());
    for list in lists {
        let checklist = list.kind == "checklist";
        let tasks = stmt
            .query_map([list.id], |row| {
                Ok(WidgetTask {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    priority: row.get::<_, i64>(2)? != 0,
                    done: row.get::<_, String>(3)? == "done",
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .filter(|t| checklist || !t.done)
            .collect();
        out.push(WidgetList {
            id: list.id,
            name: list.name,
            color: list.color,
            kind: list.kind,
            favorite: list.favorite,
            group: list
                .group_id
                .and_then(|id| groups.iter().find(|g| g.id == id))
                .map(|g| g.name.clone()),
            tasks,
        });
    }
    serde_json::to_string(&WidgetData { lists: out })
        .map_err(|e| crate::error::Error::State(format!("widget payload: {e}")))
}

/// One line of the queue file: the widget asks for a status on a task.
#[derive(Deserialize)]
struct Action {
    task: i64,
    status: String,
}

/// Applies the queued taps, one JSON object per line, and says how many
/// took. A line that does not parse, names a status the model lacks or
/// a task that is gone is skipped: the widget drew from a snapshot that
/// may be stale, and a tap on a task deleted since is nothing to fail
/// the rest over.
pub fn apply_actions(conn: &Connection, lines: &str) -> usize {
    let mut applied = 0;
    for line in lines.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let Ok(action) = serde_json::from_str::<Action>(line) else {
            continue;
        };
        if !matches!(action.status.as_str(), "todo" | "done") {
            continue;
        }
        let patch = TaskPatch {
            status: Some(action.status),
            ..Default::default()
        };
        if tasks::task_update(conn, action.task, &patch).is_ok() {
            applied += 1;
        }
    }
    applied
}

#[cfg(target_os = "android")]
pub(crate) mod android {
    //! The glue: pushing the payload to the Kotlin side and draining the
    //! queue it appends to.

    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::time::Duration;

    use notify::{RecursiveMode, Watcher};
    use tauri::{AppHandle, Manager};
    use tauri_plugin_widget::WidgetExt;

    use crate::applog;
    use crate::error::{Error, Result};
    use crate::state::{app_config_dir, AppState, LockOrRecover};

    const QUEUE_FILE: &str = "widget-actions.jsonl";

    fn queue_path(app: &AppHandle) -> Result<PathBuf> {
        Ok(app_config_dir(app)?.join(QUEUE_FILE))
    }

    /// Hands the widgets a fresh payload. Best effort, like the exports
    /// it rides on: a widget a step behind is redrawn by the next one.
    pub(crate) fn publish(app: &AppHandle, conn: &rusqlite::Connection) {
        let json = match super::payload(conn) {
            Ok(json) => json,
            Err(e) => {
                applog::error(format!("widget payload failed: {e}"));
                return;
            }
        };
        let Ok(queue) = queue_path(app) else {
            return;
        };
        if let Err(e) = app.widget().publish(&json, &queue.to_string_lossy()) {
            applog::warn(e);
        }
    }

    /// Applies whatever the widgets queued since the last drain. The
    /// queue is renamed away first, so a tap landing mid-drain goes
    /// into a fresh file for the next round instead of being read half
    /// written; a vault that is not open yet leaves the queue in place
    /// for `open_vault` to drain.
    pub(crate) fn drain(app: &AppHandle) {
        let Ok(queue) = queue_path(app) else {
            return;
        };
        if !queue.exists() {
            return;
        }
        let state = app.state::<AppState>();
        let guard = state.vault.lock_or_recover();
        let Some(vault) = guard.as_ref() else {
            return;
        };
        let taking = queue.with_extension("taking");
        if let Err(e) = std::fs::rename(&queue, &taking) {
            applog::warn(format!("widget queue could not be taken: {e}"));
            return;
        }
        let lines = std::fs::read_to_string(&taking).unwrap_or_default();
        let _ = std::fs::remove_file(&taking);
        let applied = super::apply_actions(&vault.conn, &lines);
        drop(guard);
        if applied > 0 {
            state.request_export();
        }
    }

    /// Watches the app's config dir for the queue file the widget
    /// appends to, and drains it on every change - so a tick on the
    /// home screen lands in the vault while the app process lives,
    /// put away or not. Replaces the tasks watcher's debounce with a
    /// shorter one: a tap is one line, not a burst of saves.
    pub(crate) fn start_queue_watcher(app: AppHandle) -> Result<()> {
        let dir = app_config_dir(&app)?;
        let _ = std::fs::create_dir_all(&dir);
        let (tx, rx) = mpsc::channel::<()>();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if let Ok(event) = event {
                    let ours = event
                        .paths
                        .iter()
                        .any(|p| p.file_name().is_some_and(|n| n == QUEUE_FILE));
                    if ours && !matches!(event.kind, notify::EventKind::Access(_)) {
                        let _ = tx.send(());
                    }
                }
            })
            .map_err(|e| Error::State(format!("cannot start widget queue watcher: {e}")))?;
        watcher
            .watch(&dir, RecursiveMode::NonRecursive)
            .map_err(|e| Error::State(format!("cannot watch the widget queue: {e}")))?;
        *app.state::<AppState>().widget_watcher.lock_or_recover() = Some(watcher);
        std::thread::spawn(move || {
            while rx.recv().is_ok() {
                std::thread::sleep(Duration::from_millis(100));
                while rx.try_recv().is_ok() {}
                drain(&app);
            }
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::tasks::{list_create, task_create, task_update, NewTask};
    use rusqlite::Connection;
    use serde_json::Value;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        conn
    }

    fn task(conn: &Connection, list: i64, title: &str) -> i64 {
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

    fn done(conn: &Connection, id: i64) {
        task_update(
            conn,
            id,
            &TaskPatch {
                status: Some("done".into()),
                ..Default::default()
            },
        )
        .unwrap();
    }

    #[test]
    fn a_todo_list_shows_open_tasks_only_and_a_checklist_keeps_ticked_ones_last() {
        let conn = conn();
        let todo = list_create(&conn, "Work", None, false).unwrap().id;
        let check = list_create(&conn, "Groceries", Some("#ef4444"), false)
            .unwrap()
            .id;
        conn.execute("UPDATE lists SET kind = 'checklist' WHERE id = ?1", [check])
            .unwrap();
        let a = task(&conn, todo, "open");
        let b = task(&conn, todo, "closed");
        done(&conn, b);
        let milk = task(&conn, check, "milk");
        let eggs = task(&conn, check, "eggs");
        done(&conn, milk);

        let data: Value = serde_json::from_str(&payload(&conn).unwrap()).unwrap();
        let lists = data["lists"].as_array().unwrap();
        let work = lists.iter().find(|l| l["name"] == "Work").unwrap();
        let ids: Vec<i64> = work["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["id"].as_i64().unwrap())
            .collect();
        assert_eq!(ids, vec![a]);
        assert_eq!(work["kind"], "todo");

        let groceries = lists.iter().find(|l| l["name"] == "Groceries").unwrap();
        let rows = groceries["tasks"].as_array().unwrap();
        assert_eq!(groceries["color"], "#ef4444");
        assert_eq!(groceries["kind"], "checklist");
        assert_eq!(rows[0]["id"].as_i64().unwrap(), eggs);
        assert_eq!(rows[0]["done"], false);
        assert_eq!(rows[1]["id"].as_i64().unwrap(), milk);
        assert_eq!(rows[1]["done"], true);
    }

    #[test]
    fn favorites_come_first_and_a_group_is_named() {
        let conn = conn();
        let plain = list_create(&conn, "Plain", None, false).unwrap().id;
        let fav = list_create(&conn, "Starred", None, false).unwrap().id;
        tasks::list_set_favorite(&conn, fav, true).unwrap();
        let group = tasks::group_create(&conn, "Home").unwrap().id;
        tasks::list_set_group(&conn, plain, Some(group)).unwrap();

        let data: Value = serde_json::from_str(&payload(&conn).unwrap()).unwrap();
        let lists = data["lists"].as_array().unwrap();
        assert_eq!(lists[0]["name"], "Starred");
        assert_eq!(lists[0]["favorite"], true);
        assert_eq!(lists[1]["name"], "Plain");
        assert_eq!(lists[1]["group"], "Home");
    }

    #[test]
    fn queued_taps_apply_and_bad_lines_are_skipped() {
        let conn = conn();
        let list = list_create(&conn, "Work", None, false).unwrap().id;
        let a = task(&conn, list, "a");
        let b = task(&conn, list, "b");
        let lines = format!(
            "{{\"task\":{a},\"status\":\"done\"}}\nnot json\n\
             {{\"task\":999999,\"status\":\"done\"}}\n\
             {{\"task\":{b},\"status\":\"dropped\"}}\n\n"
        );
        assert_eq!(apply_actions(&conn, &lines), 1);
        let status: String = conn
            .query_row("SELECT status FROM tasks WHERE id = ?1", [a], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "done");
        let status: String = conn
            .query_row("SELECT status FROM tasks WHERE id = ?1", [b], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "todo");
    }
}
