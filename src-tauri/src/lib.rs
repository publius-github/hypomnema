mod config;
mod db;
mod error;
mod tasks;
mod vault;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

use config::AppConfig;
use error::{Error, Result};
use vault::Vault;

#[derive(Default)]
struct AppState {
    vault: Mutex<Option<Vault>>,
}

fn app_config_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|e| Error::State(format!("cannot resolve app config dir: {e}")))
}

#[tauri::command]
fn vault_status(app: AppHandle, state: State<AppState>) -> Result<Option<String>> {
    let Some(path) = vault::read_vault_path(&app_config_dir(&app)?) else {
        return Ok(None);
    };
    let vault = Vault::open(&path)?;
    let display = vault.root.to_string_lossy().into_owned();
    *state.vault.lock().unwrap() = Some(vault);
    Ok(Some(display))
}

#[tauri::command]
fn vault_select(app: AppHandle, state: State<AppState>, path: String) -> Result<AppConfig> {
    let root = PathBuf::from(&path);
    let vault = Vault::open(&root)?;
    vault::write_vault_path(&app_config_dir(&app)?, &root)?;
    let config = vault.config.clone();
    *state.vault.lock().unwrap() = Some(vault);
    Ok(config)
}

#[tauri::command]
fn config_get(state: State<AppState>) -> Result<AppConfig> {
    let guard = state.vault.lock().unwrap();
    guard
        .as_ref()
        .map(|vault| vault.config.clone())
        .ok_or_else(|| Error::State("no vault selected".into()))
}

#[tauri::command]
fn config_set(state: State<AppState>, config: AppConfig) -> Result<()> {
    let mut guard = state.vault.lock().unwrap();
    let vault = guard
        .as_mut()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    vault.save_config(config)
}

fn with_conn<T>(
    state: &State<AppState>,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T>,
) -> Result<T> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    f(&vault.conn)
}

#[tauri::command]
fn lists_all(state: State<AppState>) -> Result<Vec<tasks::List>> {
    with_conn(&state, tasks::lists_all)
}

#[tauri::command]
fn list_create(state: State<AppState>, name: String, color: Option<String>) -> Result<tasks::List> {
    with_conn(&state, |conn| {
        tasks::list_create(conn, &name, color.as_deref())
    })
}

#[tauri::command]
fn list_rename(state: State<AppState>, id: i64, name: String) -> Result<()> {
    with_conn(&state, |conn| tasks::list_rename(conn, id, &name))
}

#[tauri::command]
fn list_archive(state: State<AppState>, id: i64) -> Result<()> {
    with_conn(&state, |conn| tasks::list_archive(conn, id))
}

#[tauri::command]
fn tasks_snapshot(
    state: State<AppState>,
    start_date: String,
    end_date: String,
) -> Result<Vec<tasks::Task>> {
    with_conn(&state, |conn| {
        tasks::tasks_snapshot(conn, &start_date, &end_date)
    })
}

#[tauri::command]
fn task_create(state: State<AppState>, new: tasks::NewTask) -> Result<tasks::Task> {
    with_conn(&state, |conn| tasks::task_create(conn, &new))
}

#[tauri::command]
fn task_update(state: State<AppState>, id: i64, patch: tasks::TaskPatch) -> Result<tasks::Task> {
    with_conn(&state, |conn| tasks::task_update(conn, id, &patch))
}

#[tauri::command]
fn task_delete(state: State<AppState>, id: i64) -> Result<()> {
    with_conn(&state, |conn| tasks::task_delete(conn, id))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            vault_status,
            vault_select,
            config_get,
            config_set,
            lists_all,
            list_create,
            list_rename,
            list_archive,
            tasks_snapshot,
            task_create,
            task_update,
            task_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running app-pkb");
}
