mod backup;
mod config;
mod config_files;
mod db;
mod engine;
mod error;
mod journal;
mod kb;
mod reminders;
mod tasks;
mod tasks_mirror;
mod vault;
mod views;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
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
    /// Serializes engine passes: the config watcher runs them on its own
    /// DB connection, and two concurrent passes would interleave their
    /// dedup/reconcile statements (and can hit SQLITE_BUSY under WAL).
    engine_lock: Arc<Mutex<()>>,
    /// Watcher over <vault>/tasks/ importing outside edits of the task
    /// mirror files.
    tasks_watcher: Mutex<Option<notify::RecommendedWatcher>>,
    /// Content of every mirror file as we last wrote it: the tasks
    /// watcher skips files that still match, so our own exports never
    /// trigger an import round-trip.
    mirror_written: Arc<Mutex<HashMap<PathBuf, String>>>,
}

/// Shared filter for both filesystem watchers: access events carry no
/// content change, and `.<name>.tmp` files are our own write_atomic
/// staging - reacting to them would run an engine pass per save twice.
fn watch_event_is_relevant(event: &notify::Event) -> bool {
    if matches!(event.kind, notify::EventKind::Access(_)) {
        return false;
    }
    let only_tmp = !event.paths.is_empty()
        && event.paths.iter().all(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with('.') && name.ends_with(".tmp"))
                .unwrap_or(false)
        });
    !only_tmp
}

fn app_config_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|e| Error::State(format!("cannot resolve app config dir: {e}")))
}

/// Watches the user configs and the app settings folder and, after a
/// debounce, reloads app.yml, runs the engine, and notifies the
/// frontend (req. 18, safe reload per 19).
fn start_config_watcher(app: AppHandle, root: &Path) -> Result<()> {
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            if watch_event_is_relevant(&event) {
                let _ = tx.send(());
            }
        }
    })
    .map_err(|e| Error::State(format!("cannot start config watcher: {e}")))?;
    // recursive: YAML task packs in subfolders merge into the config
    watcher
        .watch(&vault::config_dir(root), RecursiveMode::Recursive)
        .map_err(|e| Error::State(format!("cannot watch config dir: {e}")))?;
    // app.yml lives apart from the user configs; watch its folder too
    if let Some(settings_dir) = vault::settings_file(root).parent() {
        let _ = std::fs::create_dir_all(settings_dir);
        watcher
            .watch(settings_dir, RecursiveMode::NonRecursive)
            .map_err(|e| Error::State(format!("cannot watch settings dir: {e}")))?;
    }

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
            let engine_lock = state.engine_lock.clone();
            let written = state.mirror_written.clone();
            let outcome = {
                let _pass = engine_lock.lock().unwrap();
                db::open(&vault::db_path(&root)).and_then(|conn| {
                    let outcome = engine::run(
                        &conn,
                        &vault::config_dir(&root),
                        &config,
                        chrono::Local::now(),
                    )?;
                    // the pass may have moved manual tasks (overdue
                    // carry-over), so the text mirror must follow
                    if config.tasks_mirror {
                        if let Ok(files) = tasks_mirror::export(
                            &conn,
                            &vault::tasks_dir(&root),
                            &today_string(),
                            &Default::default(),
                            config.tasks_mirror_ids,
                        ) {
                            *written.lock().unwrap() = files.into_iter().collect();
                        }
                    }
                    Ok(outcome)
                })
            };
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

fn today_string() -> String {
    chrono::Local::now()
        .date_naive()
        .format("%Y-%m-%d")
        .to_string()
}

/// Rewrites the task mirror files after a database change. Best effort
/// by design: a failing export must not fail the command that made the
/// change - the next successful export catches the files up.
fn mirror_export_with(
    vault: &Vault,
    written: &Arc<Mutex<std::collections::HashMap<PathBuf, String>>>,
) {
    if !vault.config.tasks_mirror {
        return;
    }
    if let Ok(files) = tasks_mirror::export(
        &vault.conn,
        &vault::tasks_dir(&vault.root),
        &today_string(),
        &Default::default(),
        vault.config.tasks_mirror_ids,
    ) {
        *written.lock().unwrap() = files.into_iter().collect();
    }
}

