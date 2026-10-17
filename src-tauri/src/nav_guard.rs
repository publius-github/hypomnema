//! Keeps every app window on the app. The frontend already sends links
//! to the system browser (`open_external`), but a click it does not
//! catch - a link in some new view, a middle click - would otherwise
//! navigate the webview itself and replace the app with a web page. That
//! page would get no IPC (capabilities cover the app's own origin only),
//! yet it would sit inside a trusted window, and whatever the user had
//! unsaved would be gone. So the core refuses any navigation away from
//! the app's origin, and hands a web or mail link to the browser instead.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime, Url};
use tauri_plugin_opener::OpenerExt;

use crate::applog;
use crate::cmd_kb::is_openable_url;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nav-guard")
        .on_navigation(|webview, url| {
            // the dev server only counts in a debug build
            let dev_url = if cfg!(debug_assertions) {
                webview.config().build.dev_url.clone()
            } else {
                None
            };
            if is_app_url(url, dev_url.as_ref()) {
                return true;
            }
            if is_openable_url(url.as_str()) {
                if let Err(e) = webview
                    .app_handle()
                    .opener()
                    .open_url(url.as_str(), None::<&str>)
                {
                    applog::warn(format!("could not open {url} in the browser: {e}"));
                }
            } else {
                applog::warn(format!("refused to navigate the app window to {url}"));
            }
            false
        })
        .build()
}

/// The app's own pages: `tauri://localhost` (macOS, Linux), its
/// `http(s)://tauri.localhost` stand-in (Windows, Android), the dev
/// server in a debug build, and the empty page a webview starts on.
fn is_app_url(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || dev_url.is_some_and(|dev| dev.origin() == url.origin())
        }
        "about" => url.path() == "blank",
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn the_app_stays_on_its_own_pages() {
        for page in [
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
            "https://tauri.localhost/index.html#/capture",
            "about:blank",
        ] {
            assert!(is_app_url(&url(page), None), "{page}");
        }
    }

    #[test]
    fn anything_else_is_not_the_app() {
        for page in [
            "https://example.com/",
            "http://tauri.localhost.example.com/",
            "https://example.com/?tauri.localhost",
            "tauri://example.com/",
            "file:///C:/Windows/System32/calc.exe",
            "data:text/html,<p>hi</p>",
            "javascript:alert(1)",
            "about:srcdoc",
            "http://localhost:1420/",
        ] {
            assert!(!is_app_url(&url(page), None), "{page}");
        }
    }

    #[test]
    fn the_dev_server_counts_only_as_its_exact_origin() {
        let dev = url("http://localhost:1420");
        assert!(is_app_url(
            &url("http://localhost:1420/index.html"),
            Some(&dev)
        ));
        assert!(!is_app_url(&url("http://localhost:8080/"), Some(&dev)));
        assert!(!is_app_url(&url("https://localhost:1420/"), Some(&dev)));
    }
}
