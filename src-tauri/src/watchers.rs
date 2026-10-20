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
use crate::{
    applog, config_files, db, device, engine, journal, starter, state_export, tasks_mirror, vault,
};

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
                #[cfg(target_os = "android")]
                crate::widget::android::publish(&app, &conn);
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
    // A vault nobody has used yet starts with the starter lists; the
    // starter rules went into its config files with the open. Best
    // effort: a vault that opens without them is still a vault.
    if vault.fresh {
        match starter::seed(&vault.conn, chrono::Local::now().date_naive()) {
            Ok(()) => state.request_export(),
            Err(e) => applog::warn(format!("starter content was not written: {e}")),
        }
    }
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
    // the home-screen widget: taps queued while the app was closed go
    // in now, and the widget is redrawn from this vault either way
    #[cfg(target_os = "android")]
    {
        crate::widget::android::drain(app);
        state.request_export();
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
    replace_db_files(root, || open_vault(app, state, root).map(|_| ()))
}

/// The file half of `rebuild_cache`: drops app.db and opens the vault
/// again (`open`), which restores it from the snapshot. The old cache is
/// kept aside meanwhile - a merged snapshot the restore rejects must not
/// leave the device with no database and an unopenable vault - and put
/// back, then opened, when `open` fails.
fn replace_db_files(root: &Path, mut open: impl FnMut() -> Result<()>) -> Result<()> {
    let db = vault::db_path(root);
    let aside = db.with_extension("db.rebuild-bak");
    let had_db = db.exists();
    if had_db {
        // no copy, no rebuild: there would be nothing to fall back on
        if let Err(e) = std::fs::copy(&db, &aside) {
            let _ = open();
            return Err(Error::io_at(&aside, e));
        }
    }
    remove_db_files(root);
    if db.exists() {
        // Still there - held open by another program (Windows refuses to
        // delete an open file). Opening it now would skip the restore and
        // export the old state over the snapshot being rebuilt from.
        let _ = std::fs::remove_file(&aside);
        let _ = open();
        return Err(Error::State(format!(
            "could not replace {} (is another program holding it open?); \
             the database was left as it was",
            db.display()
        )));
    }
    match open() {
        Ok(()) => {
            let _ = std::fs::remove_file(&aside);
            Ok(())
        }
        Err(e) => {
            if had_db {
                remove_db_files(root);
                let _ = std::fs::rename(&aside, &db);
                let _ = open();
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
    use crate::tasks::NewTask;

    fn vault_with_a_task(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("hypomnema-watchers-{name}"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let vault = Vault::open(&root).unwrap();
        crate::tasks::task_create(
            &vault.conn,
            &NewTask {
                title: "survives".into(),
                ..Default::default()
            },
        )
        .unwrap();
        crate::state_export::export(&vault.conn, &vault::state_dir(&root)).unwrap();
        root
    }

    fn titles(root: &Path) -> Vec<String> {
        let vault = Vault::open(root).unwrap();
        let mut stmt = vault.conn.prepare("SELECT title FROM tasks").unwrap();
        let rows = stmt.query_map([], |row| row.get(0)).unwrap();
        rows.map(|r| r.unwrap()).collect()
    }

    #[test]
    fn a_rebuild_restores_the_database_from_the_snapshot() {
        let root = vault_with_a_task("rebuild");

        replace_db_files(&root, || Vault::open(&root).map(|_| ())).unwrap();

        assert_eq!(titles(&root), ["survives"]);
        assert!(!vault::db_path(&root)
            .with_extension("db.rebuild-bak")
            .exists());
    }

    #[test]
    fn writes_made_while_a_pass_was_out_survive_its_rebuild() {
        let root = vault_with_a_task("rebuild-fold");
        let vault = Vault::open(&root).unwrap();
        // the pass starts: its export is the base of the fold
        let at_start = state_export::snapshot(&vault.conn).unwrap();
        state_export::write(&vault::state_dir(&root), &at_start).unwrap();
        // on the network: the user adds a task here...
        crate::tasks::task_create(
            &vault.conn,
            &NewTask {
                title: "added meanwhile".into(),
                ..Default::default()
            },
        )
        .unwrap();
        // ...and the merge brings the other device's rename
        let path = vault::state_dir(&root).join("tasks.jsonl");
        let merged = std::fs::read_to_string(&path)
            .unwrap()
            .replace("\"survives\"", "\"renamed there\"")
            .replace("\"updated_at\":\"", "\"updated_at\":\"9");
        std::fs::write(&path, merged).unwrap();

        let at_end = state_export::snapshot(&vault.conn).unwrap();
        assert!(crate::sync_cycle::fold_local_writes(
            &root,
            &at_start,
            &at_end,
            "2026-10-17T00:00:00Z"
        )
        .unwrap());
        drop(vault);
        replace_db_files(&root, || Vault::open(&root).map(|_| ())).unwrap();

        let mut titles = titles(&root);
        titles.sort();
        assert_eq!(titles, ["added meanwhile", "renamed there"]);
    }

    #[test]
    fn a_rebuild_with_no_safety_copy_leaves_the_database_alone() {
        let root = vault_with_a_task("rebuild-no-copy");
        // a folder where the copy goes: it cannot be made
        let aside = vault::db_path(&root).with_extension("db.rebuild-bak");
        std::fs::create_dir_all(&aside).unwrap();
        std::fs::write(vault::state_dir(&root).join("tasks.jsonl"), "").unwrap();

        let result = replace_db_files(&root, || Vault::open(&root).map(|_| ()));

        assert!(result.is_err());
        assert_eq!(titles(&root), ["survives"]);
    }

    #[test]
    fn a_rebuild_the_snapshot_refuses_puts_the_old_database_back() {
        let root = vault_with_a_task("rebuild-refused");
        std::fs::write(vault::state_dir(&root).join("tasks.jsonl"), "{not json}\n").unwrap();

        let result = replace_db_files(&root, || Vault::open(&root).map(|_| ()));

        assert!(result.is_err());
        assert_eq!(titles(&root), ["survives"]);
        assert!(!vault::db_path(&root)
            .with_extension("db.rebuild-bak")
            .exists());
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
