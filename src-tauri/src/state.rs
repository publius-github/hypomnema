//! Shared app state and the small helpers every command module uses.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tauri::{AppHandle, Manager, State};

use crate::error::{Error, Result};
use crate::vault::Vault;

#[derive(Default)]
pub(crate) struct AppState {
    pub(crate) vault: Mutex<Option<Vault>>,
    pub(crate) watcher: Mutex<Option<notify::RecommendedWatcher>>,
    pub(crate) kb_watcher: Mutex<Option<(PathBuf, notify::RecommendedWatcher)>>,
    /// Serializes engine passes: the config watcher runs them on its own
    /// DB connection, and two concurrent passes would interleave their
    /// dedup/reconcile statements (and can hit SQLITE_BUSY under WAL).
    pub(crate) engine_lock: Arc<Mutex<()>>,
    /// Watcher over <vault>/tasks/ importing outside edits of the task
    /// mirror files.
    pub(crate) tasks_watcher: Mutex<Option<notify::RecommendedWatcher>>,
    /// Content of every mirror file as we last wrote it: the tasks
    /// watcher skips files that still match, so our own exports never
    /// trigger an import round-trip.
    pub(crate) mirror_written: Arc<Mutex<HashMap<PathBuf, String>>>,
    /// Kicks the export worker (`start_export_worker`): a mutating
    /// command sends one unit here instead of rewriting the mirror and
    /// the state snapshot itself, so the vault lock is held for the SQL
    /// alone and a burst of edits costs one export, not N.
    pub(crate) export_tx: Mutex<Option<mpsc::Sender<()>>>,
}

impl AppState {
    /// Asks the export worker for a mirror + state snapshot rewrite.
    /// Never blocks and never fails: a worker that is gone (only at
    /// shutdown) simply means no further exports.
    pub(crate) fn request_export(&self) {
        if let Some(tx) = self.export_tx.lock_or_recover().as_ref() {
            let _ = tx.send(());
        }
    }
}

/// Debounce applied by the export worker: long enough to fold a drag
/// reorder or a checklist sweep into one rewrite, short enough that a
/// phone reading `today.md` over a synced folder never notices.
pub(crate) const EXPORT_DEBOUNCE: Duration = Duration::from_millis(200);

pub(crate) fn app_config_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|e| Error::State(format!("cannot resolve app config dir: {e}")))
}

pub(crate) fn today_string() -> String {
    chrono::Local::now()
        .date_naive()
        .format("%Y-%m-%d")
        .to_string()
}

pub(crate) fn app_data_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| Error::State(format!("cannot resolve the app data directory: {e}")))
}

pub(crate) fn with_conn<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T>,
) -> Result<T> {
    let guard = state.vault.lock_or_recover();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    f(&vault.conn)
}

pub(crate) fn with_vault_root<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&Path) -> Result<T>,
) -> Result<T> {
    let guard = state.vault.lock_or_recover();
    let vault = guard
        .as_ref()
        .ok_or_else(|| Error::State("no vault selected".into()))?;
    f(&vault.root)
}

/// True on Android. The frontend shows the Dropbox link screen instead of
/// the desktop folder picker when this is set: a phone has no synced vault
/// folder to point a picker at (docs/android/SPIKES.md, Spike A).
#[tauri::command]
pub(crate) fn platform_is_mobile() -> bool {
    cfg!(mobile)
}

pub(crate) fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

/// `Mutex::lock` that survives a poisoned lock. A guard is poisoned when
/// its holder panicked; the data behind every mutex here (the vault
/// handle, watcher handles, the mirror-written map) is left in a usable
/// state by any panic that can reach it, so continuing is the right
/// answer - and with `panic = "abort"` in release the alternative is not
/// an error but a dead process.
pub(crate) trait LockOrRecover<T> {
    fn lock_or_recover(&self) -> MutexGuard<'_, T>;
}

impl<T> LockOrRecover<T> for Mutex<T> {
    fn lock_or_recover(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
