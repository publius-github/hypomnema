//! Commands: Google sign-in and sync, the device passphrase lock, the
//! conflict log.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{Error, Result};
use crate::state::*;
use crate::sync_provider::{SyncCursor, SyncProvider};
use crate::watchers::*;
use crate::{
    device, google_link, secret_store, state_export, sync_bootstrap, sync_conflicts, sync_cycle,
    sync_gdrive, sync_push, vault,
};
#[cfg(desktop)]
use crate::{google_auth, oauth};

/// Outcome of a full sync pass (`sync_cycle.rs`), for the screen that
/// asked for it.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS, PartialEq, Eq)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SyncSummary {
    #[ts(type = "number")]
    pub downloaded: usize,
    /// Files both ends had changed, reconciled by this pass.
    #[ts(type = "number")]
    pub merged: usize,
    #[ts(type = "number")]
    pub uploaded: usize,
    #[ts(type = "number")]
    pub removed_locally: usize,
    #[ts(type = "number")]
    pub removed_remotely: usize,
    /// Entries added to the conflict log by this pass.
    #[ts(type = "number")]
    pub conflicts: usize,
    /// Prose this device kept aside rather than merging line by line.
    /// Named, not just counted: the point of keeping a copy is that
    /// someone can go and read it.
    pub conflicted_copies: Vec<String>,
    pub failed: Vec<String>,
}

fn summary(report: sync_cycle::SyncReport) -> SyncSummary {
    SyncSummary {
        downloaded: report.downloaded,
        merged: report.merged,
        uploaded: report.uploaded,
        removed_locally: report.removed_locally,
        removed_remotely: report.removed_remotely,
        conflicts: report.conflicts,
        conflicted_copies: report.conflicted_copies,
        failed: report.failed,
    }
}

fn open_vault_root(state: &State<'_, AppState>) -> Option<std::path::PathBuf> {
    state
        .vault
        .lock_or_recover()
        .as_ref()
        .map(|vault| vault.root.clone())
}

/// Set while a Google pass runs: the scheduler, the Sync now button and
/// quitting all start passes, and a second one would only queue behind
/// the engine lock to repeat the first.
static SYNC_RUNNING: AtomicBool = AtomicBool::new(false);
/// Set by `google_sign_in_cancel` to stop waiting for the browser.
static SIGN_IN_CANCEL: AtomicBool = AtomicBool::new(false);

/// `sync-status` event: a pass started or ended, and how it ended.
#[derive(Clone, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SyncActivity {
    pub running: bool,
    pub error: Option<String>,
}

/// One pass against the signed-in account's Drive folder. The vault lives
/// at the folder's root, and the manifest in that account's own sync
/// space, so another account never reads its revisions.
pub(crate) fn google_pass(app: &AppHandle) -> Result<sync_cycle::SyncReport> {
    if SYNC_RUNNING.swap(true, Ordering::SeqCst) {
        return Err(Error::State("a sync pass is already running".into()));
    }
    let _ = app.emit(
        "sync-status",
        SyncActivity {
            running: true,
            error: None,
        },
    );
    let keep_alive = KeepAlive::start(app);
    let result = google_pass_inner(app);
    drop(keep_alive);
    SYNC_RUNNING.store(false, Ordering::SeqCst);
    let error = result.as_ref().err().map(|e| e.to_string());
    if let (Some(message), Some(root)) = (&error, open_vault_root(&app.state::<AppState>())) {
        // Failures before the pass proper (an expired sign-in, no
        // network for the token) belong in the standing too.
        sync_cycle::record_pass(
            &root,
            &chrono::Utc::now().to_rfc3339(),
            Some(message.clone()),
        );
    }
    let _ = app.emit(
        "sync-status",
        SyncActivity {
            running: false,
            error,
        },
    );
    result
}

/// Keeps the phone's process running for as long as it lives: Android
/// freezes an app the user put away, and with it a pass half done. On
/// the desktop nothing freezes, and this is empty.
struct KeepAlive<'a> {
    _app: &'a AppHandle,
}

impl<'a> KeepAlive<'a> {
    fn start(app: &'a AppHandle) -> Self {
        #[cfg(target_os = "android")]
        {
            use tauri_plugin_google_auth::GoogleAuthExt;
            let _ = app.google_auth().keep_alive(true);
        }
        Self { _app: app }
    }
}

impl Drop for KeepAlive<'_> {
    fn drop(&mut self) {
        #[cfg(target_os = "android")]
        {
            use tauri_plugin_google_auth::GoogleAuthExt;
            let _ = self._app.google_auth().keep_alive(false);
        }
    }
}

