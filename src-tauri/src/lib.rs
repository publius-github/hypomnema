mod config;
mod config_files;
mod db;
mod engine;
mod error;
mod journal;
mod kb;
mod reminders;
mod tasks;
mod vault;
mod views;

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

            // Hold the vault lock only long enough to reload app.yml and
            // snapshot what the pass needs; the engine then runs on its
            // own connection (WAL + busy_timeout make that safe), so a
            // slow disk cannot stall every command behind this thread.
            let state = app.state::<AppState>();
            let snapshot = {
                let mut guard = state.vault.lock().unwrap();
                guard.as_mut().map(|vault| {
                    let _ = vault.reload_config();
                    (
                        vault.root.clone(),
                        vault.config.clone(),
                        vault.config_error.clone(),
                    )
                })
            };
            let Some((root, config, config_error)) = snapshot else {
                continue;
            };
            let outcome = db::open(&root.join("app.db")).and_then(|conn| {
                engine::run(&conn, &root.join("config"), &config, chrono::Local::now())
            });
            let mut errors = outcome.map(|o| o.errors).unwrap_or_default();
            if let Some(msg) = config_error {
                errors.push(config_files::ConfigError {
                    file: "app.yml".into(),
                    line: None,
                    message: msg,
                });
            }
            let _ = app.emit("vault-updated", errors);
        }
    });
    Ok(())
}

fn open_vault(app: &AppHandle, state: &State<'_, AppState>, root: &Path) -> Result<AppConfig> {
    let vault = Vault::open(root)?;
    let config = vault.config.clone();
    let config_dir = vault.config_dir();
    *state.vault.lock().unwrap() = Some(vault);
    // Always rebind: re-selecting a vault must watch the NEW config dir.
    // Replacing the watcher drops the old one, which closes its channel
    // and lets the old debounce thread exit.
    start_config_watcher(app.clone(), &config_dir)?;
    Ok(config)
}

#[tauri::command]
async fn vault_status(app: AppHandle, state: State<'_, AppState>) -> Result<Option<String>> {
    let Some(path) = vault::read_vault_path(&app_config_dir(&app)?) else {
        return Ok(None);
    };
    open_vault(&app, &state, &path)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn vault_select(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<AppConfig> {
    let root = PathBuf::from(&path);
    let config = open_vault(&app, &state, &root)?;
    vault::write_vault_path(&app_config_dir(&app)?, &root)?;
    Ok(config)
}

#[tauri::command]
async fn config_get(state: State<'_, AppState>) -> Result<AppConfig> {
    let guard = state.vault.lock().unwrap();
    guard
        .as_ref()
        .map(|vault| vault.config.clone())
        .ok_or_else(|| Error::State("no vault selected".into()))
}

#[tauri::command]
async fn config_set(state: State<'_, AppState>, config: AppConfig) -> Result<()> {
    let mut guard = state.vault.lock().unwrap();
    let vault = guard
        .as_mut()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    vault.save_config(config)
}

fn with_conn<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T>,
) -> Result<T> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    f(&vault.conn)
}

#[tauri::command]
async fn lists_all(state: State<'_, AppState>) -> Result<Vec<tasks::List>> {
    with_conn(&state, tasks::lists_all)
}

