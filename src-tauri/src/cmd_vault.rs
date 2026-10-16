//! Commands: vault selection, app settings, backups, the About
//! dialog's third-party notices, and the diagnostic log.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, State};

use crate::config::AppConfig;
use crate::desktop::*;
use crate::error::{Error, Result};
use crate::state::*;
use crate::watchers::*;
use crate::{android_storage, applog, backup, config_files, example, vault, vault_places};

#[tauri::command]
pub(crate) async fn vault_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>> {
    let Some(path) = vault::read_vault_path(&app_config_dir(&app)?) else {
        return Ok(None);
    };
    open_vault(&app, &state, &path)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Where a phone keeps its vault when it is not syncing with anything.
///
/// A phone has no folder picker worth the name and no obvious place a
/// user would point one at, so this is a fixed location the app owns.
/// It is a normal directory read and written with normal file I/O -
/// Google sync exists to *sync* a vault, not to be the way to *have* one.
/// Where a vault goes when nobody chooses one.
///
/// On Android this prefers the app's own folder on shared storage over
/// its private one: both need no permission, but only that one can be
/// reached from a computer over USB, and "how do I get my existing vault
/// onto the phone?" is the first question a phone install raises.
pub(crate) fn local_vault_dir(app: &AppHandle) -> Result<PathBuf> {
    let base = app_data_dir(app)?;
    Ok(vault_places::default_vault_dir(
        &base,
        &app.config().identifier,
    ))
}

/// Opens (creating if needed) this device's own vault, with no sync
/// involved. `Vault::open` lays out an empty vault the same way it does
/// on a first desktop run, so this works on a phone that has never
/// signed in to anything.
#[tauri::command]
pub(crate) async fn vault_use_local(app: AppHandle, state: State<'_, AppState>) -> Result<String> {
    let root = local_vault_dir(&app)?;
    std::fs::create_dir_all(&root)?;
    open_vault(&app, &state, &root)?;
    vault::write_vault_path(&app_config_dir(&app)?, &root)?;
    Ok(root.to_string_lossy().into_owned())
}

/// The vault directory this device would use locally, whether or not it
/// exists yet. Shown in Settings so files can be copied into it from a
/// computer without guessing where it lives.
#[tauri::command]
pub(crate) async fn vault_local_path(app: AppHandle) -> Result<String> {
    Ok(local_vault_dir(&app)?.to_string_lossy().into_owned())
}

/// Lists one directory for the in-app folder browser.
///
/// Android's answer to "let me pick a folder": there is no directory
/// picker to call - Tauri's dialog plugin picks files, and the Storage
/// Access Framework hands back a content:// tree the Rust core cannot
/// open as a path. So the app browses the filesystem itself, and this is
/// the listing behind it. `path` omitted starts where a vault would go
/// by default.
#[tauri::command]
pub(crate) async fn vault_browse(
    app: AppHandle,
    path: Option<String>,
) -> Result<vault_places::DirListing> {
    let base = app_data_dir(&app)?;
    let identifier = &app.config().identifier;
    let start = match path {
        Some(path) => PathBuf::from(path),
        None => {
            let default = vault_places::default_vault_dir(&base, identifier);
            // Start in the folder the default vault would live *in*,
            // not in the vault itself: the browser is for choosing a
            // sibling, and opening inside the answer is not browsing.
            default.parent().map(Path::to_path_buf).unwrap_or(default)
        }
    };
    vault_places::browse(&start, &base, identifier)
}

/// Whether this app may reach ordinary folders on shared storage.
///
/// Not a cosmetic detail: without it the folder browser can only show
/// the two directories the app owns outright, and a folder the user
/// picks anywhere else fails on the first write.
#[tauri::command]
pub(crate) async fn storage_access(app: AppHandle) -> Result<bool> {
    Ok(android_storage::all_files_access(&app))
}

/// Opens the system screen that grants it.
///
/// `MANAGE_EXTERNAL_STORAGE` has no runtime dialog - Android only offers
/// a settings page - so this is as close to "the app asks" as the
/// platform allows, and closer than telling someone to go and find it.
#[tauri::command]
pub(crate) async fn storage_access_request(app: AppHandle) -> Result<()> {
    android_storage::request_all_files_access(&app)
}

/// Makes a subfolder from the browser, so choosing a new home for the
/// vault does not mean leaving the app for a file manager.
#[tauri::command]
pub(crate) async fn vault_browse_mkdir(parent: String, name: String) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.starts_with('.') {
        return Err(Error::State(
            "a folder name cannot be empty, start with a dot, or contain slashes".into(),
        ));
    }
    let path = PathBuf::from(parent).join(name);
    std::fs::create_dir_all(&path)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Opens a vault at an arbitrary path, creating it if the directory is
/// empty. The failure this exists to report clearly is a path the app
/// cannot write to, which on Android is most of the filesystem and looks
/// no different from one it can.
#[tauri::command]
pub(crate) async fn vault_use_path(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<String> {
    let root = PathBuf::from(path.trim());
    if root.as_os_str().is_empty() {
        return Err(Error::State("no folder given".into()));
    }
    if !vault_places::probe_writable(&root) {
        return Err(Error::State(format!(
            "{} cannot be written to by this app. On Android only the app's              own folders are writable without a permission this build does              not request - pick one of the offered places instead.",
            root.display()
        )));
    }
    open_vault(&app, &state, &root)?;
    vault::write_vault_path(&app_config_dir(&app)?, &root)?;
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) async fn vault_select(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<AppConfig> {
    let root = PathBuf::from(&path);
    let config = open_vault(&app, &state, &root)?;
    vault::write_vault_path(&app_config_dir(&app)?, &root)?;
    Ok(config)
}

/// Opens a new vault filled with the example content (`example.rs`) in
/// `path`, which must be empty or not exist yet - the welcome screen's
/// "Try it with an example" for someone who wants to look around first.
#[tauri::command]
pub(crate) async fn vault_create_example(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<AppConfig> {
    let root = PathBuf::from(&path);
    example::ensure_empty(&root)?;
    let config = open_vault(&app, &state, &root)?;
    {
        let guard = state.vault.lock_or_recover();
        let vault = guard.as_ref().ok_or(Error::NoVault)?;
        example::seed(&vault.root, &vault.conn, chrono::Local::now().date_naive())?;
    }
    state.request_export();
    vault::write_vault_path(&app_config_dir(&app)?, &root)?;
    Ok(config)
}

#[tauri::command]
pub(crate) async fn config_get(state: State<'_, AppState>) -> Result<AppConfig> {
    let guard = state.vault.lock_or_recover();
    guard
        .as_ref()
        .map(|vault| vault.config.clone())
        .ok_or_else(|| Error::NoVault)
}

#[tauri::command]
pub(crate) async fn config_set(
    app: AppHandle,
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<()> {
    let (root, mirror_was, mirror_now, saved) = {
        let mut guard = state.vault.lock_or_recover();
        let vault = guard.as_mut().ok_or_else(|| Error::NoVault)?;
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
    applog::set_max_kb(saved.log_max_kb);
    // the task mirror toggle takes effect immediately
    if mirror_now && !mirror_was {
        state.request_export();
        let _ = start_tasks_watcher(app, &vault::tasks_dir(&root));
    } else if !mirror_now && mirror_was {
        // dropping the watcher closes its channel and ends the thread;
        // the files stay on disk but are no longer read or written
        *state.tasks_watcher.lock_or_recover() = None;
    }
    Ok(())
}

/// Factory defaults - the frontend's only source of "is this field at
/// its default?" for progressive disclosure and the Profiles tab.
#[tauri::command]
pub(crate) async fn config_default() -> Result<AppConfig> {
    Ok(AppConfig::default())
}

#[tauri::command]
pub(crate) async fn backups_list(state: State<'_, AppState>) -> Result<backup::BackupsOverview> {
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    backup::overview(&vault.root)
}

/// Restores app.db from a daily snapshot. The live connection is closed
/// first (Windows cannot overwrite an open file, and swapping the file
/// under an open SQLite handle is unsafe everywhere), the current
/// database is copied aside as its own safety net, then the vault is
/// reopened exactly as `vault_select` does.
#[tauri::command]
pub(crate) async fn backup_restore_db(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<AppConfig> {
    let root = {
        let guard = state.vault.lock_or_recover();
        let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
        vault.root.clone()
    };
    // no engine pass, mirror import or export may open the database
    // while its file is being swapped
    let engine_lock = state.engine_lock.clone();
    let _pass = engine_lock.lock_or_recover();
    // drop the connection before touching the file on disk
    *state.vault.lock_or_recover() = None;
    let restored = backup::restore_db_backup(&root, &id, chrono::Local::now());
    // whatever happened to the file, the app must not be left without a
    // vault: every command would answer "no vault selected" until the
    // user picked the folder again
    let reopened = open_vault(&app, &state, &root);
    restored.and(reopened)
}

/// Restores one config or settings file from its backup in place; the
/// existing config-file watcher picks up the change and reloads it,
/// same as any other external edit.
#[tauri::command]
pub(crate) async fn backup_restore_config(state: State<'_, AppState>, id: String) -> Result<()> {
    let (root, keep) = {
        let guard = state.vault.lock_or_recover();
        let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
        (vault.root.clone(), vault.config.backup_keep)
    };
    backup::restore_config_backup(&root, &id, keep, chrono::Local::now())
}

/// The third-party license notices (`THIRD_PARTY_LICENSES.txt`, generated
/// by `scripts/general/third-party-licenses.mjs`), compiled in so every
/// platform carries them with the binary as those licenses require.
#[tauri::command]
pub(crate) async fn third_party_licenses() -> Result<&'static str> {
    Ok(include_str!("../../THIRD_PARTY_LICENSES.txt"))
}

/// How much of the log "Copy diagnostics" hands over: enough for the
/// lead-up to a failure, short enough to read before sharing.
const DIAGNOSTICS_LOG_BYTES: u64 = 16 * 1024;

/// A frontend failure for the diagnostic log: a rejected command, a
/// render crash caught by the error boundary, an unhandled rejection.
#[tauri::command]
pub(crate) async fn log_write(level: String, message: String) -> Result<()> {
    applog::write(applog::Level::parse(&level), &message);
    Ok(())
}

/// Version, platform and the log's tail, as plain text the user reads
/// and then pastes into a bug report themselves - nothing leaves the
/// device on its own.
#[tauri::command]
pub(crate) async fn diagnostics(app: AppHandle) -> Result<String> {
    let log = applog::tail(DIAGNOSTICS_LOG_BYTES);
    Ok(format!(
        "Hypomnema {}\nOS: {} {}\n\nRecent log:\n{}",
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH,
        if log.is_empty() { "(empty)\n" } else { &log },
    ))
}

/// Shows the log file in the system file manager (desktop only; the
/// phone has none to show it in).
#[tauri::command]
pub(crate) async fn log_reveal() -> Result<()> {
    let path = applog::path().ok_or_else(|| Error::State("the log is not set up".into()))?;
    if !path.exists() {
        // nothing logged yet: create it so there is something to point at
        applog::info("log opened from the app");
    }
    tauri_plugin_opener::reveal_item_in_dir(path)
        .map_err(|e| Error::State(format!("could not show the log: {e}")))
}