fn google_pass_inner(app: &AppHandle) -> Result<sync_cycle::SyncReport> {
    let dir = app_config_dir(app)?;
    let account = signed_in_account(&dir)?;
    let state = app.state::<AppState>();
    let local_root = open_vault_root(&state).ok_or(Error::NoVault)?;
    let token = drive_token(app, &dir, &account)?;
    sync_bootstrap::set_space(&local_root, Some(&google_link::space_name(&account)))?;
    let provider = sync_gdrive::GdriveApiSyncProvider::new(sync_gdrive::HttpGdriveTransport::new(
        token.clone(),
    ));
    let result = run_pass(
        app,
        &state,
        &provider,
        &sync_bootstrap::VaultRoot(String::new()),
    );
    forget_refused_token(app, &token, &result);
    result
}

fn signed_in_account(dir: &std::path::Path) -> Result<google_link::Account> {
    google_link::account(dir)
        .ok_or_else(|| Error::State("this device is not signed in to Google".into()))
}

/// An access token for the signed-in account's Drive folder. The desktop
/// refreshes its own (`google_link.rs`); on Android Play services holds
/// the grant and hands one over without UI, or says the user has to
/// sign in again.
#[cfg(desktop)]
fn drive_token(
    _app: &AppHandle,
    dir: &std::path::Path,
    _account: &google_link::Account,
) -> Result<String> {
    google_link::valid_access_token(dir, &google_auth::GoogleOauthTransport::new(), now_unix())
}

#[cfg(target_os = "android")]
fn drive_token(
    app: &AppHandle,
    _dir: &std::path::Path,
    account: &google_link::Account,
) -> Result<String> {
    use tauri_plugin_google_auth::GoogleAuthExt;
    app.google_auth()
        .authorize(false, Some(&account.email))
        .map_err(plugin_error)
}

#[cfg(target_os = "android")]
fn plugin_error(e: tauri_plugin_google_auth::Error) -> Error {
    if e.code.as_deref() == Some(tauri_plugin_google_auth::CONSENT_REQUIRED) {
        Error::SignInExpired(e.message)
    } else {
        Error::State(e.message)
    }
}

/// Play services hands back a cached token until told otherwise, so one
/// Drive refused (revoked from the account page) would come back on
/// every pass. Dropping it makes the next pass ask Google afresh.
fn forget_refused_token<T>(_app: &AppHandle, _token: &str, _result: &Result<T>) {
    #[cfg(target_os = "android")]
    if matches!(_result, Err(Error::SignInExpired(_))) {
        use tauri_plugin_google_auth::GoogleAuthExt;
        let _ = _app.google_auth().clear_token(_token);
    }
}

/// The everyday Sync now: one pass against the signed-in account.
#[tauri::command]
pub(crate) async fn sync_now(app: AppHandle) -> Result<SyncSummary> {
    let handle = app.clone();
    let report = tauri::async_runtime::spawn_blocking(move || google_pass(&handle))
        .await
        .map_err(|e| Error::State(format!("sync pass failed to run: {e}")))??;
    Ok(summary(report))
}

/// Whether this build can sign in at all: the desktop needs its client
/// secret compiled in, Android goes through Play services.
#[cfg(desktop)]
fn google_available() -> bool {
    google_auth::client_secret().is_some()
}

#[cfg(target_os = "android")]
fn google_available() -> bool {
    true
}

#[tauri::command]
pub(crate) async fn google_status(app: AppHandle) -> Result<google_link::GoogleStatus> {
    Ok(google_link::status(
        &app_config_dir(&app)?,
        google_available(),
    ))
}

/// Desktop: opens Google's consent page in the browser and waits (up to
/// `google_auth::SIGN_IN_TIMEOUT`) for it to come back to the loopback
/// port. Android: Play services' own account picker and consent screen.
#[tauri::command]
pub(crate) async fn google_sign_in(app: AppHandle) -> Result<google_link::GoogleStatus> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || sign_in_blocking(&handle))
        .await
        .map_err(|e| Error::State(format!("sign-in failed to run: {e}")))?
}