#[tauri::command]
async fn list_create(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> Result<tasks::List> {
    with_conn(&state, |conn| {
        tasks::list_create(conn, &name, color.as_deref(), false)
    })
}

#[tauri::command]
async fn list_rename(state: State<'_, AppState>, id: i64, name: String) -> Result<()> {
    with_conn(&state, |conn| tasks::list_rename(conn, id, &name))
}

#[tauri::command]
async fn list_archive(state: State<'_, AppState>, id: i64) -> Result<()> {
    with_conn(&state, |conn| tasks::list_archive(conn, id))
}

#[tauri::command]
async fn lists_archived(state: State<'_, AppState>) -> Result<Vec<tasks::List>> {
    with_conn(&state, tasks::lists_archived)
}

#[tauri::command]
async fn list_unarchive(state: State<'_, AppState>, id: i64) -> Result<()> {
    with_conn(&state, |conn| tasks::list_unarchive(conn, id))
}

#[tauri::command]
async fn tasks_snapshot(
    state: State<'_, AppState>,
    start_date: String,
    end_date: String,
) -> Result<Vec<tasks::Task>> {
    with_conn(&state, |conn| {
        tasks::tasks_snapshot(conn, &start_date, &end_date)
    })
}

#[tauri::command]
async fn task_create(state: State<'_, AppState>, new: tasks::NewTask) -> Result<tasks::Task> {
    with_conn(&state, |conn| tasks::task_create(conn, &new))
}

#[tauri::command]
async fn task_update(
    state: State<'_, AppState>,
    id: i64,
    patch: tasks::TaskPatch,
) -> Result<tasks::Task> {
    with_conn(&state, |conn| tasks::task_update(conn, id, &patch))
}

#[tauri::command]
async fn task_delete(state: State<'_, AppState>, id: i64) -> Result<()> {
    with_conn(&state, |conn| tasks::task_delete(conn, id))
}

#[tauri::command]
async fn tasks_delete_done(state: State<'_, AppState>) -> Result<usize> {
    with_conn(&state, tasks::tasks_delete_done)
}

#[tauri::command]
async fn engine_run(state: State<'_, AppState>) -> Result<engine::EngineOutcome> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
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
    Ok(outcome)
}

#[tauri::command]
async fn upcoming_events(state: State<'_, AppState>) -> Result<views::UpcomingResult> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    let (events, errors) = views::upcoming_events(&vault.conn, &vault.config_dir())?;
    Ok(views::UpcomingResult { events, errors })
}

fn with_vault_root<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&Path) -> Result<T>,
) -> Result<T> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    f(&vault.root)
}

#[tauri::command]
async fn journal_open(state: State<'_, AppState>, date: String) -> Result<journal::JournalEntry> {
    with_vault_root(&state, |root| journal::open_entry(root, &date))
}

#[tauri::command]
async fn journal_save(state: State<'_, AppState>, date: String, content: String) -> Result<()> {
    with_vault_root(&state, |root| journal::save_entry(root, &date, &content))
}

#[tauri::command]
async fn journal_list(state: State<'_, AppState>) -> Result<Vec<String>> {
    with_vault_root(&state, journal::list_entries)
}

#[tauri::command]
async fn journal_template_get(state: State<'_, AppState>) -> Result<String> {
    with_vault_root(&state, journal::read_template)
}

#[tauri::command]
async fn journal_template_set(state: State<'_, AppState>, content: String) -> Result<()> {
    with_vault_root(&state, |root| journal::save_template(root, &content))
}

#[tauri::command]
async fn dashboard_context(
    state: State<'_, AppState>,
    dates: Vec<String>,
) -> Result<reminders::DashboardContext> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    reminders::dashboard_context(&vault.conn, &vault.config_dir(), &dates)
}

#[tauri::command]
async fn birthdays_list(state: State<'_, AppState>) -> Result<views::BirthdaysResult> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    Ok(views::birthdays_list(
        &vault.config_dir(),
        chrono::Local::now().date_naive(),
    ))
}

#[tauri::command]
async fn recurring_list(state: State<'_, AppState>) -> Result<views::RecurringResult> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    Ok(views::recurring_list(&vault.config_dir()))
}

#[tauri::command]
async fn recurring_add(
    state: State<'_, AppState>,
    rule: config_files::RecurringRule,
) -> Result<()> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    config_files::append_recurring(&vault.config_dir(), rule)
}

#[tauri::command]
async fn scheduled_add(
    state: State<'_, AppState>,
    event: config_files::ScheduledEvent,
) -> Result<()> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    config_files::append_scheduled(&vault.config_dir(), event)
}

#[tauri::command]
async fn birthday_add(
    state: State<'_, AppState>,
    entry: config_files::BirthdayEntry,
) -> Result<()> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    config_files::append_birthday(&vault.config_dir(), entry)
}

#[tauri::command]
async fn recurring_edit(
    state: State<'_, AppState>,
    index: usize,
    replacement: Option<config_files::RecurringRule>,
) -> Result<()> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    config_files::edit_recurring(&vault.config_dir(), index, replacement)
}

#[tauri::command]
async fn scheduled_edit(
    state: State<'_, AppState>,
    original: config_files::ScheduledEvent,
    replacement: Option<config_files::ScheduledEvent>,
) -> Result<()> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    config_files::edit_scheduled(&vault.config_dir(), original, replacement)
}

#[tauri::command]
async fn birthday_edit(
    state: State<'_, AppState>,
    original: config_files::BirthdayEntry,
    replacement: Option<config_files::BirthdayEntry>,
) -> Result<()> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    config_files::edit_birthday(&vault.config_dir(), original, replacement)
}

