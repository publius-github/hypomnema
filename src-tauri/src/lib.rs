mod android_storage;
mod applog;
mod backup;
mod config;
mod config_files;
mod crypto;
mod db;
mod device;
mod engine;
mod error;
mod example;
#[cfg(desktop)]
mod google_auth;
mod google_link;
mod ids;
mod journal;
mod kb;
mod nav_guard;
#[cfg(desktop)]
mod oauth;
mod reminders;
mod secret_store;
mod state_export;
mod sync_bootstrap;
mod sync_conflicts;
mod sync_cycle;
mod sync_gdrive;
mod sync_merge;
mod sync_paths;
mod sync_provider;
mod sync_push;
mod sync_scheduler;
mod sync_state;
mod tasks;
mod tasks_mirror;
mod text_merge;
mod vault;
mod vault_export;
mod vault_places;
mod views;

mod cmd_journal;
mod cmd_kb;
mod cmd_rules;
mod cmd_sync;
mod cmd_tasks;
mod cmd_vault;
mod cmd_views;
mod desktop;
mod state;
mod watchers;

use tauri::Manager;

use config::AppConfig;
#[cfg(desktop)]
use desktop::show_main;
use desktop::{sync_global_shortcut, sync_tray};
use state::{AppState, LockOrRecover};
use watchers::start_export_worker;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // registered first, so a second launch exits before it sets anything
    // up (tray, capture shortcut, watchers) and the running instance
    // brings its window back instead
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        show_main(app);
    }));
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        // opener works on Android too, unlike open_external's xdg-open
        // fallback - the desktop's Google consent page opens through it.
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(nav_guard::init());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_google_auth::init());
    // updater (GitHub-releases) and the global capture shortcut are
    // desktop-only concepts - mobile has no
    // equivalent plugin to register in their place.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());
    builder
        .setup(|app| {
            if let Ok(dir) = app.path().app_config_dir() {
                let _ = std::fs::create_dir_all(&dir);
                applog::init(dir.join(applog::FILE_NAME));
            }
            start_export_worker(app.handle().clone());
            sync_scheduler::start(app.handle().clone());
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
                applog::warn(format!("quick-capture window failed to open: {e}"));
            }
            // the vault (and its config) opens later, via vault_status
            // from the frontend; until then the defaults keep the
            // shortcut and tray alive so capture works pre-vault too
            // (no-op on mobile, see the stubs above)
            let defaults = AppConfig::default();
            if let Some(msg) = sync_global_shortcut(app.handle(), &defaults) {
                applog::warn(msg);
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
                #[cfg(desktop)]
                if let tauri::WindowEvent::Focused(true) = event {
                    sync_scheduler::focused();
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let state = window.state::<AppState>();
                    let hide = {
                        let guard = state.vault.lock_or_recover();
                        guard
                            .as_ref()
                            .map(|v| v.config.tray_icon)
                            .unwrap_or_else(|| AppConfig::default().tray_icon)
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
            cmd_vault::vault_status,
            cmd_vault::vault_select,
            cmd_vault::vault_create_example,
            cmd_vault::vault_use_local,
            cmd_vault::vault_local_path,
            cmd_vault::vault_browse,
            cmd_vault::vault_browse_mkdir,
            cmd_vault::storage_access,
            cmd_vault::storage_access_request,
            cmd_vault::third_party_licenses,
            cmd_vault::log_write,
            cmd_vault::diagnostics,
            cmd_vault::log_reveal,
            cmd_vault::vault_use_path,
            cmd_vault::vault_export,
            cmd_vault::config_get,
            cmd_vault::config_set,
            cmd_vault::config_default,
            cmd_tasks::lists_all,
            cmd_tasks::list_create,
            cmd_tasks::list_rename,
            cmd_tasks::list_set_favorite,
            cmd_tasks::list_set_meta,
            cmd_tasks::list_set_all_statuses,
            cmd_tasks::list_groups_all,
            cmd_tasks::list_group_create,
            cmd_tasks::list_group_set_meta,
            cmd_tasks::list_group_delete,
            cmd_tasks::list_set_group,
            cmd_tasks::list_archive,
            cmd_tasks::lists_archived,
            cmd_tasks::list_unarchive,
            cmd_tasks::tasks_snapshot,
            cmd_tasks::task_create,
            cmd_tasks::capture_task,
            cmd_tasks::inbox_list,
            cmd_tasks::task_update,
            cmd_tasks::task_delete,
            cmd_tasks::task_restore,
            cmd_tasks::tasks_delete_done,
            cmd_tasks::tasks_reorder,
            cmd_vault::backups_list,
            cmd_vault::backup_restore_db,
            cmd_vault::backup_restore_config,
            cmd_tasks::engine_run,
            cmd_views::upcoming_events,
            cmd_journal::journal_open,
            cmd_journal::journal_save,
            cmd_journal::journal_list,
            cmd_journal::journal_search,
            cmd_kb::kb_tree,
            cmd_kb::kb_status,
            cmd_kb::kb_read,
            cmd_kb::kb_write,
            cmd_kb::kb_create,
            cmd_kb::kb_rename,
            cmd_kb::kb_copy,
            cmd_kb::kb_delete,
            cmd_kb::kb_mkdir,
            cmd_kb::kb_abs_path,
            cmd_kb::kb_reveal,
            cmd_views::dashboard_context,
            cmd_views::birthdays_list,
            cmd_views::calendar_outlook,
            cmd_views::recurring_list,
            cmd_rules::recurring_add,
            cmd_rules::scheduled_add,
            cmd_rules::birthday_add,
            cmd_rules::recurring_edit,
            cmd_rules::scheduled_edit,
            cmd_rules::birthday_edit,
            cmd_rules::reminders_overview,
            cmd_rules::focus_phrase_add,
            cmd_rules::focus_phrase_edit,
            cmd_rules::day_reminder_add,
            cmd_rules::day_reminder_edit,
            cmd_rules::schedule_block_add,
            cmd_rules::schedule_block_edit,
            cmd_rules::config_file_get,
            cmd_rules::config_file_set,
            cmd_kb::kb_search,
            cmd_kb::kb_backlinks,
            cmd_tasks::tasks_search,
            cmd_views::daily_streaks,
            cmd_views::habit_rates,
            cmd_tasks::task_get,
            cmd_kb::open_external,
            state::platform_is_mobile,
            cmd_sync::sync_reset_space,
            cmd_sync::sync_now,
            cmd_sync::google_status,
            cmd_sync::google_sign_in,
            cmd_sync::google_sign_in_cancel,
            cmd_sync::google_sign_out,
            cmd_sync::google_pull_vault,
            cmd_sync::sync_conflicts_list,
            cmd_sync::sync_conflicts_clear,
            cmd_sync::sync_conflict_diff,
            cmd_sync::sync_conflict_resolve,
            cmd_sync::sync_standing,
            cmd_sync::app_lock_state,
            cmd_sync::app_lock_enable,
            cmd_sync::app_lock_disable,
            cmd_sync::app_lock_now,
            cmd_sync::app_unlock
        ])
        .build(tauri::generate_context!())
        .expect("error while building hypomnema")
        .run(|_app, _event| {
            // quitting sends what is still waiting to go up (best effort)
            #[cfg(desktop)]
            if let tauri::RunEvent::Exit = _event {
                sync_scheduler::on_exit(_app);
            }
        });
}