fn mirror_export(state: &State<'_, AppState>) {
    let guard = state.vault.lock().unwrap();
    if let Some(vault) = guard.as_ref() {
        mirror_export_with(vault, &state.mirror_written);
    }
}

/// Watches <vault>/tasks and, after a debounce, imports outside edits of
/// the mirror files, then re-exports to normalize them (assign ids to
/// new lines, restore deleted managed files).
fn start_tasks_watcher(app: AppHandle, tasks_dir: &Path) -> Result<()> {
    let _ = std::fs::create_dir_all(tasks_dir);
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            if watch_event_is_relevant(&event) {
                let _ = tx.send(());
            }
        }
    })
    .map_err(|e| Error::State(format!("cannot start tasks watcher: {e}")))?;
    watcher
        .watch(tasks_dir, RecursiveMode::NonRecursive)
        .map_err(|e| Error::State(format!("cannot watch tasks dir: {e}")))?;
    let state = app.state::<AppState>();
    *state.tasks_watcher.lock().unwrap() = Some(watcher);

    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            std::thread::sleep(Duration::from_millis(500));
            while rx.try_recv().is_ok() {}

            let state = app.state::<AppState>();
            let snapshot = {
                let guard = state.vault.lock().unwrap();
                guard.as_ref().map(|vault| {
                    (
                        vault.root.clone(),
                        vault.config.tasks_mirror,
                        vault.config.tasks_mirror_ids,
                    )
                })
            };
            let Some((root, enabled, ids)) = snapshot else {
                continue;
            };
            if !enabled {
                continue;
            }
            let engine_lock = state.engine_lock.clone();
            let written = state.mirror_written.clone();
            let today = today_string();
            let dir = vault::tasks_dir(&root);
            let mut errors: Vec<config_files::ConfigError> = Vec::new();
            let mut changed = false;
            {
                // the engine also writes tasks; imports must not
                // interleave with a running pass
                let _pass = engine_lock.lock().unwrap();
                let Ok(conn) = db::open(&vault::db_path(&root)) else {
                    continue;
                };
                let mut failed: std::collections::HashSet<PathBuf> =
                    std::collections::HashSet::new();
                let entries = std::fs::read_dir(&dir)
                    .map(|it| it.flatten().collect::<Vec<_>>())
                    .unwrap_or_default();
                for entry in entries {
                    let path = entry.path();
                    let name = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or_default()
                        .to_string();
                    if path.extension().and_then(|e| e.to_str()) != Some("md")
                        || name.starts_with('.')
                    {
                        continue;
                    }
                    let Ok(content) = std::fs::read_to_string(&path) else {
                        continue;
                    };
                    let same = written
                        .lock()
                        .unwrap()
                        .get(&path)
                        .map(|c| *c == content)
                        .unwrap_or(false);
                    if same {
                        continue;
                    }
                    match tasks_mirror::import_file(&conn, &path, &content, &today, ids) {
                        Ok(applied) => changed |= applied,
                        Err(e) => {
                            // the broken file stays untouched (skipped
                            // below) so the user can fix it in place
                            failed.insert(path);
                            errors.push(config_files::ConfigError {
                                file: format!("tasks/{name}"),
                                line: None,
                                message: e.to_string(),
                            });
                        }
                    }
                }
                if let Ok(files) = tasks_mirror::export(&conn, &dir, &today, &failed, ids) {
                    *written.lock().unwrap() = files.into_iter().collect();
                }
            }
            if changed || !errors.is_empty() {
                let _ = app.emit("vault-updated", errors);
            }
        }
    });
    Ok(())
}

