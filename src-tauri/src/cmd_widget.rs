//! The one command the Android home-screen widget needs from the
//! frontend: what a widget tap launched the app for.

use tauri::AppHandle;

use crate::error::Result;
use crate::widget::WidgetLaunch;

/// The list a widget tap opened the app on, once per tap; `None` for a
/// launch from the icon, and always on the desktop.
#[tauri::command]
pub(crate) async fn widget_launch_target(_app: AppHandle) -> Result<Option<WidgetLaunch>> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_widget::WidgetExt;
        return Ok(_app
            .widget()
            .take_launch_target()
            .map_err(crate::error::Error::State)?
            .map(|t| WidgetLaunch {
                list: t.list,
                add: t.add,
            }));
    }
    #[cfg(not(target_os = "android"))]
    Ok(None)
}
