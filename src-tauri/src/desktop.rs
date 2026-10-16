//! Desktop-only chrome: main/capture windows, global shortcut, tray (mobile stubs alongside).

use tauri::AppHandle;
#[cfg(desktop)]
use tauri::{Emitter, Manager};

use crate::config::AppConfig;

// Reached from the tray (`sync_tray`, desktop-only below) and from a
// second launch handed over by the single-instance plugin -
// `unminimize` itself is a desktop-only WebviewWindow method on mobile.
#[cfg(desktop)]
pub(crate) fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Shows and focuses the pre-created quick-capture window; the emit
/// tells its frontend to clear and refocus the input.
#[cfg(desktop)]
pub(crate) fn show_capture(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit_to("capture", "capture-shown", ());
    }
}

/// (Re-)registers the global capture shortcut from the config. Returns
/// a message for the error banner when the combination cannot be
/// parsed or is taken by another app (a second Hypomnema can no longer
/// be the one holding it - see the single-instance plugin in `run`) - registration failure must never
/// block saving the config that caused it.
///
/// Desktop-only: global shortcuts and the tray (below) are desktop
/// concepts - mobile's quick-add
/// is in-app instead, so both get a no-op stub on mobile rather than
/// touching every call site.
#[cfg(desktop)]
pub(crate) fn sync_global_shortcut(app: &AppHandle, config: &AppConfig) -> Option<String> {
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
pub(crate) fn sync_tray(app: &AppHandle, config: &AppConfig) {
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
        crate::applog::warn(format!("tray icon failed: {e}"));
    }
}

/// Mobile stubs: no global shortcut / tray on Android, so every call
/// site (config reload, vault open, initial setup) stays unchanged.
#[cfg(mobile)]
pub(crate) fn sync_global_shortcut(_app: &AppHandle, _config: &AppConfig) -> Option<String> {
    None
}

#[cfg(mobile)]
pub(crate) fn sync_tray(_app: &AppHandle, _config: &AppConfig) {}
