mod backup;
mod config;
mod config_files;
mod db;
mod device;
mod dropbox_link;
mod engine;
mod error;
mod journal;
mod kb;
mod profiles;
mod reminders;
mod state_export;
mod sync_bootstrap;
mod sync_dropbox;
mod sync_dropbox_oauth;
mod sync_merge;
mod sync_paths;
mod sync_provider;
mod sync_push;
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
                    if config.state_snapshot {
                        let _ = state_export::export(&conn, &vault::state_dir(&root));
                    }
                    if config.tasks_mirror {
                        if let Ok(files) = tasks_mirror::export(
                            &conn,
                            &vault::tasks_dir(&root),
                            &vault::mirror_base_dir(&root),
                            &vault::config_dir(&root),
                            &today_string(),
                            &Default::default(),
                            &export_options(&config),
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
            // a hand-edited app.yml can change the shortcut or tray too
            if let Some(msg) = sync_global_shortcut(&app, &config) {
                errors.push(config_files::ConfigError {
                    file: "app.yml".into(),
                    line: None,
                    message: msg,
                });
            }
            sync_tray(&app, &config);
            let _ = app.emit("vault-updated", errors);
        }
    });
    Ok(())
}

/// The optional-file switches of a mirror export, from the config.
fn export_options(config: &AppConfig) -> tasks_mirror::ExportOptions {
    tasks_mirror::ExportOptions {
        ids: config.tasks_mirror_ids,
        agenda: config.tasks_mirror_agenda,
        today_file: config
            .tasks_mirror_today
            .then_some(config.tasks_mirror_today_days),
    }
}

// Only reached from the tray (`sync_tray`, desktop-only below) -
// `unminimize` itself is a desktop-only WebviewWindow method on mobile.
#[cfg(desktop)]
fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Shows and focuses the pre-created quick-capture window; the emit
/// tells its frontend to clear and refocus the input.
#[cfg(desktop)]
fn show_capture(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit_to("capture", "capture-shown", ());
    }
}

/// (Re-)registers the global capture shortcut from the config. Returns
/// a message for the error banner when the combination cannot be
/// parsed or is taken by another app - registration failure must never
/// block saving the config that caused it.
///
/// Desktop-only: global shortcuts and the tray (below) are desktop
/// concepts (REQUIREMENTS.md §6 mobile parity table) - mobile's quick-add
/// is in-app instead, so both get a no-op stub on mobile rather than
/// touching every call site.
#[cfg(desktop)]
fn sync_global_shortcut(app: &AppHandle, config: &AppConfig) -> Option<String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    let spec = config.capture_shortcut.trim();
    if spec.is_empty() {
        return None;
    }
    let shortcut = match spec.parse::<Shortcut>() {
        Ok(shortcut) => shortcut,
        Err(e) => return Some(format!("invalid capture shortcut '{spec}': {e}")),
    };
    let result = shortcuts.on_shortcut(shortcut, |app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            show_capture(app);
        }
    });
    result
        .err()
        .map(|e| format!("cannot register capture shortcut '{spec}': {e}"))
}