#[cfg(desktop)]
fn sign_in_blocking(app: &AppHandle) -> Result<google_link::GoogleStatus> {
    use tauri_plugin_opener::OpenerExt;

    SIGN_IN_CANCEL.store(false, Ordering::SeqCst);
    let pkce = oauth::new_pkce_challenge()?;
    let expected_state = google_auth::new_state()?;
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    let redirect = format!("http://127.0.0.1:{}", listener.local_addr()?.port());
    let url = google_auth::authorize_url(&pkce.challenge, &expected_state, &redirect);
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| Error::State(format!("cannot open the browser: {e}")))?;
    let code = google_auth::wait_for_redirect(
        &listener,
        &expected_state,
        google_auth::SIGN_IN_TIMEOUT,
        &SIGN_IN_CANCEL,
    )?;
    crate::desktop::show_main(app);
    let tokens = google_auth::exchange_code(
        &google_auth::GoogleOauthTransport::new(),
        &code,
        &pkce.verifier,
        &redirect,
    )?;
    let user = sync_gdrive::fetch_user(&sync_gdrive::HttpGdriveTransport::new(
        tokens.access_token.clone(),
    ))?;
    let dir = app_config_dir(app)?;
    let account = google_link::store(&dir, &tokens, &user, now_unix())?;
    if let Some(root) = open_vault_root(&app.state::<AppState>()) {
        sync_bootstrap::set_space(&root, Some(&google_link::space_name(&account)))?;
    }
    Ok(google_link::status(&dir, google_available()))
}

#[cfg(target_os = "android")]
fn sign_in_blocking(app: &AppHandle) -> Result<google_link::GoogleStatus> {
    use tauri_plugin_google_auth::GoogleAuthExt;

    let token = app
        .google_auth()
        .authorize(true, None)
        .map_err(plugin_error)?;
    let user = sync_gdrive::fetch_user(&sync_gdrive::HttpGdriveTransport::new(token))?;
    let dir = app_config_dir(app)?;
    let account = google_link::store_account(&dir, &user)?;
    if let Some(root) = open_vault_root(&app.state::<AppState>()) {
        sync_bootstrap::set_space(&root, Some(&google_link::space_name(&account)))?;
    }
    Ok(google_link::status(&dir, google_available()))
}

/// Stops waiting for the browser.
#[tauri::command]
pub(crate) async fn google_sign_in_cancel() -> Result<()> {
    SIGN_IN_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

/// Signs out: revokes the grant at Google (best effort - offline, the
/// local sign-in is still forgotten) and drops the tokens. The vault and
/// its sync space stay, so signing back in to the same account resumes
/// where it left off.
#[tauri::command]
pub(crate) async fn google_sign_out(app: AppHandle) -> Result<google_link::GoogleStatus> {
    let dir = app_config_dir(&app)?;
    #[cfg(desktop)]
    if let Some(token) = google_link::refresh_token(&dir) {
        let _ = google_auth::revoke(&google_auth::GoogleOauthTransport::new(), &token);
    }
    #[cfg(target_os = "android")]
    if let Some(account) = google_link::account(&dir) {
        use tauri_plugin_google_auth::GoogleAuthExt;
        let handle = app.clone();
        // blocks on Play services; off the async worker
        let _ = tauri::async_runtime::spawn_blocking(move || {
            handle.google_auth().revoke(&account.email)
        })
        .await;
    }
    google_link::clear(&dir)?;
    Ok(google_link::status(&dir, google_available()))
}

/// What a first pull from Google Drive brought down.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct GooglePull {
    pub files: usize,
    pub failed: Vec<String>,
}

/// First run on a device that signs in before it has a vault: brings the
/// vault down from the account's Drive folder into this device's local
/// vault directory and opens it there. `None` when Drive holds no vault
/// yet - the caller starts a local vault instead, and its first pass
/// uploads it.
///
/// A pull rather than a pass because a fresh vault is not empty: it has
/// default config files, and joining those against the real ones would
/// keep both as conflicted copies of every file.
#[tauri::command]
pub(crate) async fn google_pull_vault(app: AppHandle) -> Result<Option<GooglePull>> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || google_pull_blocking(&handle))
        .await
        .map_err(|e| Error::State(format!("pull failed to run: {e}")))?
}

