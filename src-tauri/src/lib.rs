mod config;
mod db;
mod engine;
mod error;
mod journal;
mod tasks;
mod vault;

use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager, State};

use config::AppConfig;
use error::{Error, Result};
use vault::Vault;

#[derive(Default)]
struct AppState {
    vault: Mutex<Option<Vault>>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

fn app_config_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|e| Error::State(format!("cannot resolve app config dir: {e}")))
}

/// Watches <vault>/config and, after a debounce, reloads app.yml, runs
/// the engine, and notifies the frontend (req. 18, safe reload per 19).
fn start_config_watcher(app: AppHandle, config_dir: &Path) -> Result<()> {
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
            let _ = tx.send(());
        }
    })
    .map_err(|e| Error::State(format!("cannot start config watcher: {e}")))?;
    watcher
        .watch(config_dir, RecursiveMode::NonRecursive)
        .map_err(|e| Error::State(format!("cannot watch config dir: {e}")))?;

    let state = app.state::<AppState>();
    *state.watcher.lock().unwrap() = Some(watcher);

    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            // debounce bursts of file events
            std::thread::sleep(Duration::from_millis(400));
            while rx.try_recv().is_ok() {}

            let state = app.state::<AppState>();
            let mut guard = state.vault.lock().unwrap();
            if let Some(vault) = guard.as_mut() {
                let _ = vault.reload_config();
                let outcome = engine::run(
                    &vault.conn,
                    &vault.config_dir(),
                    &vault.config,
                    chrono::Local::now(),
                );
                drop(guard);
                let errors = outcome.map(|o| o.errors).unwrap_or_default();
                let _ = app.emit("vault-updated", errors);
            }
        }
    });
    Ok(())
}

fn open_vault(app: &AppHandle, state: &State<AppState>, root: &Path) -> Result<AppConfig> {
    let vault = Vault::open(root)?;
    let config = vault.config.clone();
    let config_dir = vault.config_dir();
    *state.vault.lock().unwrap() = Some(vault);
    if state.watcher.lock().unwrap().is_none() {
        start_config_watcher(app.clone(), &config_dir)?;
    }
    Ok(config)
}

#[tauri::command]
fn vault_status(app: AppHandle, state: State<AppState>) -> Result<Option<String>> {
    let Some(path) = vault::read_vault_path(&app_config_dir(&app)?) else {
        return Ok(None);
    };
    open_vault(&app, &state, &path)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn vault_select(app: AppHandle, state: State<AppState>, path: String) -> Result<AppConfig> {
    let root = PathBuf::from(&path);
    let config = open_vault(&app, &state, &root)?;
    vault::write_vault_path(&app_config_dir(&app)?, &root)?;
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

#[tauri::command]
fn engine_run(state: State<AppState>) -> Result<engine::EngineOutcome> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    engine::run(
        &vault.conn,
        &vault.config_dir(),
        &vault.config,
        chrono::Local::now(),
    )
}

#[tauri::command]
fn upcoming_events(state: State<AppState>) -> Result<engine::UpcomingResult> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    let (events, errors) = engine::upcoming_events(&vault.conn, &vault.config_dir())?;
    Ok(engine::UpcomingResult { events, errors })
}

fn with_vault_root<T>(state: &State<AppState>, f: impl FnOnce(&Path) -> Result<T>) -> Result<T> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    f(&vault.root)
}

#[tauri::command]
fn journal_open(state: State<AppState>, date: String) -> Result<journal::JournalEntry> {
    with_vault_root(&state, |root| journal::open_entry(root, &date))
}

#[tauri::command]
fn journal_save(state: State<AppState>, date: String, content: String) -> Result<()> {
    with_vault_root(&state, |root| journal::save_entry(root, &date, &content))
}

#[tauri::command]
fn journal_list(state: State<AppState>) -> Result<Vec<String>> {
    with_vault_root(&state, journal::list_entries)
}

#[tauri::command]
fn journal_template_get(state: State<AppState>) -> Result<String> {
    with_vault_root(&state, journal::read_template)
}

#[tauri::command]
fn journal_template_set(state: State<AppState>, content: String) -> Result<()> {
    with_vault_root(&state, |root| journal::save_template(root, &content))
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
            task_delete,
            engine_run,
            upcoming_events,
            journal_open,
            journal_save,
            journal_list,
            journal_template_get,
            journal_template_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running app-pkb");
}
