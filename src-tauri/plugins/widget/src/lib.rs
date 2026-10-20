//! The home-screen list widget on Android.
//!
//! The Kotlin half (`android/`) is the widget itself: an
//! `AppWidgetProvider` drawing one list's open tasks from a JSON file in
//! the app's private files, a configure screen that picks the list, and
//! a tap handler that queues "mark done" actions in a file the Rust core
//! watches. This half is the typed Rust face of it: the core pushes a
//! fresh JSON after every export, and asks what a widget tap launched
//! the app for.
//!
//! Android only: the app depends on this crate for that target alone,
//! and on any other the crate is empty.
#![cfg(target_os = "android")]

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

/// What a widget tap asked the app to open: the Day, or a list.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchTarget {
    pub day: bool,
    pub list: Option<i64>,
    pub add: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchReply {
    /// "day", "list", or absent for no target.
    target: Option<String>,
    list: Option<i64>,
    #[serde(default)]
    add: bool,
}

/// The plugin's handle, kept in Tauri's state.
pub struct Widget<R: Runtime> {
    handle: PluginHandle<R>,
}

impl<R: Runtime> Widget<R> {
    /// Hands the widgets a fresh data file (`json`, the lists and their
    /// tasks) and the path of the action queue the core drains, then
    /// redraws every placed widget.
    pub fn publish(&self, json: &str, queue_path: &str) -> Result<(), String> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Args<'a> {
            json: &'a str,
            queue_path: &'a str,
        }
        self.handle
            .run_mobile_plugin::<serde_json::Value>("publish", Args { json, queue_path })
            .map(|_| ())
            .map_err(|e| format!("widget publish failed: {e}"))
    }

    /// The list a widget tap launched (or resumed) the app for, once:
    /// the Kotlin side forgets it on the first ask.
    pub fn take_launch_target(&self) -> Result<Option<LaunchTarget>, String> {
        let reply: LaunchReply = self
            .handle
            .run_mobile_plugin("takeLaunchTarget", ())
            .map_err(|e| format!("widget launch target failed: {e}"))?;
        Ok(match reply.target.as_deref() {
            Some("day") => Some(LaunchTarget {
                day: true,
                list: None,
                add: reply.add,
            }),
            Some("list") => reply.list.map(|list| LaunchTarget {
                day: false,
                list: Some(list),
                add: reply.add,
            }),
            _ => None,
        })
    }
}

/// `app.widget()` from anything that reaches the app.
pub trait WidgetExt<R: Runtime> {
    fn widget(&self) -> &Widget<R>;
}

impl<R: Runtime, T: Manager<R>> WidgetExt<R> for T {
    fn widget(&self) -> &Widget<R> {
        self.state::<Widget<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("widget")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.hypomnema.widget", "WidgetPlugin")?;
            app.manage(Widget { handle });
            Ok(())
        })
        .build()
}
