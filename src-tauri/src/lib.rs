mod config;
mod db;
mod engine;
mod error;
mod journal;
mod kb;
mod reminders;
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
    kb_watcher: Mutex<Option<(PathBuf, notify::RecommendedWatcher)>>,
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

#[tauri::command]
fn dashboard_context(
    state: State<AppState>,
    dates: Vec<String>,
) -> Result<reminders::DashboardContext> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    reminders::dashboard_context(&vault.conn, &vault.config_dir(), &dates)
}

#[tauri::command]
fn birthdays_list(state: State<AppState>) -> Result<engine::BirthdaysResult> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    Ok(engine::birthdays_list(
        &vault.config_dir(),
        chrono::Local::now().date_naive(),
    ))
}

#[tauri::command]
fn scheduled_add(state: State<AppState>, event: engine::ScheduledEvent) -> Result<()> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    engine::append_scheduled(&vault.config_dir(), event)
}

#[tauri::command]
fn birthday_add(state: State<AppState>, entry: engine::BirthdayEntry) -> Result<()> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    engine::append_birthday(&vault.config_dir(), entry)
}

const EDITABLE_CONFIG_FILES: &[&str] = &[
    "recurring.yml",
    "scheduled.yml",
    "birthdays.yml",
    "weekly-focus.yml",
    "day-reminders.yml",
    "day-schedule.yml",
];

fn editable_config_path(state: &State<AppState>, file: &str) -> Result<PathBuf> {
    if !EDITABLE_CONFIG_FILES.contains(&file) {
        return Err(Error::State(format!("not an editable config file: {file}")));
    }
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    Ok(vault.config_dir().join(file))
}

#[tauri::command]
fn config_file_get(state: State<AppState>, file: String) -> Result<String> {
    let path = editable_config_path(&state, &file)?;
    Ok(std::fs::read_to_string(path).unwrap_or_default())
}

/// Validates and, when valid, writes the config file. Invalid content is
/// never written, so the last valid state stays active (req. 19).
#[tauri::command]
fn config_file_set(
    state: State<AppState>,
    file: String,
    content: String,
) -> Result<Vec<engine::ConfigError>> {
    let path = editable_config_path(&state, &file)?;
    let errors = engine::validate_config_content(&file, &content);
    if errors.is_empty() {
        std::fs::write(path, content).map_err(Error::Io)?;
    }
    Ok(errors)
}

fn kb_root(state: &State<AppState>) -> Result<PathBuf> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    if vault.config.kb_path.trim().is_empty() {
        return Err(Error::State("KB folder is not configured".into()));
    }
    Ok(PathBuf::from(vault.config.kb_path.trim()))
}

/// (Re)arms the KB watcher when the tree is loaded, so external edits
/// refresh the UI. Replaced when the KB path changes in settings.
fn ensure_kb_watcher(app: &AppHandle, state: &State<AppState>, root: &Path) -> Result<()> {
    let mut guard = state.kb_watcher.lock().unwrap();
    if let Some((watched, _)) = guard.as_ref() {
        if watched == root {
            return Ok(());
        }
    }
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
            let _ = tx.send(());
        }
    })
    .map_err(|e| Error::State(format!("cannot start KB watcher: {e}")))?;
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| Error::State(format!("cannot watch KB folder: {e}")))?;
    *guard = Some((root.to_path_buf(), watcher));

    let app = app.clone();
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            std::thread::sleep(Duration::from_millis(400));
            while rx.try_recv().is_ok() {}
            let _ = app.emit("kb-updated", ());
        }
    });
    Ok(())
}

#[tauri::command]
fn kb_tree(app: AppHandle, state: State<AppState>) -> Result<Vec<kb::KbNode>> {
    let root = kb_root(&state)?;
    let tree = kb::tree(&root)?;
    ensure_kb_watcher(&app, &state, &root)?;
    Ok(tree)
}

#[tauri::command]
fn kb_read(state: State<AppState>, path: String) -> Result<String> {
    kb::read(&kb_root(&state)?, &path)
}

#[tauri::command]
fn kb_write(state: State<AppState>, path: String, content: String) -> Result<()> {
    kb::write(&kb_root(&state)?, &path, &content)
}

#[tauri::command]
fn kb_create(state: State<AppState>, path: String) -> Result<String> {
    kb::create(&kb_root(&state)?, &path)
}

#[tauri::command]
fn kb_rename(state: State<AppState>, from: String, to: String) -> Result<()> {
    kb::rename(&kb_root(&state)?, &from, &to)
}

#[tauri::command]
fn kb_delete(state: State<AppState>, path: String) -> Result<()> {
    kb::delete(&kb_root(&state)?, &path)
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
            journal_template_set,
            kb_tree,
            kb_read,
            kb_write,
            kb_create,
            kb_rename,
            kb_delete,
            dashboard_context,
            birthdays_list,
            scheduled_add,
            birthday_add,
            config_file_get,
            config_file_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running app-pkb");
}