/// Creates or removes the tray icon to match the config. Best effort:
/// a platform without a tray must not take the app down.
#[cfg(desktop)]
fn sync_tray(app: &AppHandle, config: &AppConfig) {
    if !config.tray_icon {
        let _ = app.remove_tray_by_id("main");
        return;
    }
    if app.tray_by_id("main").is_some() {
        return;
    }
    let build = || -> tauri::Result<()> {
        let show =
            tauri::menu::MenuItem::with_id(app, "show", "Show Hypomnema", true, None::<&str>)?;
        let capture =
            tauri::menu::MenuItem::with_id(app, "capture", "Quick capture", true, None::<&str>)?;
        let quit = tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let menu = tauri::menu::Menu::with_items(app, &[&show, &capture, &quit])?;
        let mut builder = tauri::tray::TrayIconBuilder::with_id("main")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "show" => show_main(app),
                "capture" => show_capture(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let tauri::tray::TrayIconEvent::Click {
                    button: tauri::tray::MouseButton::Left,
                    button_state: tauri::tray::MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main(tray.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        builder.build(app)?;
        Ok(())
    };
    if let Err(e) = build() {
        eprintln!("tray icon failed: {e}");
    }
}

/// Mobile stubs: no global shortcut / tray on Android, so every call
/// site (config reload, vault open, initial setup) stays unchanged.
#[cfg(mobile)]
fn sync_global_shortcut(_app: &AppHandle, _config: &AppConfig) -> Option<String> {
    None
}

#[cfg(mobile)]
fn sync_tray(_app: &AppHandle, _config: &AppConfig) {}

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
    // the state snapshot rides the same triggers as the mirror but is
    // independent of it: it backs the db-less restore, not bulk editing
    if vault.config.state_snapshot {
        let _ = state_export::export(&vault.conn, &vault::state_dir(&vault.root));
    }
    if !vault.config.tasks_mirror {
        return;
    }
    if let Ok(files) = tasks_mirror::export(
        &vault.conn,
        &vault::tasks_dir(&vault.root),
        &vault::mirror_base_dir(&vault.root),
        &vault::config_dir(&vault.root),
        &today_string(),
        &Default::default(),
        &export_options(&vault.config),
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
                guard
                    .as_ref()
                    .map(|vault| (vault.root.clone(), vault.config.clone()))
            };
            let Some((root, config)) = snapshot else {
                continue;
            };
            if !config.tasks_mirror {
                continue;
            }
            let ids = config.tasks_mirror_ids;
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
                    // the merge base: this file as we last exported it
                    let base =
                        std::fs::read_to_string(vault::mirror_base_dir(&root).join(&name)).ok();
                    match tasks_mirror::import_file(
                        &conn,
                        &path,
                        &content,
                        &today,
                        ids,
                        base.as_deref(),
                    ) {
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
                if config.state_snapshot {
                    let _ = state_export::export(&conn, &vault::state_dir(&root));
                }
                if let Ok(files) = tasks_mirror::export(
                    &conn,
                    &dir,
                    &vault::mirror_base_dir(&root),
                    &vault::config_dir(&root),
                    &today,
                    &failed,
                    &export_options(&config),
                ) {
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
    // Tell this vault's database who is writing to it, so the merge
    // stamps (db.rs migration 016) carry a device and not a NULL. Best
    // effort: an unstamped row degrades a future merge, but failing to
    // open a vault over it would be worse.
    match app_config_dir(app).and_then(|dir| device::ensure(&dir)) {
        Ok(id) => {
            if let Err(e) = db::set_device_id(&vault.conn, &id) {
                eprintln!("could not record this device's id in the vault: {e}");
            }
        }
        Err(e) => eprintln!("could not determine this device's id: {e}"),
    }
    journal::ensure_template_location(root);
    let config = vault.config.clone();
    *state.vault.lock().unwrap() = Some(vault);
    // the vault's config replaces the defaults the app started with
    if let Some(msg) = sync_global_shortcut(app, &config) {
        eprintln!("{msg}");
    }
    sync_tray(app, &config);
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
    let (root, mirror_was, mirror_now, saved) = {
        let mut guard = state.vault.lock().unwrap();
        let vault = guard
            .as_mut()
            .ok_or_else(|| Error::State("no vault selected".into()))?;
        let was = vault.config.tasks_mirror;
        vault.save_config(config)?;
        (
            vault.root.clone(),
            was,
            vault.config.tasks_mirror,
            vault.config.clone(),
        )
    };
    // shortcut and tray follow the config immediately; a registration
    // failure reaches the banner but never blocks the save
    if let Some(msg) = sync_global_shortcut(&app, &saved) {
        let _ = app.emit(
            "vault-updated",
            vec![config_files::ConfigError {
                file: "app.yml".into(),
                line: None,
                message: msg,
            }],
        );
    }
    sync_tray(&app, &saved);
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

/// Factory defaults - the frontend's only source of "is this field at
/// its default?" for progressive disclosure and the Profiles tab.
#[tauri::command]
async fn config_default() -> Result<AppConfig> {
    Ok(AppConfig::default())
}

#[tauri::command]
async fn profiles_list(state: State<'_, AppState>) -> Result<Vec<String>> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    profiles::list(&vault.root)
}

/// Snapshots the live config under the given name; returns the fresh
/// profile list so the UI updates in one round trip.
#[tauri::command]
async fn profile_save(state: State<'_, AppState>, name: String) -> Result<Vec<String>> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    profiles::save(&vault.root, &vault.config, &name)?;
    profiles::list(&vault.root)
}

/// Applies a profile (or the built-in "Default") over the live config
/// and saves it. app.yml is backed up first - unlike a field edit, a
/// profile apply rewrites the whole visual surface in one move.
#[tauri::command]
async fn profile_apply(state: State<'_, AppState>, name: String) -> Result<AppConfig> {
    let mut guard = state.vault.lock().unwrap();
    let vault = guard
        .as_mut()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    let next = profiles::apply(&vault.root, &vault.config, &name)?;
    if let Some(settings_dir) = vault::settings_file(&vault.root).parent() {
        let _ = backup::backup_config_file(
            settings_dir,
            "app.yml",
            vault.config.backup_keep,
            chrono::Local::now(),
        );
    }
    vault.save_config(next)?;
    Ok(vault.config.clone())
}

#[tauri::command]
async fn profile_delete(state: State<'_, AppState>, name: String) -> Result<Vec<String>> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    profiles::delete(&vault.root, &name)?;
    profiles::list(&vault.root)
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

/// Creates a task in the quick-capture list (config.capture_list,
/// created on first use). Backs the capture window, which shares no
/// frontend state with the main window - the vault-updated emit is how
/// the main window learns about the new task.
#[tauri::command]
async fn capture_task(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
) -> Result<tasks::Task> {
    let task = {
        let guard = state.vault.lock().unwrap();
        let vault = guard
            .as_ref()
            .ok_or_else(|| Error::State("no vault selected".into()))?;
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
    mirror_export(&state);
    let _ = app.emit("vault-updated", Vec::<config_files::ConfigError>::new());
    Ok(task)
}

/// The quick-capture list, created on first use - the "move to backlog"
/// target for tasks that have no list of their own.
#[tauri::command]
async fn inbox_list(state: State<'_, AppState>) -> Result<tasks::List> {
    let list = {
        let guard = state.vault.lock().unwrap();
        let vault = guard
            .as_ref()
            .ok_or_else(|| Error::State("no vault selected".into()))?;
        tasks::ensure_inbox(&vault.conn, &vault.config.capture_list)?
    };
    mirror_export(&state);
    Ok(list)
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
async fn backups_list(state: State<'_, AppState>) -> Result<backup::BackupsOverview> {
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    backup::overview(&vault.root)
}

/// Restores app.db from a daily snapshot. The live connection is closed
/// first (Windows cannot overwrite an open file, and swapping the file
/// under an open SQLite handle is unsafe everywhere), the current
/// database is copied aside as its own safety net, then the vault is
/// reopened exactly as `vault_select` does.
#[tauri::command]
async fn backup_restore_db(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<AppConfig> {
    let root = {
        let guard = state.vault.lock().unwrap();
        let vault = guard
            .as_ref()
            .ok_or_else(|| Error::State("no vault selected".into()))?;
        vault.root.clone()
    };
    // drop the connection before touching the file on disk
    *state.vault.lock().unwrap() = None;
    backup::restore_db_backup(&root, &id, chrono::Local::now())?;
    open_vault(&app, &state, &root)
}

/// Restores one config or settings file from its backup in place; the
/// existing config-file watcher picks up the change and reloads it,
/// same as any other external edit.
#[tauri::command]
async fn backup_restore_config(state: State<'_, AppState>, id: String) -> Result<()> {
    let (root, keep) = {
        let guard = state.vault.lock().unwrap();
        let vault = guard
            .as_ref()
            .ok_or_else(|| Error::State("no vault selected".into()))?;
        (vault.root.clone(), vault.config.backup_keep)
    };
    backup::restore_config_backup(&root, &id, keep, chrono::Local::now())
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

/// Everything pointing at a note: notes (links and plain mentions),
/// journal entries and tasks. Discriminated by field - the panel
/// renders them as separate groups anyway.
#[derive(serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct BacklinksResult {
    pub links: Vec<kb::KbSearchHit>,
    pub mentions: Vec<kb::KbSearchHit>,
    pub journal: Vec<journal::JournalBacklinkHit>,
    pub tasks: Vec<tasks::TaskBacklinkHit>,
}

#[tauri::command]
async fn kb_backlinks(state: State<'_, AppState>, path: String) -> Result<BacklinksResult> {
    let target = std::path::Path::new(&path);
    let stem = target
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let full_name = target
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let kb_root = kb_root(&state)?;
    let guard = state.vault.lock().unwrap();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    let notes = kb::backlinks(&kb_root, &path)?;
    let journal = journal::backlinks(&vault.root, &stem, &full_name)?;
    let tasks = tasks::backlinks(&vault.conn, &stem, &full_name)?;
    // with the KB rooted at the vault, journal entries are inside the
    // note tree too; the dedicated journal scan is authoritative there
    let journal_inside = kb_root == vault.root;
    let drop_journal_notes = |hits: Vec<kb::KbSearchHit>| -> Vec<kb::KbSearchHit> {
        if !journal_inside {
            return hits;
        }
        hits.into_iter()
            .filter(|h| !h.path.starts_with("journal/"))
            .collect()
    };
    Ok(BacklinksResult {
        links: drop_journal_notes(notes.links),
        mentions: drop_journal_notes(notes.mentions),
        journal,
        tasks,
    })
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

/// True on Android. The frontend shows the Dropbox link screen instead of
/// the desktop folder picker when this is set: a phone has no synced vault
/// folder to point a picker at (docs/android/SPIKES.md, Spike A).
#[tauri::command]
fn platform_is_mobile() -> bool {
    cfg!(mobile)
}

fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Step 1 of linking: a fresh PKCE pair, its verifier saved to disk, and
/// the URL for the user to approve in a browser. On disk rather than in
/// memory because this flow leaves the app: Android may evict it while the
/// user is on the consent page (dropbox_link.rs).
#[tauri::command]
async fn dropbox_auth_url(app: AppHandle) -> Result<String> {
    let pkce = sync_dropbox_oauth::new_pkce_challenge()?;
    // No redirect_uri: Dropbox shows the code on screen for the user to
    // paste back, which keeps intent-filter plumbing out of the
    // regenerated gen/android project (ROADMAP.md Phase 1).
    let url = sync_dropbox_oauth::authorize_url(&pkce.challenge, None);
    dropbox_link::save_pending_auth(&app_config_dir(&app)?, &pkce.verifier, now_unix())?;
    Ok(url)
}

/// Step 2: trade the pasted code for tokens. Consumes the pending verifier
/// - code and verifier are both single-use, so a failed attempt has to
/// restart from the browser instead of retrying against a spent pair.
#[tauri::command]
async fn dropbox_connect(app: AppHandle, code: String) -> Result<dropbox_link::DropboxStatus> {
    let dir = app_config_dir(&app)?;
    let verifier = dropbox_link::take_pending_auth(&dir, now_unix())?;
    let tokens = sync_dropbox_oauth::exchange_code(
        &sync_dropbox_oauth::HttpOauthTransport::new(),
        code.trim(),
        &verifier,
        None,
    )?;
    dropbox_link::store_initial(&dir, &tokens, now_unix())?;
    dropbox_link::status(&dir, now_unix())
}

#[tauri::command]
async fn dropbox_status(app: AppHandle) -> Result<dropbox_link::DropboxStatus> {
    dropbox_link::status(&app_config_dir(&app)?, now_unix())
}

#[tauri::command]
async fn dropbox_disconnect(app: AppHandle) -> Result<()> {
    dropbox_link::clear(&app_config_dir(&app)?)
}

/// Smoke test for a fresh link: report what the App folder actually holds,
/// so a green result here means OAuth, token refresh, the HTTP client and
/// the App-folder scope all work end to end. Reports folder and tombstone
/// counts alongside the files, because "no files" alone doesn't say
/// whether the vault failed to sync or was never copied to this folder.
#[tauri::command]
async fn dropbox_list_files(app: AppHandle) -> Result<dropbox_link::DropboxListing> {
    let dir = app_config_dir(&app)?;
    let token = dropbox_link::valid_access_token(
        &dir,
        &sync_dropbox_oauth::HttpOauthTransport::new(),
        now_unix(),
    )?;
    let census = sync_dropbox::census(&sync_dropbox::HttpDropboxTransport::new(token))?;
    Ok(dropbox_link::DropboxListing {
        files: census.files,
        folders: census.folders,
        deleted: census.deleted,
    })
}

/// Pulls the shared vault from the linked app folder into this device's
/// private storage.
///
/// The local copy is where `app.db` will be rebuilt and where the engine
/// will run - it never goes back up, because `sync_paths` does not list
/// it as shared. Nothing opens the vault yet; this lands the files.
#[tauri::command]
async fn dropbox_pull_vault(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<dropbox_link::DropboxPull> {
    let dir = app_config_dir(&app)?;
    let token = dropbox_link::valid_access_token(
        &dir,
        &sync_dropbox_oauth::HttpOauthTransport::new(),
        now_unix(),
    )?;
    let provider =
        sync_dropbox::DropboxApiSyncProvider::new(sync_dropbox::HttpDropboxTransport::new(token));
    let local_root = dir.join("vault");
    let report = sync_bootstrap::pull_vault(&provider, &local_root, |done, total| {
        // Hundreds of files over the network: without this the screen
        // sits still long enough to read as a hang.
        let _ = app.emit("dropbox-pull-progress", (done, total));
    })?;
    dropbox_link::save_vault_root(&dir, &report.vault_root)?;
    // The pulled copy is a vault like any other: opening it runs the
    // migrations and rebuilds app.db from the JSONL snapshot through the
    // same disposable-cache path the desktop uses, then the engine and
    // every existing command work against it unchanged. Remembering it as
    // the selected vault is what makes the app come back to it on the
    // next launch instead of the link screen.
    open_vault(&app, &state, &local_root)?;
    vault::write_vault_path(&dir, &local_root)?;
    // Opening the vault writes app.db and re-exports the snapshot, so
    // without this every file would look locally changed and the first
    // push would send the whole vault back unaltered.
    sync_push::adopt_local_baseline(
        &local_root,
        &sync_bootstrap::VaultRoot(report.vault_root.clone()),
    )?;
    Ok(dropbox_link::DropboxPull {
        vault_root: report.vault_root,
        files: report.files,
        bytes: report.bytes,
        skipped: report.skipped,
        failed: report.failed,
    })
}

/// Sends this device's vault changes back to Dropbox.
///
/// Exports the database to its JSONL snapshot first: the files on disk
/// are what gets uploaded, so anything still only in app.db would be left
/// behind. Every write is guarded by the revision this device last saw,
/// so a file the other end has moved on is reported as a conflict rather
/// than overwritten.
#[tauri::command]
async fn dropbox_push_vault(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<dropbox_link::DropboxPush> {
    let dir = app_config_dir(&app)?;
    let local_root = {
        let guard = state.vault.lock().unwrap();
        let vault = guard
            .as_ref()
            .ok_or_else(|| Error::State("no vault selected".into()))?;
        state_export::export(&vault.conn, &vault::state_dir(&vault.root))?;
        vault.root.clone()
    };
    let token = dropbox_link::valid_access_token(
        &dir,
        &sync_dropbox_oauth::HttpOauthTransport::new(),
        now_unix(),
    )?;
    let provider =
        sync_dropbox::DropboxApiSyncProvider::new(sync_dropbox::HttpDropboxTransport::new(token));
    let root = dropbox_link::load_vault_root(&dir)?;
    let report = sync_push::push_vault(&provider, &local_root, &root, |done, total| {
        let _ = app.emit("dropbox-push-progress", (done, total));
    })?;
    Ok(dropbox_link::DropboxPush {
        uploaded: report.uploaded,
        bytes: report.bytes,
        conflicts: report.conflicts,
        failed: report.failed,
    })
}

/// Drops a marker file into the linked app folder and returns its name.
///
/// Answers "which folder is this app actually talking to?" from the other
/// side: the answer cannot be derived from the app's name (Dropbox names
/// the folder after whatever was typed into its console, under a
/// localized parent), so the app writes something findable instead of
/// anyone guessing a path. Also the first exercise of the write path.
#[tauri::command]
async fn dropbox_write_marker(app: AppHandle) -> Result<String> {
    let dir = app_config_dir(&app)?;
    let token = dropbox_link::valid_access_token(
        &dir,
        &sync_dropbox_oauth::HttpOauthTransport::new(),
        now_unix(),
    )?;
    let provider =
        sync_dropbox::DropboxApiSyncProvider::new(sync_dropbox::HttpDropboxTransport::new(token));
    let body = format!(
        "This is the Dropbox app folder Hypomnema is linked to.\n\n\
         Put the vault's contents directly in this folder - not in a\n\
         subfolder, and not in a folder of the same name created by hand\n\
         elsewhere in Dropbox, which this app cannot see.\n\n\
         Written by Hypomnema at {} UTC.\n",
        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S")
    );
    provider.upsert(dropbox_link::MARKER_FILE, body.as_bytes())?;
    Ok(dropbox_link::MARKER_FILE.to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        // opener works on Android too, unlike open_external's xdg-open
        // fallback - the Dropbox consent page has to reach a real browser.
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());
    // updater (GitHub-releases) and the global capture shortcut are
    // desktop-only concepts (REQUIREMENTS.md §6) - mobile has no
    // equivalent plugin to register in their place.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());
    builder
        .setup(|app| {
            if let Ok(dir) = app.path().app_config_dir() {
                let _ = std::fs::create_dir_all(&dir);
                install_panic_logger(dir.join("hypomnema.log"));
            }
            // the quick-capture window is pre-created hidden: a WebView
            // spun up on demand takes long enough to defeat "quick".
            // Desktop-only - mobile's quick-add is in-app (§6), not a
            // second always-on-top borderless window.
            #[cfg(desktop)]
            if let Err(e) = tauri::WebviewWindowBuilder::new(
                app,
                "capture",
                tauri::WebviewUrl::App("index.html#/capture".into()),
            )
            .title("Quick capture")
            .inner_size(560.0, 132.0)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .center()
            .visible(false)
            .build()
            {
                eprintln!("quick-capture window failed to open: {e}");
            }
            // the vault (and its config) opens later, via vault_status
            // from the frontend; until then the defaults keep the
            // shortcut and tray alive so capture works pre-vault too
            // (no-op on mobile, see the stubs above)
            let defaults = AppConfig::default();
            if let Some(msg) = sync_global_shortcut(app.handle(), &defaults) {
                eprintln!("{msg}");
            }
            sync_tray(app.handle(), &defaults);
            Ok(())
        })
        .on_window_event(|window, event| {
            // the capture window is never destroyed, only hidden - a
            // destroyed WebView would have to be rebuilt on the next
            // capture, and losing focus means the user moved on
            if window.label() == "capture" {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    tauri::WindowEvent::Focused(false) => {
                        let _ = window.hide();
                    }
                    _ => {}
                }
            }
            // closing the main window hides it to the tray so the
            // capture shortcut and due-task notifications stay alive
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let state = window.state::<AppState>();
                    let hide = {
                        let guard = state.vault.lock().unwrap();
                        guard
                            .as_ref()
                            .map(|v| v.config.tray_icon && v.config.close_to_tray)
                            .unwrap_or_else(|| {
                                let d = AppConfig::default();
                                d.tray_icon && d.close_to_tray
                            })
                    };
                    if hide {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            vault_status,
            vault_select,
            config_get,
            config_set,
            config_default,
            profiles_list,
            profile_save,
            profile_apply,
            profile_delete,
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
            capture_task,
            inbox_list,
            task_update,
            task_delete,
            task_restore,
            tasks_delete_done,
            tasks_reorder,
            backups_list,
            backup_restore_db,
            backup_restore_config,
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
            kb_backlinks,
            tasks_search,
            daily_streaks,
            task_get,
            open_external,
            platform_is_mobile,
            dropbox_auth_url,
            dropbox_connect,
            dropbox_status,
            dropbox_disconnect,
            dropbox_list_files,
            dropbox_write_marker,
            dropbox_pull_vault,
            dropbox_push_vault
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