fn google_pull_blocking(app: &AppHandle) -> Result<Option<GooglePull>> {
    let dir = app_config_dir(app)?;
    let account = signed_in_account(&dir)?;
    let state = app.state::<AppState>();
    // the files being written are what the export worker writes too
    let engine_lock = state.engine_lock.clone();
    let _pass = engine_lock.lock_or_recover();
    // a whole vault coming down takes a while; it must survive the user
    // switching apps meanwhile
    let _keep_alive = KeepAlive::start(app);
    let token = drive_token(app, &dir, &account)?;
    let provider = sync_gdrive::GdriveApiSyncProvider::new(sync_gdrive::HttpGdriveTransport::new(
        token.clone(),
    ));
    let listing = provider.list_changes(&SyncCursor::default());
    forget_refused_token(app, &token, &listing);
    let paths: Vec<String> = listing?
        .0
        .into_iter()
        .filter(|change| !change.deleted)
        .map(|change| change.path)
        .collect();
    if sync_bootstrap::detect_vault_root(&paths).is_err() {
        return Ok(None);
    }
    let local_root = crate::cmd_vault::local_vault_dir(app)?;
    std::fs::create_dir_all(&local_root)?;
    sync_bootstrap::set_space(&local_root, Some(&google_link::space_name(&account)))?;
    let report = sync_bootstrap::pull_vault(&provider, &local_root, |done, total| {
        let _ = app.emit("sync-progress", (done, total));
    })?;
    // an app.db left from an earlier vault here would be re-exported over
    // the files just pulled
    if report.state_files > 0 && vault::db_path(&local_root).exists() {
        remove_db_files(&local_root);
    }
    open_vault(app, &state, &local_root)?;
    vault::write_vault_path(&dir, &local_root)?;
    // opening re-exports the snapshot; without this every file would
    // look changed here and the first pass would send it all back
    sync_push::adopt_local_baseline(&local_root, &sync_bootstrap::VaultRoot(String::new()))?;
    Ok(Some(GooglePull {
        files: report.files + report.skipped,
        failed: report.failed,
    }))
}

/// One sync pass over whichever remote `provider` talks to - the part of
/// a sync command that does not care which backend moves the bytes.
fn run_pass<P: SyncProvider>(
    app: &AppHandle,
    state: &State<'_, AppState>,
    provider: &P,
    root: &sync_bootstrap::VaultRoot,
) -> Result<sync_cycle::SyncReport> {
    let dir = app_config_dir(app)?;
    // Held for the whole pass. The merge rewrites the JSONL snapshot the
    // export worker and the watchers also write, and `rebuild_cache`
    // drops app.db underneath them; commands keep working meanwhile
    // (they take only the vault lock), their exports queue up behind.
    let engine_lock = state.engine_lock.clone();
    let _pass = engine_lock.lock_or_recover();
    let (local_root, guard_percent) = {
        let guard = state.vault.lock_or_recover();
        let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
        // The snapshot is what travels, so anything still only in app.db
        // would be left behind by a pass that started without this.
        state_export::export(&vault.conn, &vault::state_dir(&vault.root))?;
        (
            vault.root.clone(),
            vault.config.sync_mass_delete_guard_percent,
        )
    };
    let device = device::ensure(&dir)?;
    let now = chrono::Utc::now().to_rfc3339();
    let report = match sync_cycle::sync_vault(
        provider,
        &local_root,
        root,
        sync_cycle::DeviceTag {
            id: &device,
            label: if cfg!(mobile) { "phone" } else { "desktop" },
        },
        &now,
        guard_percent,
        |done, total| {
            let _ = app.emit("sync-progress", (done, total));
        },
    ) {
        Ok(report) => {
            sync_cycle::record_pass(&local_root, &now, None);
            report
        }
        Err(e) => {
            // A pass that could not run is worth remembering too: the
            // difference between "in step" and "has not managed to sync
            // since Tuesday" is the whole point of showing a standing.
            sync_cycle::record_pass(&local_root, &now, Some(e.to_string()));
            return Err(e);
        }
    };
    if report.state_changed {
        // The merge rewrote the JSONL snapshot underneath a database that
        // was built from the old one. Dropping app.db and reopening runs
        // the existing restore path over the merged files - the same
        // disposable-cache route `state_export.rs` documents, rather than
        // a second way to write rows into SQLite.
        rebuild_cache(app, state, &local_root)?;
        // The merge can bring in another device's copy of an instance
        // this one generated under an older build's counted-up id, and
        // rules this device has not run yet: one engine pass folds the
        // twins (engine.rs `dedupe_instances`) now, not on the next
        // launch, and its export goes up with the next pass.
        {
            let guard = state.vault.lock_or_recover();
            if let Some(vault) = guard.as_ref() {
                crate::engine::run(
                    &vault.conn,
                    &vault.config_dir(),
                    &vault.config,
                    chrono::Local::now(),
                )?;
            }
        }
        state.request_export();
    }
    // a pass knows nothing about config errors (a downloaded YAML file
    // reaches the config watcher, which reports them): null leaves the
    // banner as it is
    let _ = app.emit("vault-updated", ());
    Ok(report)
}

