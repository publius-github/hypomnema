//! Commands: lists, list groups, tasks, the engine pass.

use tauri::{AppHandle, Emitter, State};

use crate::error::{Error, Result};
use crate::state::*;
use crate::{config_files, engine, tasks};

#[tauri::command]
pub(crate) async fn lists_all(state: State<'_, AppState>) -> Result<Vec<tasks::List>> {
    with_conn(&state, tasks::lists_all)
}

#[tauri::command]
pub(crate) async fn list_create(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> Result<tasks::List> {
    let list = with_conn(&state, |conn| {
        tasks::list_create(conn, &name, color.as_deref(), false)
    })?;
    state.request_export();
    Ok(list)
}

#[tauri::command]
pub(crate) async fn list_rename(state: State<'_, AppState>, id: i64, name: String) -> Result<()> {
    with_conn(&state, |conn| tasks::list_rename(conn, id, &name))?;
    state.request_export();
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_set_favorite(
    state: State<'_, AppState>,
    id: i64,
    favorite: bool,
) -> Result<()> {
    with_conn(&state, |conn| tasks::list_set_favorite(conn, id, favorite))
}

#[tauri::command]
pub(crate) async fn list_set_meta(
    state: State<'_, AppState>,
    id: i64,
    color: Option<String>,
    description: String,
    kind: String,
) -> Result<()> {
    with_conn(&state, |conn| {
        tasks::list_set_meta(conn, id, color.as_deref(), &description, &kind)
    })
}

#[tauri::command]
pub(crate) async fn list_set_all_statuses(
    state: State<'_, AppState>,
    id: i64,
    done: bool,
) -> Result<usize> {
    let changed = with_conn(&state, |conn| tasks::list_set_all_statuses(conn, id, done))?;
    state.request_export();
    Ok(changed)
}

#[tauri::command]
pub(crate) async fn list_groups_all(state: State<'_, AppState>) -> Result<Vec<tasks::ListGroup>> {
    with_conn(&state, tasks::groups_all)
}

#[tauri::command]
pub(crate) async fn list_group_create(
    state: State<'_, AppState>,
    name: String,
) -> Result<tasks::ListGroup> {
    let group = with_conn(&state, |conn| tasks::group_create(conn, &name))?;
    state.request_export();
    Ok(group)
}

#[tauri::command]
pub(crate) async fn list_group_set_meta(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    color: Option<String>,
) -> Result<()> {
    with_conn(&state, |conn| {
        tasks::group_set_meta(conn, id, &name, color.as_deref())
    })?;
    state.request_export();
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_group_delete(state: State<'_, AppState>, id: i64) -> Result<()> {
    with_conn(&state, |conn| tasks::group_delete(conn, id))?;
    state.request_export();
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_set_group(
    state: State<'_, AppState>,
    id: i64,
    group_id: Option<i64>,
) -> Result<()> {
    with_conn(&state, |conn| tasks::list_set_group(conn, id, group_id))?;
    state.request_export();
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_archive(state: State<'_, AppState>, id: i64) -> Result<()> {
    with_conn(&state, |conn| tasks::list_archive(conn, id))?;
    state.request_export();
    Ok(())
}

#[tauri::command]
pub(crate) async fn lists_archived(state: State<'_, AppState>) -> Result<Vec<tasks::List>> {
    with_conn(&state, tasks::lists_archived)
}

#[tauri::command]
pub(crate) async fn list_unarchive(state: State<'_, AppState>, id: i64) -> Result<()> {
    with_conn(&state, |conn| tasks::list_unarchive(conn, id))?;
    state.request_export();
    Ok(())
}

#[tauri::command]
pub(crate) async fn tasks_snapshot(
    state: State<'_, AppState>,
    start_date: String,
    end_date: String,
) -> Result<Vec<tasks::Task>> {
    with_conn(&state, |conn| {
        tasks::tasks_snapshot(conn, &start_date, &end_date)
    })
}

#[tauri::command]
pub(crate) async fn task_create(
    state: State<'_, AppState>,
    new: tasks::NewTask,
) -> Result<tasks::Task> {
    let task = with_conn(&state, |conn| tasks::task_create(conn, &new))?;
    state.request_export();
    Ok(task)
}

/// Creates a task in the quick-capture list (config.capture_list,
/// created on first use). Backs the capture window, which shares no
/// frontend state with the main window - the vault-updated emit is how
/// the main window learns about the new task.
#[tauri::command]
pub(crate) async fn capture_task(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
) -> Result<tasks::Task> {
    let task = {
        let guard = state.vault.lock_or_recover();
        let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
        let inbox = tasks::ensure_inbox(&vault.conn, &vault.config.capture_list)?;
        tasks::task_create(
            &vault.conn,
            &tasks::NewTask {
                title,
                list_id: Some(inbox.id),
                ..Default::default()
            },
        )?
    };
    state.request_export();
    let _ = app.emit("vault-updated", Vec::<config_files::ConfigError>::new());
    Ok(task)
}

/// The quick-capture list, created on first use - the "move to backlog"
/// target for tasks that have no list of their own.
#[tauri::command]
pub(crate) async fn inbox_list(state: State<'_, AppState>) -> Result<tasks::List> {
    let list = {
        let guard = state.vault.lock_or_recover();
        let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
        tasks::ensure_inbox(&vault.conn, &vault.config.capture_list)?
    };
    state.request_export();
    Ok(list)
}

#[tauri::command]
pub(crate) async fn task_update(
    state: State<'_, AppState>,
    id: i64,
    patch: tasks::TaskPatch,
) -> Result<tasks::Task> {
    let task = with_conn(&state, |conn| tasks::task_update(conn, id, &patch))?;
    state.request_export();
    Ok(task)
}

#[tauri::command]
pub(crate) async fn task_delete(
    state: State<'_, AppState>,
    id: i64,
) -> Result<tasks::DeletedTasks> {
    let deleted = with_conn(&state, |conn| tasks::task_delete(conn, id))?;
    state.request_export();
    Ok(deleted)
}

#[tauri::command]
pub(crate) async fn task_restore(
    state: State<'_, AppState>,
    deleted: tasks::DeletedTasks,
) -> Result<Vec<tasks::Task>> {
    let restored = with_conn(&state, |conn| tasks::task_restore(conn, &deleted))?;
    state.request_export();
    Ok(restored)
}

#[tauri::command]
pub(crate) async fn tasks_delete_done(state: State<'_, AppState>) -> Result<usize> {
    let count = with_conn(&state, tasks::tasks_delete_done)?;
    state.request_export();
    Ok(count)
}

#[tauri::command]
pub(crate) async fn tasks_reorder(
    state: State<'_, AppState>,
    list_id: i64,
    ordered_ids: Vec<i64>,
) -> Result<()> {
    with_conn(&state, |conn| {
        tasks::list_reorder(conn, list_id, &ordered_ids)
    })?;
    state.request_export();
    Ok(())
}

#[tauri::command]
pub(crate) async fn engine_run(state: State<'_, AppState>) -> Result<engine::EngineOutcome> {
    // taken before the vault lock is held for the pass; the watcher
    // thread takes only the engine lock while running, so there is no
    // lock-order cycle
    let engine_lock = state.engine_lock.clone();
    let _pass = engine_lock.lock_or_recover();
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    let mut outcome = engine::run(
        &vault.conn,
        &vault.config_dir(),
        &vault.config,
        chrono::Local::now(),
    )?;
    if let Some(msg) = &vault.config_error {
        outcome.errors.push(config_files::ConfigError {
            file: "app.yml".into(),
            line: None,
            message: msg.clone(),
        });
    }
    // the pass may have created/moved tasks; keep the text mirror fresh
    state.request_export();
    Ok(outcome)
}

#[tauri::command]
pub(crate) async fn tasks_search(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<tasks::Task>> {
    with_conn(&state, |conn| tasks::tasks_search(conn, &query))
}

#[tauri::command]
pub(crate) async fn task_get(state: State<'_, AppState>, id: i64) -> Result<tasks::Task> {
    with_conn(&state, |conn| tasks::task_get(conn, id))
}