const EDITABLE_CONFIG_FILES: &[&str] = &[
    "recurring.yml",
    "scheduled.yml",
    "birthdays.yml",
    "weekly-focus.yml",
    "day-reminders.yml",
    "day-schedule.yml",
];

fn editable_config_path(state: &State<'_, AppState>, file: &str) -> Result<PathBuf> {
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
async fn config_file_get(state: State<'_, AppState>, file: String) -> Result<String> {
    let path = editable_config_path(&state, &file)?;
    Ok(std::fs::read_to_string(path).unwrap_or_default())
}

/// Validates and, when valid, writes the config file. Invalid content is
/// never written, so the last valid state stays active (req. 19).
#[tauri::command]
async fn config_file_set(
    state: State<'_, AppState>,
    file: String,
    content: String,
) -> Result<Vec<config_files::ConfigError>> {
    let path = editable_config_path(&state, &file)?;
    let errors = config_files::validate_config_content(&file, &content);
    if errors.is_empty() {
        vault::write_atomic(&path, &content)?;
    }
    Ok(errors)
}

fn kb_root(state: &State<'_, AppState>) -> Result<PathBuf> {
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
fn ensure_kb_watcher(app: &AppHandle, state: &State<'_, AppState>, root: &Path) -> Result<()> {
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
async fn kb_tree(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<kb::KbNode>> {
    let root = kb_root(&state)?;
    let tree = kb::tree(&root)?;
    ensure_kb_watcher(&app, &state, &root)?;
    Ok(tree)
}

#[tauri::command]
async fn kb_read(state: State<'_, AppState>, path: String) -> Result<String> {
    kb::read(&kb_root(&state)?, &path)
}

#[tauri::command]
async fn kb_write(state: State<'_, AppState>, path: String, content: String) -> Result<()> {
    kb::write(&kb_root(&state)?, &path, &content)
}

#[tauri::command]
async fn kb_create(state: State<'_, AppState>, path: String) -> Result<String> {
    kb::create(&kb_root(&state)?, &path)
}

#[tauri::command]
async fn kb_rename(state: State<'_, AppState>, from: String, to: String) -> Result<()> {
    kb::rename(&kb_root(&state)?, &from, &to)
}

#[tauri::command]
async fn kb_delete(state: State<'_, AppState>, path: String) -> Result<()> {
    kb::delete(&kb_root(&state)?, &path)
}

#[tauri::command]
async fn kb_search(state: State<'_, AppState>, query: String) -> Result<Vec<kb::KbSearchHit>> {
    kb::search_content(&kb_root(&state)?, &query)
}

#[tauri::command]
async fn tasks_search(state: State<'_, AppState>, query: String) -> Result<Vec<tasks::Task>> {
    with_conn(&state, |conn| tasks::tasks_search(conn, &query))
}

#[tauri::command]
async fn task_get(state: State<'_, AppState>, id: i64) -> Result<tasks::Task> {
    with_conn(&state, |conn| tasks::task_get(conn, id))
}

#[tauri::command]
async fn task_restore(state: State<'_, AppState>, id: i64) -> Result<()> {
    with_conn(&state, |conn| tasks::task_restore(conn, id))
}

/// Panics land in <app-config-dir>/hypomnema.log so field errors are
/// diagnosable without a console (M7 error reporting).
fn install_panic_logger(log_path: PathBuf) {
    std::panic::set_hook(Box::new(move |info| {
        let line = format!(
            "{} PANIC {}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
            info
        );
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            use std::io::Write;
            let _ = file.write_all(line.as_bytes());
        }
        eprintln!("{line}");
    }));
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if let Ok(dir) = app.path().app_config_dir() {
                let _ = std::fs::create_dir_all(&dir);
                install_panic_logger(dir.join("hypomnema.log"));
            }
            Ok(())
        })
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
            lists_archived,
            list_unarchive,
            tasks_snapshot,
            task_create,
            task_update,
            task_delete,
            tasks_delete_done,
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
            recurring_list,
            recurring_add,
            scheduled_add,
            birthday_add,
            recurring_edit,
            scheduled_edit,
            birthday_edit,
            config_file_get,
            config_file_set,
            kb_search,
            tasks_search,
            task_get,
            task_restore
        ])
        .run(tauri::generate_context!())
        .expect("error while running hypomnema");
}
