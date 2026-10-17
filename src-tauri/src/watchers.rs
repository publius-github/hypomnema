//! Vault lifecycle: opening a vault, the three filesystem watchers and the export worker.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::config::AppConfig;
use crate::desktop::*;
use crate::error::{Error, Result};
use crate::state::*;
use crate::vault::Vault;
use crate::{applog, config_files, db, device, engine, journal, state_export, tasks_mirror, vault};

/// Rewrites the state snapshot and the task mirror files from `conn`,
/// as the config asks. Best effort by design: a failing export must not
/// fail whatever triggered it - the next successful export catches the
/// files up. `skip` names mirror files whose import just failed (left
/// untouched so the user can fix them in place); `preserve_pending`
/// leaves alone a file that differs from its merge base, i.e. an outside
/// edit the tasks watcher has not imported yet.
pub(crate) fn export_files(
    conn: &rusqlite::Connection,
    root: &Path,
    config: &AppConfig,
    skip: &std::collections::HashSet<PathBuf>,
    preserve_pending: bool,
    written: &Arc<Mutex<HashMap<PathBuf, String>>>,
) {
    // the state snapshot rides the same triggers as the mirror but is
    // independent of it, and always on: it is what sync ships and what
    // a db-less vault is rebuilt from
    if let Err(e) = state_export::export(conn, &vault::state_dir(root)) {
        applog::error(format!("state snapshot export failed: {e}"));
    }
    if !config.tasks_mirror {
        return;
    }
    if let Ok(files) = tasks_mirror::export(
        conn,
        &vault::tasks_dir(root),
        &vault::mirror_base_dir(root),
        &vault::config_dir(root),
        &today_string(),
        skip,
        &tasks_mirror::ExportOptions {
            preserve_pending,
            ..export_options(config)
        },
    ) {
        *written.lock_or_recover() = files.into_iter().collect();
    }
}

/// The export worker: one thread that turns `request_export` kicks into
/// mirror + snapshot rewrites on its own DB connection, under the engine
/// lock so it never interleaves with a pass or a mirror import, and
/// after a short debounce so a burst of edits is written once.
///
/// It reads the vault only through a brief lock to learn the root and
/// the config; the export itself runs against a second connection (WAL
/// and busy_timeout make that safe, as for the watchers), so a slow disk
/// stalls this thread and nothing else.
pub(crate) fn start_export_worker(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<()>();
    *app.state::<AppState>().export_tx.lock_or_recover() = Some(tx);
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            std::thread::sleep(EXPORT_DEBOUNCE);
            while rx.try_recv().is_ok() {}

            let state = app.state::<AppState>();
            let snapshot = {
                let guard = state.vault.lock_or_recover();
                guard
                    .as_ref()
                    .map(|vault| (vault.root.clone(), vault.config.clone()))
            };
            let Some((root, config)) = snapshot else {
                continue;
            };
            let engine_lock = state.engine_lock.clone();
            let _pass = engine_lock.lock_or_recover();
            // A vault being rebuilt from its snapshot has no app.db for a
            // moment (`rebuild_cache`, `backup_restore_db`, both under the
            // engine lock); opening one here would create an empty
            // database and export nothing over the files being restored.
            if !vault::db_path(&root).exists() {
                continue;
            }
            if let Ok(conn) = db::open(&vault::db_path(&root)) {
                export_files(
                    &conn,
                    &root,
                    &config,
                    &Default::default(),
                    true,
                    &state.mirror_written,
                );
                crate::sync_scheduler::poke();
            }
        }
    });
}

