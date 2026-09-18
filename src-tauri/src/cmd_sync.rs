//! Commands: Dropbox link and sync, the device passphrase lock, the conflict log.

use tauri::{AppHandle, Emitter, State};

use crate::error::{Error, Result};
use crate::state::*;
use crate::watchers::*;
use crate::{
    device, dropbox_link, secret_store, state_export, sync_bootstrap, sync_conflicts, sync_cycle,
    sync_dropbox, sync_dropbox_oauth, sync_push, vault,
};

/// Step 1 of linking: a fresh PKCE pair, its verifier saved to disk, and
/// the URL for the user to approve in a browser. On disk rather than in
/// memory because this flow leaves the app: Android may evict it while the
/// user is on the consent page (dropbox_link.rs).
#[tauri::command]
pub(crate) async fn dropbox_auth_url(app: AppHandle) -> Result<String> {
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
pub(crate) async fn dropbox_connect(
    app: AppHandle,
    code: String,
) -> Result<dropbox_link::DropboxStatus> {
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
pub(crate) async fn dropbox_status(app: AppHandle) -> Result<dropbox_link::DropboxStatus> {
    dropbox_link::status(&app_config_dir(&app)?, now_unix())
}

#[tauri::command]
pub(crate) async fn dropbox_disconnect(app: AppHandle) -> Result<()> {
    dropbox_link::clear(&app_config_dir(&app)?)
}

/// Smoke test for a fresh link: report what the App folder actually holds,
/// so a green result here means OAuth, token refresh, the HTTP client and
/// the App-folder scope all work end to end. Reports folder and tombstone
/// counts alongside the files, because "no files" alone doesn't say
/// whether the vault failed to sync or was never copied to this folder.
#[tauri::command]
pub(crate) async fn dropbox_list_files(app: AppHandle) -> Result<dropbox_link::DropboxListing> {
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
pub(crate) async fn dropbox_pull_vault(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<dropbox_link::DropboxPull> {
    let dir = app_config_dir(&app)?;
    // held for the whole pull: the state files being written are the
    // export worker's and the watchers' output too, and app.db is
    // dropped and rebuilt below
    let engine_lock = state.engine_lock.clone();
    let _pass = engine_lock.lock_or_recover();
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
    // A repeated pull onto a device that already built app.db from an
    // older snapshot: opening would skip the restore and re-export the
    // stale database over the files just pulled, then push them as
    // "changed here". Drop the cache so the open rebuilds from the pull.
    if report.state_files > 0 && vault::db_path(&local_root).exists() {
        let is_open_here = state
            .vault
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|v| v.root == local_root);
        if is_open_here {
            *state.vault.lock_or_recover() = None;
        }
        remove_db_files(&local_root);
    }
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
pub(crate) async fn dropbox_push_vault(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<dropbox_link::DropboxPush> {
    let dir = app_config_dir(&app)?;
    // the files on disk are what travels; no export may rewrite them
    // between the snapshot taken here and the upload
    let engine_lock = state.engine_lock.clone();
    let _pass = engine_lock.lock_or_recover();
    let local_root = {
        let guard = state.vault.lock_or_recover();
        let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
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

/// One full sync pass: bring down what the other device wrote, merge it
/// into what this one wrote, send the result back, and propagate
/// deletions both ways (`sync_cycle.rs`).
///
/// Replaces pull-then-push as the everyday action. Those two remain for
/// the cases they were built for - a first pull onto a device, and a
/// deliberate one-way upload - but neither can reconcile a file both ends
/// changed, which is the normal state of a vault used from two devices.
#[tauri::command]
pub(crate) async fn dropbox_sync(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<dropbox_link::DropboxSync> {
    let dir = app_config_dir(&app)?;
    // Held for the whole pass. The merge rewrites the JSONL snapshot the
    // export worker and the watchers also write, and `rebuild_cache`
    // drops app.db underneath them; commands keep working meanwhile
    // (they take only the vault lock), their exports queue up behind.
    let engine_lock = state.engine_lock.clone();
    let _pass = engine_lock.lock_or_recover();
    let local_root = {
        let guard = state.vault.lock_or_recover();
        let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
        // The snapshot is what travels, so anything still only in app.db
        // would be left behind by a pass that started without this.
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
    let device = device::ensure(&dir)?;
    let now = chrono::Utc::now().to_rfc3339();
    let report = match sync_cycle::sync_vault(
        &provider,
        &local_root,
        &root,
        &device,
        &now,
        |done, total| {
            let _ = app.emit("dropbox-sync-progress", (done, total));
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
        rebuild_cache(&app, &state, &local_root)?;
    }
    let _ = app.emit("vault-updated", Vec::<String>::new());
    Ok(dropbox_link::DropboxSync {
        downloaded: report.downloaded,
        merged: report.merged,
        uploaded: report.uploaded,
        removed_locally: report.removed_locally,
        removed_remotely: report.removed_remotely,
        conflicts: report.conflicts,
        conflicted_copies: report.conflicted_copies,
        failed: report.failed,
    })
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
    secret_store::enable(&dir, &passphrase, dropbox_link::SECRET_FILES)?;
    Ok(secret_store::state(&dir))
}

#[tauri::command]
pub(crate) async fn app_lock_disable(
    app: AppHandle,
    passphrase: String,
) -> Result<secret_store::LockState> {
    let dir = app_config_dir(&app)?;
    secret_store::disable(&dir, &passphrase, dropbox_link::SECRET_FILES)?;
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
pub(crate) async fn sync_standing(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<sync_cycle::SyncStanding> {
    let local_root = {
        let guard = state.vault.lock_or_recover();
        match guard.as_ref() {
            Some(vault) => vault.root.clone(),
            None => return Ok(sync_cycle::SyncStanding::default()),
        }
    };
    let root = dropbox_link::load_vault_root(&app_config_dir(&app)?)?;
    sync_cycle::standing(&local_root, &root)
}

/// What this device had to choose between during past syncs.
#[tauri::command]
pub(crate) async fn sync_conflicts_list(
    state: State<'_, AppState>,
) -> Result<Vec<sync_conflicts::ConflictEntry>> {
    let guard = state.vault.lock_or_recover();
    let Some(vault) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(sync_conflicts::load(&vault.root))
}

#[tauri::command]
pub(crate) async fn sync_conflicts_clear(state: State<'_, AppState>) -> Result<()> {
    let guard = state.vault.lock_or_recover();
    let Some(vault) = guard.as_ref() else {
        return Ok(());
    };
    sync_conflicts::clear(&vault.root)
}

/// Drops a marker file into the linked app folder and returns its name.
///
/// Answers "which folder is this app actually talking to?" from the other
/// side: the answer cannot be derived from the app's name (Dropbox names
/// the folder after whatever was typed into its console, under a
/// localized parent), so the app writes something findable instead of
/// anyone guessing a path. Also the first exercise of the write path.
#[tauri::command]
pub(crate) async fn dropbox_write_marker(app: AppHandle) -> Result<String> {
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