/// Forgets what this device last agreed on with the remote, so the next
/// pass joins from scratch: identical files adopted, files only here
/// uploaded, files only there downloaded. The answer to the mass-deletion
/// guard when the remote really was wiped - nothing local is deleted.
#[tauri::command]
pub(crate) async fn sync_reset_space(state: State<'_, AppState>) -> Result<()> {
    let engine_lock = state.engine_lock.clone();
    let _pass = engine_lock.lock_or_recover();
    let local_root = {
        let guard = state.vault.lock_or_recover();
        guard.as_ref().ok_or_else(|| Error::NoVault)?.root.clone()
    };
    sync_bootstrap::reset_space(&local_root)
}

/// Everything the passphrase seals: the desktop's Google tokens (the
/// phone keeps none - Play services holds its grant).
fn secret_files() -> Vec<&'static str> {
    google_link::SECRET_FILES.to_vec()
}

/// Is a passphrase set on this device, and are its secrets readable?
#[tauri::command]
pub(crate) async fn app_lock_state(app: AppHandle) -> Result<secret_store::LockState> {
    Ok(secret_store::state(&app_config_dir(&app)?))
}

/// Turn the lock on. Seals every secret already on disk under the new
/// passphrase, so nothing is left behind in plaintext.
#[tauri::command]
pub(crate) async fn app_lock_enable(
    app: AppHandle,
    passphrase: String,
) -> Result<secret_store::LockState> {
    let dir = app_config_dir(&app)?;
    secret_store::enable(&dir, &passphrase, &secret_files())?;
    Ok(secret_store::state(&dir))
}

#[tauri::command]
pub(crate) async fn app_lock_disable(
    app: AppHandle,
    passphrase: String,
) -> Result<secret_store::LockState> {
    let dir = app_config_dir(&app)?;
    secret_store::disable(&dir, &passphrase, &secret_files())?;
    Ok(secret_store::state(&dir))
}

#[tauri::command]
pub(crate) async fn app_unlock(
    app: AppHandle,
    passphrase: String,
) -> Result<secret_store::LockState> {
    let dir = app_config_dir(&app)?;
    secret_store::unlock(&dir, &passphrase)?;
    Ok(secret_store::state(&dir))
}

/// Forget the passphrase for this session. Cheap, and the only thing
/// between a handed-over phone and a standing grant to the vault.
#[tauri::command]
pub(crate) async fn app_lock_now(app: AppHandle) -> Result<secret_store::LockState> {
    secret_store::lock();
    Ok(secret_store::state(&app_config_dir(&app)?))
}

/// Whether this device is in step, answered without touching the
/// network - so a phone with no signal can still say what it is holding.
#[tauri::command]
pub(crate) async fn sync_standing(state: State<'_, AppState>) -> Result<sync_cycle::SyncStanding> {
    let local_root = {
        let guard = state.vault.lock_or_recover();
        match guard.as_ref() {
            Some(vault) => vault.root.clone(),
            None => return Ok(sync_cycle::SyncStanding::default()),
        }
    };
    sync_cycle::standing(&local_root, &sync_bootstrap::VaultRoot(String::new()))
}

/// What this device had to choose between during past syncs.
#[tauri::command]
pub(crate) async fn sync_conflicts_list(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<sync_conflicts::ConflictEntry>> {
    let device = device::ensure(&app_config_dir(&app)?)?;
    let guard = state.vault.lock_or_recover();
    let Some(vault) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(sync_conflicts::for_display(&vault.root, &device))
}

/// A file set against its conflicted copy, for the review dialog.
#[tauri::command]
pub(crate) async fn sync_conflict_diff(
    state: State<'_, AppState>,
    path: String,
    copy: String,
) -> Result<sync_conflicts::ConflictDiff> {
    crate::state::with_vault_root(&state, |root| sync_conflicts::diff(root, &path, &copy))
}

/// Settles a conflicted copy: keep the copy's text or the file's, and
/// move the copy to the trash.
#[tauri::command]
pub(crate) async fn sync_conflict_resolve(
    state: State<'_, AppState>,
    path: String,
    copy: String,
    keep_copy: bool,
) -> Result<()> {
    crate::state::with_vault_root(&state, |root| {
        sync_conflicts::resolve(root, &path, &copy, keep_copy)
    })?;
    crate::sync_scheduler::poke();
    Ok(())
}

#[tauri::command]
pub(crate) async fn sync_conflicts_clear(state: State<'_, AppState>) -> Result<()> {
    let guard = state.vault.lock_or_recover();
    let Some(vault) = guard.as_ref() else {
        return Ok(());
    };
    sync_conflicts::clear(&vault.root)
}
