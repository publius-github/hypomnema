//! When the desktop syncs on its own (Google Drive only): a thread in the
//! Rust core rather than a timer in React, because the window may sit
//! hidden in the tray for days while the vault keeps changing.
//!
//! A pass runs when any of these comes due, and only while a vault is open,
//! the device is signed in to Google and `sync_auto` is on:
//! - right after start, then every `sync_interval_minutes`;
//! - `sync_debounce_seconds` after the last local change (`poke`, from the
//!   export worker and note/journal saves) - and only if something is
//!   actually waiting to go up, so the export that follows a pass does
//!   not trigger the next one;
//! - when the main window gets focus (`sync_on_focus`), at most once a
//!   minute, to bring down what the other device did meanwhile;
//! - on quit (`sync_on_leave`), best effort with a time limit.
//!
//! One pass at a time: `cmd_sync::google_pass` refuses to start a second.
//!
//! The phone runs this thread too, for the after-edit pass alone: coming
//! back to the app, leaving it, the heartbeat and regaining a network are
//! moments the WebView sees (`MobileApp.tsx`), but an edit is a Rust-side
//! event, and waiting for the next of those moments is what lets two
//! devices drift apart long enough to edit the same thing.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::config::AppConfig;
use crate::state::{app_config_dir, now_unix, AppState, LockOrRecover};
use crate::{cmd_sync, google_link, sync_bootstrap, sync_cycle};

/// How often the thread looks at the clock and the flags.
const TICK: Duration = Duration::from_secs(5);
/// A focus pass no sooner than this after the previous pass.
const FOCUS_MIN_GAP_SECS: i64 = 60;
/// How long quitting waits for its pass.
const EXIT_TIMEOUT: Duration = Duration::from_secs(20);

/// Unix time of the latest local change not yet synced; 0 = none.
static CHANGED_AT: AtomicI64 = AtomicI64::new(0);
static FOCUSED: AtomicBool = AtomicBool::new(false);

/// Something in the vault changed here.
pub fn poke() {
    CHANGED_AT.store(now_unix(), Ordering::SeqCst);
}

/// The main window came to the front.
pub fn focused() {
    FOCUSED.store(true, Ordering::SeqCst);
}

/// The open vault's root and config, if a vault is open and this device
/// is signed in to Google.
fn context(app: &AppHandle) -> Option<(std::path::PathBuf, AppConfig)> {
    let dir = app_config_dir(app).ok()?;
    if !google_link::is_signed_in(&dir) {
        return None;
    }
    let state = app.state::<AppState>();
    let guard = state.vault.lock_or_recover();
    guard
        .as_ref()
        .map(|vault| (vault.root.clone(), vault.config.clone()))
}

/// Files changed here since the last pass - a directory walk, no network.
fn pending(root: &std::path::Path) -> usize {
    sync_cycle::standing(root, &sync_bootstrap::VaultRoot(String::new()))
        .map(|s| s.pending)
        .unwrap_or(0)
}

/// What one tick decides. Pure, so the triggers are testable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Due {
    interval: bool,
    focus: bool,
    edit: bool,
}

fn due(
    config: &AppConfig,
    now: i64,
    last_pass: Option<i64>,
    changed_at: i64,
    focused: bool,
) -> Due {
    let since_last = last_pass.map(|t| now - t);
    Due {
        interval: since_last.is_none_or(|gap| gap >= i64::from(config.sync_interval_minutes) * 60),
        focus: focused
            && config.sync_on_focus
            && since_last.is_none_or(|gap| gap >= FOCUS_MIN_GAP_SECS),
        edit: changed_at > 0 && now - changed_at >= i64::from(config.sync_debounce_seconds),
    }
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_pass: Option<i64> = None;
        loop {
            std::thread::sleep(TICK);
            let Some((root, config)) = context(&app) else {
                continue;
            };
            let focused = FOCUSED.swap(false, Ordering::SeqCst);
            if !config.sync_auto {
                CHANGED_AT.store(0, Ordering::SeqCst);
                continue;
            }
            let now = now_unix();
            let due = due(
                &config,
                now,
                last_pass,
                CHANGED_AT.load(Ordering::SeqCst),
                focused,
            );
            if due.edit {
                CHANGED_AT.store(0, Ordering::SeqCst);
            }
            // the phone's other moments belong to MobileApp.tsx
            let due = if cfg!(mobile) {
                Due {
                    interval: false,
                    focus: false,
                    ..due
                }
            } else {
                due
            };
            if due.interval || due.focus || (due.edit && pending(&root) > 0) {
                last_pass = Some(now);
                log_pass(cmd_sync::google_pass(&app));
            }
        }
    });
}

/// An automatic pass has no banner to fail into (the Sync tab shows
/// only the latest standing), so its failure goes to the log.
fn log_pass<T>(result: crate::error::Result<T>) {
    if let Err(e) = result {
        crate::applog::warn(format!("automatic sync pass failed: {e}"));
    }
}

/// Quitting: send what is waiting, if anything, within a time limit.
pub fn on_exit(app: &AppHandle) {
    let Some((root, config)) = context(app) else {
        return;
    };
    if !config.sync_auto || !config.sync_on_leave || pending(&root) == 0 {
        return;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let app = app.clone();
    std::thread::spawn(move || {
        log_pass(cmd_sync::google_pass(&app));
        let _ = tx.send(());
    });
    let _ = rx.recv_timeout(EXIT_TIMEOUT);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> AppConfig {
        AppConfig {
            sync_interval_minutes: 15,
            sync_debounce_seconds: 60,
            sync_on_focus: true,
            ..AppConfig::default()
        }
    }

    #[test]
    fn the_first_tick_after_start_is_due() {
        assert!(due(&config(), 1000, None, 0, false).interval);
    }

    #[test]
    fn the_interval_counts_from_the_last_pass() {
        let c = config();
        assert!(!due(&c, 1000 + 14 * 60, Some(1000), 0, false).interval);
        assert!(due(&c, 1000 + 15 * 60, Some(1000), 0, false).interval);
    }

    #[test]
    fn an_edit_waits_out_the_debounce() {
        let c = config();
        assert!(!due(&c, 1030, Some(0), 1000, false).edit);
        assert!(due(&c, 1060, Some(0), 1000, false).edit);
        assert!(!due(&c, 1060, Some(0), 0, false).edit);
    }

    #[test]
    fn focus_is_throttled_and_can_be_turned_off() {
        let mut c = config();
        assert!(!due(&c, 1030, Some(1000), 0, true).focus);
        assert!(due(&c, 1060, Some(1000), 0, true).focus);
        c.sync_on_focus = false;
        assert!(!due(&c, 1060, Some(1000), 0, true).focus);
    }
}