/// Shared filter for both filesystem watchers: access events carry no
/// content change, and `.<name>.tmp` files are our own write_atomic
/// staging - reacting to them would run an engine pass per save twice.
pub(crate) fn watch_event_is_relevant(event: &notify::Event) -> bool {
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

/// With the Notes rooted at the vault itself, a recursive watch also
/// sees every write under `.hypomnema/` - the database and its WAL, the
/// mirror files, the snapshot, the backups - none of which is a note.
/// Reacting to those made every task edit emit `kb-updated`.
pub(crate) fn is_work_dir_event(event: &notify::Event) -> bool {
    !event.paths.is_empty()
        && event
            .paths
            .iter()
            .all(|path| path.components().any(|c| c.as_os_str() == vault::WORK_DIR))
}

/// Watches the user configs and the app settings folder and, after a
/// debounce, reloads app.yml, runs the engine, and notifies the
/// frontend (req. 18, safe reload per 19).
pub(crate) fn start_config_watcher(app: AppHandle, root: &Path) -> Result<()> {
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
    *state.watcher.lock_or_recover() = Some(watcher);

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
                let mut guard = state.vault.lock_or_recover();
                guard.as_mut().map(|vault| {
                    // a broken file is already on the banner via
                    // config_error; anything else would vanish silently
                    if let Err(e) = vault.reload_config() {
                        applog::error(format!("settings reload failed: {e}"));
                    }
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
                let _pass = engine_lock.lock_or_recover();
                db::open(&vault::db_path(&root)).and_then(|conn| {
                    let outcome = engine::run(
                        &conn,
                        &vault::config_dir(&root),
                        &config,
                        chrono::Local::now(),
                    )?;
                    // the pass may have moved manual tasks (overdue
                    // carry-over), so the text mirror must follow
                    export_files(&conn, &root, &config, &Default::default(), true, &written);
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
            applog::set_max_kb(config.log_max_kb);
            let _ = app.emit("vault-updated", errors);
        }
    });
    Ok(())
}

/// The optional-file switches of a mirror export, from the config.
pub(crate) fn export_options(config: &AppConfig) -> tasks_mirror::ExportOptions {
    tasks_mirror::ExportOptions {
        ids: config.tasks_mirror_ids,
        agenda: config.tasks_mirror_agenda,
        today_file: config
            .tasks_mirror_today
            .then_some(config.tasks_mirror_today_days),
        preserve_pending: true,
    }
}

/// Synchronous export on the vault's own connection. Only for the places
/// that must see the files on disk before they return - opening a vault
/// (the pull flow adopts the exported files as its sync baseline right
/// after) - everything else goes through `AppState::request_export`.
pub(crate) fn mirror_export_now(state: &State<'_, AppState>) {
    let guard = state.vault.lock_or_recover();
    if let Some(vault) = guard.as_ref() {
        export_files(
            &vault.conn,
            &vault.root,
            &vault.config,
            &Default::default(),
            true,
            &state.mirror_written,
        );
    }
}

/// Watches <vault>/tasks and, after a debounce, imports outside edits of
/// the mirror files, then re-exports to normalize them (assign ids to
/// new lines, restore deleted managed files).
pub(crate) fn start_tasks_watcher(app: AppHandle, tasks_dir: &Path) -> Result<()> {
    let _ = std::fs::create_dir_all(tasks_dir);
    let (tx, rx) = mpsc::channel::<()>();
    let kick = tx.clone();
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
    *state.tasks_watcher.lock_or_recover() = Some(watcher);
    // one pass right away: a file edited while the app was closed differs
    // from its merge base, the export leaves it alone (`preserve_pending`)
    // and nothing else would ever import it
    let _ = kick.send(());

    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            std::thread::sleep(Duration::from_millis(500));
            while rx.try_recv().is_ok() {}

            let state = app.state::<AppState>();
            let snapshot = {
                let guard = state.vault.lock_or_recover();
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
                let _pass = engine_lock.lock_or_recover();
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
                        .lock_or_recover()
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
                // having just imported the disk, this export may rewrite
                // every file (no `preserve_pending`)
                export_files(&conn, &root, &config, &failed, false, &written);
            }
            if changed || !errors.is_empty() {
                let _ = app.emit("vault-updated", errors);
            }
        }
    });
    Ok(())
}