fn open_vault(app: &AppHandle, state: &State<'_, AppState>, root: &Path) -> Result<AppConfig> {
    let vault = Vault::open(root)?;
    journal::ensure_template_location(root);
    let config = vault.config.clone();
    *state.vault.lock().unwrap() = Some(vault);
    // Always rebind: re-selecting a vault must watch the NEW config dir.
    // Replacing the watcher drops the old one, which closes its channel
    // and lets the old debounce thread exit.
    start_config_watcher(app.clone(), root)?;
    if config.tasks_mirror {
        mirror_export(state);
        let _ = start_tasks_watcher(app.clone(), &vault::tasks_dir(root));
    } else {
        *state.tasks_watcher.lock().unwrap() = None;
    }
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
async fn config_set(app: AppHandle, state: State<'_, AppState>, config: AppConfig) -> Result<()> {
    let (root, mirror_was, mirror_now) = {
        let mut guard = state.vault.lock().unwrap();
        let vault = guard
            .as_mut()
            .ok_or_else(|| Error::State("no vault selected".into()))?;
        let was = vault.config.tasks_mirror;
        vault.save_config(config)?;
        (vault.root.clone(), was, vault.config.tasks_mirror)
    };
    // the task mirror toggle takes effect immediately
    if mirror_now && !mirror_was {
        mirror_export(&state);
        let _ = start_tasks_watcher(app, &vault::tasks_dir(&root));
    } else if !mirror_now && mirror_was {
        // dropping the watcher closes its channel and ends the thread;
        // the files stay on disk but are no longer read or written
        *state.tasks_watcher.lock().unwrap() = None;
    }
    Ok(())
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
    let list = with_conn(&state, |conn| {
        tasks::list_create(conn, &name, color.as_deref(), false)
    })?;
    mirror_export(&state);
    Ok(list)
}

#[tauri::command]
async fn list_rename(state: State<'_, AppState>, id: i64, name: String) -> Result<()> {
    with_conn(&state, |conn| tasks::list_rename(conn, id, &name))?;
    mirror_export(&state);
    Ok(())
}

#[tauri::command]
async fn list_set_favorite(state: State<'_, AppState>, id: i64, favorite: bool) -> Result<()> {
    with_conn(&state, |conn| tasks::list_set_favorite(conn, id, favorite))
}

#[tauri::command]
async fn list_set_meta(
    state: State<'_, AppState>,
    id: i64,
    color: Option<String>,
    description: String,
) -> Result<()> {
    with_conn(&state, |conn| {
        tasks::list_set_meta(conn, id, color.as_deref(), &description)
    })
}

#[tauri::command]
async fn list_archive(state: State<'_, AppState>, id: i64) -> Result<()> {
    with_conn(&state, |conn| tasks::list_archive(conn, id))?;
    mirror_export(&state);
    Ok(())
}

#[tauri::command]
async fn lists_archived(state: State<'_, AppState>) -> Result<Vec<tasks::List>> {
    with_conn(&state, tasks::lists_archived)
}

#[tauri::command]
async fn list_unarchive(state: State<'_, AppState>, id: i64) -> Result<()> {
    with_conn(&state, |conn| tasks::list_unarchive(conn, id))?;
    mirror_export(&state);
    Ok(())
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
    let task = with_conn(&state, |conn| tasks::task_create(conn, &new))?;
    mirror_export(&state);
    Ok(task)
}

#[tauri::command]
async fn task_update(
    state: State<'_, AppState>,
    id: i64,
    patch: tasks::TaskPatch,
) -> Result<tasks::Task> {
    let task = with_conn(&state, |conn| tasks::task_update(conn, id, &patch))?;
    mirror_export(&state);
    Ok(task)
}

#[tauri::command]
async fn task_delete(state: State<'_, AppState>, id: i64) -> Result<tasks::DeletedTasks> {
    let deleted = with_conn(&state, |conn| tasks::task_delete(conn, id))?;
    mirror_export(&state);
    Ok(deleted)
}

#[tauri::command]
async fn task_restore(
    state: State<'_, AppState>,
    deleted: tasks::DeletedTasks,
) -> Result<Vec<tasks::Task>> {
    let restored = with_conn(&state, |conn| tasks::task_restore(conn, &deleted))?;
    mirror_export(&state);
    Ok(restored)
}

#[tauri::command]
async fn tasks_delete_done(state: State<'_, AppState>) -> Result<usize> {
    let count = with_conn(&state, tasks::tasks_delete_done)?;
    mirror_export(&state);
    Ok(count)
}

#[tauri::command]
async fn tasks_reorder(
    state: State<'_, AppState>,
    list_id: i64,
    ordered_ids: Vec<i64>,
) -> Result<()> {
    with_conn(&state, |conn| {
        tasks::list_reorder(conn, list_id, &ordered_ids)
    })?;
    mirror_export(&state);
    Ok(())
}

#[tauri::command]
async fn engine_run(state: State<'_, AppState>) -> Result<engine::EngineOutcome> {
    // taken before the vault lock is held for the pass; the watcher
    // thread takes only the engine lock while running, so there is no
    // lock-order cycle
    let engine_lock = state.engine_lock.clone();
    let _pass = engine_lock.lock().unwrap();
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
    // the pass may have created/moved tasks; keep the text mirror fresh
    // (inline: the vault guard is still held, mirror_export would deadlock)
    mirror_export_with(vault, &state.mirror_written);
    Ok(outcome)
}

#[tauri::command]
async fn upcoming_events(state: State<'_, AppState>) -> Result<views::UpcomingResult> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    let (events, errors) = views::upcoming_events(
        &vault.conn,
        &vault.config_dir(),
        chrono::Local::now().date_naive(),
    )?;
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
async fn journal_search(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<journal::JournalSearchHit>> {
    with_vault_root(&state, |root| journal::search_entries(root, &query))
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
async fn calendar_outlook(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> Result<Vec<views::OutlookEvent>> {
    let parse = |s: &str| {
        chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
            .map_err(|_| Error::State(format!("invalid date '{s}'")))
    };
    let (from, to) = (parse(&from)?, parse(&to)?);
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    Ok(views::calendar_outlook(
        &vault.config_dir(),
        &vault.config,
        from,
        to,
        chrono::Local::now(),
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
    backup_config(&state, "recurring.yml");
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
    backup_config(&state, "scheduled.yml");
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
    backup_config(&state, "birthdays.yml");
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
    backup_config(&state, "recurring.yml");
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
    backup_config(&state, "scheduled.yml");
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
    backup_config(&state, "birthdays.yml");
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    config_files::edit_birthday(&vault.config_dir(), original, replacement)
}

#[tauri::command]
async fn reminders_overview(state: State<'_, AppState>) -> Result<reminders::RemindersOverview> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    reminders::overview(
        &vault.conn,
        &vault.config_dir(),
        chrono::Local::now().date_naive(),
    )
}

#[tauri::command]
async fn focus_phrase_add(state: State<'_, AppState>, phrase: String) -> Result<()> {
    backup_config(&state, "weekly-focus.yml");
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    config_files::append_focus_phrase(&vault.config_dir(), phrase)
}

#[tauri::command]
async fn focus_phrase_edit(
    state: State<'_, AppState>,
    index: usize,
    replacement: Option<String>,
) -> Result<()> {
    backup_config(&state, "weekly-focus.yml");
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    config_files::edit_focus_phrase(&vault.config_dir(), index, replacement)
}

#[tauri::command]
async fn day_reminder_add(state: State<'_, AppState>, entry: reminders::DayReminder) -> Result<()> {
    backup_config(&state, "day-reminders.yml");
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    config_files::append_day_reminder(&vault.config_dir(), entry)
}

#[tauri::command]
async fn day_reminder_edit(
    state: State<'_, AppState>,
    index: usize,
    replacement: Option<reminders::DayReminder>,
) -> Result<()> {
    backup_config(&state, "day-reminders.yml");
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    config_files::edit_day_reminder(&vault.config_dir(), index, replacement)
}

#[tauri::command]
async fn schedule_block_add(
    state: State<'_, AppState>,
    block: reminders::ScheduleBlock,
) -> Result<()> {
    backup_config(&state, "day-schedule.yml");
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    config_files::append_schedule_block(&vault.config_dir(), block)
}

#[tauri::command]
async fn schedule_block_edit(
    state: State<'_, AppState>,
    index: usize,
    replacement: Option<reminders::ScheduleBlock>,
) -> Result<()> {
    backup_config(&state, "day-schedule.yml");
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    config_files::edit_schedule_block(&vault.config_dir(), index, replacement)
}

const EDITABLE_CONFIG_FILES: &[&str] = &[
    "recurring.yml",
    "scheduled.yml",
    "birthdays.yml",
    "weekly-focus.yml",
    "day-reminders.yml",
    "day-schedule.yml",
    "templates/journal.md",
];

fn is_editable_config_file(file: &str) -> bool {
    EDITABLE_CONFIG_FILES.contains(&file)
}

fn editable_config_path(state: &State<'_, AppState>, file: &str) -> Result<PathBuf> {
    if !is_editable_config_file(file) {
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
    // A read failure must surface: showing the file as empty would let
    // the next save in the editor overwrite the real content.
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(Error::State(format!("cannot read {file}: {e}"))),
    }
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
        backup_config(&state, &file);
        vault::write_atomic(&path, &content)?;
    }
    Ok(errors)
}

/// Copies the file aside before a programmatic rewrite. Best effort by
/// design: a failing backup must not block the edit itself.
fn backup_config(state: &State<'_, AppState>, file: &str) {
    let guard = state.vault.lock().unwrap();
    if let Some(vault) = guard.as_ref() {
        let _ = backup::backup_config_file(
            &vault.config_dir(),
            file,
            vault.config.backup_keep,
            chrono::Local::now(),
        );
    }
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
        if let Ok(event) = event {
            if watch_event_is_relevant(&event) {
                let _ = tx.send(());
            }
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
async fn kb_copy(state: State<'_, AppState>, from: String, to_dir: String) -> Result<String> {
    kb::copy_into(&kb_root(&state)?, &from, &to_dir)
}

#[tauri::command]
async fn kb_delete(state: State<'_, AppState>, path: String) -> Result<()> {
    kb::delete(&kb_root(&state)?, &path)
}

#[tauri::command]
async fn kb_mkdir(state: State<'_, AppState>, path: String) -> Result<String> {
    kb::create_dir(&kb_root(&state)?, &path)
}

/// Absolute path of a note or folder, for "copy path" in the tree.
/// "" is the KB root itself.
#[tauri::command]
async fn kb_abs_path(state: State<'_, AppState>, path: String) -> Result<String> {
    Ok(kb::abs_path(&kb_root(&state)?, &path)?
        .to_string_lossy()
        .into_owned())
}

/// Shows a note or folder in the system file manager. Only paths inside
/// the KB root resolve, and the path is passed as a single argument -
/// no shell is involved.
#[tauri::command]
async fn kb_reveal(state: State<'_, AppState>, path: String) -> Result<()> {
    let target = kb::abs_path(&kb_root(&state)?, &path)?;
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("explorer.exe");
        if target.is_dir() {
            c.arg(&target);
        } else {
            // /select, and the path must reach explorer as one argument
            c.arg(format!("/select,{}", target.display()));
        }
        c
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = std::process::Command::new("open");
        if target.is_dir() {
            c.arg(&target);
        } else {
            c.arg("-R").arg(&target);
        }
        c
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = {
        let mut c = std::process::Command::new("xdg-open");
        // no portable "select the file" on Linux: open the folder
        c.arg(if target.is_dir() {
            target.clone()
        } else {
            target.parent().unwrap_or(&target).to_path_buf()
        });
        c
    };
    command.spawn()?;
    Ok(())
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
async fn daily_streaks(state: State<'_, AppState>) -> Result<Vec<views::DailyStreak>> {
    with_conn(&state, |conn| {
        views::daily_streaks(conn, chrono::Local::now().date_naive())
    })
}

#[tauri::command]
async fn task_get(state: State<'_, AppState>, id: i64) -> Result<tasks::Task> {
    with_conn(&state, |conn| tasks::task_get(conn, id))
}

/// Only web and mail links leave the app, and only as a single argument
/// to the platform launcher - no shell, so nothing in the URL can be
/// read as a command.
fn is_openable_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if !["http://", "https://", "mailto:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
    {
        return false;
    }
    !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Opens a link from a note or a task description in the system browser
/// (the webview would otherwise navigate the app itself).
#[tauri::command]
async fn open_external(url: String) -> Result<()> {
    let url = url.trim().to_string();
    if !is_openable_url(&url) {
        return Err(Error::State(format!("refusing to open {url}")));
    }
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("rundll32.exe");
        c.arg("url.dll,FileProtocolHandler").arg(&url);
        c
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = std::process::Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&url);
        c
    };
    command.spawn()?;
    Ok(())
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
        .plugin(tauri_plugin_notification::init())
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
            list_set_favorite,
            list_set_meta,
            list_archive,
            lists_archived,
            list_unarchive,
            tasks_snapshot,
            task_create,
            task_update,
            task_delete,
            task_restore,
            tasks_delete_done,
            tasks_reorder,
            engine_run,
            upcoming_events,
            journal_open,
            journal_save,
            journal_list,
            journal_search,
            kb_tree,
            kb_read,
            kb_write,
            kb_create,
            kb_rename,
            kb_copy,
            kb_delete,
            kb_mkdir,
            kb_abs_path,
            kb_reveal,
            dashboard_context,
            birthdays_list,
            calendar_outlook,
            recurring_list,
            recurring_add,
            scheduled_add,
            birthday_add,
            recurring_edit,
            scheduled_edit,
            birthday_edit,
            reminders_overview,
            focus_phrase_add,
            focus_phrase_edit,
            day_reminder_add,
            day_reminder_edit,
            schedule_block_add,
            schedule_block_edit,
            config_file_get,
            config_file_set,
            kb_search,
            tasks_search,
            daily_streaks,
            task_get,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running hypomnema");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editable_config_allowlist_blocks_everything_else() {
        assert!(is_editable_config_file("recurring.yml"));
        assert!(is_editable_config_file("templates/journal.md"));
        assert!(!is_editable_config_file("app.yml"));
        assert!(!is_editable_config_file("../app.yml"));
        assert!(!is_editable_config_file("../../etc/passwd"));
        assert!(!is_editable_config_file("recurring.yml/../app.yml"));
        assert!(!is_editable_config_file(""));
    }

    #[test]
    fn only_web_and_mail_urls_leave_the_app() {
        assert!(is_openable_url("https://example.com/a?b=1#c"));
        assert!(is_openable_url("HTTP://example.com"));
        assert!(is_openable_url("mailto:me@example.com"));
        assert!(!is_openable_url("file:///etc/passwd"));
        assert!(!is_openable_url("javascript:alert(1)"));
        assert!(!is_openable_url("C:\\Windows\\System32\\calc.exe"));
        assert!(!is_openable_url("https://example.com/a b"));
        assert!(!is_openable_url("https://example.com/\na"));
        assert!(!is_openable_url(""));
    }

    #[test]
    fn watcher_ignores_access_events_and_own_tmp_files() {
        use notify::{event::AccessKind, Event, EventKind};
        let modify = Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
            .add_path("/vault/config/recurring.yml".into());
        assert!(watch_event_is_relevant(&modify));

        let access = Event::new(EventKind::Access(AccessKind::Any))
            .add_path("/vault/config/recurring.yml".into());
        assert!(!watch_event_is_relevant(&access));

        let tmp = Event::new(EventKind::Create(notify::event::CreateKind::Any))
            .add_path("/vault/config/.recurring.yml.tmp".into());
        assert!(!watch_event_is_relevant(&tmp));

        // a mixed batch with one real path still counts
        let mixed = Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
            .add_path("/vault/config/.recurring.yml.tmp".into())
            .add_path("/vault/config/recurring.yml".into());
        assert!(watch_event_is_relevant(&mixed));

        // pathless events (some platforms emit them) are not dropped
        let bare = Event::new(EventKind::Modify(notify::event::ModifyKind::Any));
        assert!(watch_event_is_relevant(&bare));
    }
}