pub(crate) fn open_vault(
    app: &AppHandle,
    state: &State<'_, AppState>,
    root: &Path,
) -> Result<AppConfig> {
    let vault = Vault::open(root)?;
    // Tell this vault's database who is writing to it, so the merge
    // stamps (db.rs migration 016) carry a device and not a NULL. Best
    // effort: an unstamped row degrades a future merge, but failing to
    // open a vault over it would be worse.
    match app_config_dir(app).and_then(|dir| device::ensure(&dir)) {
        Ok(id) => {
            if let Err(e) = db::set_device_id(&vault.conn, &id) {
                applog::warn(format!(
                    "could not record this device's id in the vault: {e}"
                ));
            }
        }
        Err(e) => applog::warn(format!("could not determine this device's id: {e}")),
    }
    journal::ensure_template_location(root);
    let config = vault.config.clone();
    *state.vault.lock_or_recover() = Some(vault);
    // the vault's config replaces the defaults the app started with
    if let Some(msg) = sync_global_shortcut(app, &config) {
        applog::warn(msg);
    }
    sync_tray(app, &config);
    applog::set_max_kb(config.log_max_kb);
    // Always rebind: re-selecting a vault must watch the NEW config dir.
    // Replacing the watcher drops the old one, which closes its channel
    // and lets the old debounce thread exit.
    start_config_watcher(app.clone(), root)?;
    if config.tasks_mirror {
        mirror_export_now(state);
        if let Err(e) = start_tasks_watcher(app.clone(), &vault::tasks_dir(root)) {
            applog::error(format!(
                "task mirror watcher did not start, edits to the task files are not read: {e}"
            ));
        }
    } else {
        *state.tasks_watcher.lock_or_recover() = None;
    }
    Ok(config)
}

/// (Re)arms the KB watcher when the tree is loaded, so external edits
/// refresh the UI. Replaced when the KB path changes in settings.
pub(crate) fn ensure_kb_watcher(
    app: &AppHandle,
    state: &State<'_, AppState>,
    root: &Path,
) -> Result<()> {
    let mut guard = state.kb_watcher.lock_or_recover();
    if let Some((watched, _)) = guard.as_ref() {
        if watched == root {
            return Ok(());
        }
    }
    let (tx, rx) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            if watch_event_is_relevant(&event) && !is_work_dir_event(&event) {
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
            crate::sync_scheduler::poke();
            let _ = app.emit("kb-updated", ());
        }
    });
    Ok(())
}

/// Rebuilds app.db from the JSONL snapshot on disk. The caller holds the
/// engine lock (not taken here: `std::sync::Mutex` is not reentrant), so
/// no worker opens the database while its file is gone.
///
/// Closing the vault first is not optional: the file cannot be replaced
/// under a live connection, and a connection left open over a deleted
/// database would keep serving rows that no longer exist anywhere.
pub(crate) fn rebuild_cache(
    app: &AppHandle,
    state: &State<'_, AppState>,
    root: &Path,
) -> Result<()> {
    *state.vault.lock_or_recover() = None;
    let db = vault::db_path(root);
    // Keep the old cache aside: a merged snapshot the restore rejects
    // must not leave the device with no database and an unopenable vault.
    let aside = db.with_extension("db.rebuild-bak");
    let had_db = db.exists() && std::fs::copy(&db, &aside).is_ok();
    remove_db_files(root);
    match open_vault(app, state, root) {
        Ok(_) => {
            let _ = std::fs::remove_file(&aside);
            Ok(())
        }
        Err(e) => {
            if had_db {
                let _ = std::fs::rename(&aside, &db);
                let _ = open_vault(app, state, root);
            }
            Err(e)
        }
    }
}

pub(crate) fn remove_db_files(root: &Path) {
    let db = vault::db_path(root);
    for path in [
        db.clone(),
        db.with_extension("db-wal"),
        db.with_extension("db-shm"),
    ] {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn kb_watcher_ignores_the_apps_own_working_files() {
        use notify::{Event, EventKind};
        let db = Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
            .add_path("/vault/.hypomnema/app.db-wal".into());
        assert!(is_work_dir_event(&db));
        let note = Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
            .add_path("/vault/notes/a.md".into());
        assert!(!is_work_dir_event(&note));
        // a note called after the folder is still a note
        let lookalike = Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
            .add_path("/vault/.hypomnema-notes/a.md".into());
        assert!(!is_work_dir_event(&lookalike));
        // a mixed batch with one real note still counts
        let mixed = Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
            .add_path("/vault/.hypomnema/tasks/Inbox.md".into())
            .add_path("/vault/notes/a.md".into());
        assert!(!is_work_dir_event(&mixed));
        // pathless events are not dropped
        let bare = Event::new(EventKind::Modify(notify::event::ModifyKind::Any));
        assert!(!is_work_dir_event(&bare));
    }
}
