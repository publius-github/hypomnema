//! Commands: the Notes file tree, search, backlinks, and opening external URLs.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};

use crate::error::{Error, Result};
use crate::state::*;
use crate::watchers::*;
use crate::{journal, kb, tasks};

/// Where the Notes tree is rooted.
///
/// The vault root unless `kb_path` names somewhere else that actually
/// exists on this device. Two cases make the fallback the only sane
/// answer, and both were errors before:
///
/// - **Nothing configured.** A vault always has notes in it - that is
///   what a vault is - so refusing to show them until a folder is
///   picked made the phone's Notes tab permanently empty.
/// - **A path from another machine.** `settings/` is device-local and
///   does not sync, but a vault copied wholesale from a desktop carries
///   its app.yml along, and `D:\Projects\...` means nothing on a phone.
///   Falling back beats reporting a drive letter the user cannot fix.
pub(crate) fn kb_root(state: &State<'_, AppState>) -> Result<PathBuf> {
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    let configured = vault.config.kb_path.trim();
    if !configured.is_empty() {
        let path = PathBuf::from(configured);
        if path.is_dir() {
            return Ok(path);
        }
    }
    Ok(vault.root.clone())
}

/// What the Notes tree is actually rooted at, and whether that is what
/// the settings asked for. A silent fallback would leave someone whose
/// external notes drive is unplugged quietly writing into the vault
/// instead, so the screens that can say so are given the means to.
#[tauri::command]
pub(crate) async fn kb_status(state: State<'_, AppState>) -> Result<KbStatus> {
    let configured = {
        let guard = state.vault.lock_or_recover();
        let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
        vault.config.kb_path.trim().to_string()
    };
    let root = kb_root(&state)?;
    let unreachable = !configured.is_empty() && Path::new(&configured) != root;
    Ok(KbStatus {
        root: root.to_string_lossy().into_owned(),
        configured,
        unreachable,
    })
}

#[derive(serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub(crate) struct KbStatus {
    /// The folder the tree is being read from right now.
    root: String,
    /// What `kb_path` says, empty when unset.
    configured: String,
    /// `configured` is set but not usable here, so `root` is a fallback.
    unreachable: bool,
}

#[tauri::command]
pub(crate) async fn kb_tree(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<kb::KbNode>> {
    let root = kb_root(&state)?;
    let tree = kb::tree(&root)?;
    ensure_kb_watcher(&app, &state, &root)?;
    Ok(tree)
}

#[tauri::command]
pub(crate) async fn kb_read(state: State<'_, AppState>, path: String) -> Result<String> {
    kb::read(&kb_root(&state)?, &path)
}

#[tauri::command]
pub(crate) async fn kb_write(
    state: State<'_, AppState>,
    path: String,
    content: String,
    base: Option<String>,
) -> Result<String> {
    let root = kb_root(&state)?;
    let (stamp, vault_root) = {
        let guard = state.vault.lock_or_recover();
        let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
        // Markdown notes only, and never a journal entry reached through
        // a vault-rooted Notes tree: the journal keeps its own shape
        let markdown = Path::new(&path)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));
        let journal = root == vault.root && path.starts_with("journal/");
        (
            vault.config.notes_timestamps && markdown && !journal,
            vault.root.clone(),
        )
    };
    let (text, kept_aside) = kb::write_from(&root, &path, &content, base.as_deref(), stamp)?;
    if let Some(copy) = kept_aside {
        crate::sync_conflicts::log_kept_aside(&vault_root, &root.join(&path), &copy);
    }
    crate::sync_scheduler::poke();
    Ok(text)
}

#[tauri::command]
pub(crate) async fn kb_create(state: State<'_, AppState>, path: String) -> Result<String> {
    kb::create(&kb_root(&state)?, &path)
}

#[tauri::command]
pub(crate) async fn kb_rename(state: State<'_, AppState>, from: String, to: String) -> Result<()> {
    kb::rename(&kb_root(&state)?, &from, &to)
}

#[tauri::command]
pub(crate) async fn kb_copy(
    state: State<'_, AppState>,
    from: String,
    to_dir: String,
) -> Result<String> {
    kb::copy_into(&kb_root(&state)?, &from, &to_dir)
}

#[tauri::command]
pub(crate) async fn kb_delete(state: State<'_, AppState>, path: String) -> Result<()> {
    kb::delete(&kb_root(&state)?, &path)
}

#[tauri::command]
pub(crate) async fn kb_mkdir(state: State<'_, AppState>, path: String) -> Result<String> {
    kb::create_dir(&kb_root(&state)?, &path)
}

/// Absolute path of a note or folder, for "copy path" in the tree.
/// "" is the KB root itself.
#[tauri::command]
pub(crate) async fn kb_abs_path(state: State<'_, AppState>, path: String) -> Result<String> {
    Ok(kb::abs_path(&kb_root(&state)?, &path)?
        .to_string_lossy()
        .into_owned())
}

/// Shows a note or folder in the system file manager. Only paths inside
/// the KB root resolve, and the file manager is launched directly with
/// the path - no shell is involved, so nothing in a name is interpreted.
#[tauri::command]
pub(crate) async fn kb_reveal(state: State<'_, AppState>, path: String) -> Result<()> {
    let target = kb::abs_path(&kb_root(&state)?, &path)?;
    #[cfg(target_os = "windows")]
    let mut command = {
        // explorer.exe does not parse its command line the way
        // CommandLineToArgvW does, so Rust's own argument quoting is
        // wrong for it: a path with a space arrives as `"/select,C:\My`
        // and explorer falls back to opening some default folder. The
        // quotes have to sit *inside* the argument, which means writing
        // the command line ourselves via raw_arg.
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("explorer.exe");
        if target.is_dir() {
            c.raw_arg(format!("\"{}\"", target.display()));
        } else {
            c.raw_arg(format!("/select,\"{}\"", target.display()));
        }
        c
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = std::process::Command::new("open");
        if target.is_dir() {
            c.arg(&target);
        } else {
            c.arg("-R").arg(&target);
        }
        c
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = {
        let mut c = std::process::Command::new("xdg-open");
        // no portable "select the file" on Linux: open the folder
        c.arg(if target.is_dir() {
            target.clone()
        } else {
            target.parent().unwrap_or(&target).to_path_buf()
        });
        c
    };
    command.spawn()?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn kb_search(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<kb::KbSearchHit>> {
    kb::search_content(&kb_root(&state)?, &query)
}

/// Everything pointing at a note: notes (links and plain mentions),
/// journal entries and tasks. Discriminated by field - the panel
/// renders them as separate groups anyway.
#[derive(serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct BacklinksResult {
    pub links: Vec<kb::KbSearchHit>,
    pub mentions: Vec<kb::KbSearchHit>,
    pub journal: Vec<journal::JournalBacklinkHit>,
    pub tasks: Vec<tasks::TaskBacklinkHit>,
}

#[tauri::command]
pub(crate) async fn kb_backlinks(
    state: State<'_, AppState>,
    path: String,
) -> Result<BacklinksResult> {
    let target = std::path::Path::new(&path);
    let stem = target
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let full_name = target
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let kb_root = kb_root(&state)?;
    let vault_root = vault_root(&state)?;
    // the two file walks run without the vault lock; only the task
    // query needs the connection
    let notes = kb::backlinks(&kb_root, &path)?;
    let journal = journal::backlinks(&vault_root, &stem, &full_name)?;
    let tasks = with_conn(&state, |conn| tasks::backlinks(conn, &stem, &full_name))?;
    // with the KB rooted at the vault, journal entries are inside the
    // note tree too; the dedicated journal scan is authoritative there
    let journal_inside = kb_root == vault_root;
    let drop_journal_notes = |hits: Vec<kb::KbSearchHit>| -> Vec<kb::KbSearchHit> {
        if !journal_inside {
            return hits;
        }
        hits.into_iter()
            .filter(|h| !h.path.starts_with("journal/"))
            .collect()
    };
    Ok(BacklinksResult {
        links: drop_journal_notes(notes.links),
        mentions: drop_journal_notes(notes.mentions),
        journal,
        tasks,
    })
}

/// Only web and mail links leave the app, and only as a single argument
/// to the platform launcher - no shell, so nothing in the URL can be
/// read as a command.
pub(crate) fn is_openable_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if !["http://", "https://", "mailto:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
    {
        return false;
    }
    !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Opens a link from a note or a task description in the system browser
/// (the webview would otherwise navigate the app itself).
#[tauri::command]
pub(crate) async fn open_external(url: String) -> Result<()> {
    let url = url.trim().to_string();
    if !is_openable_url(&url) {
        return Err(Error::State(format!("refusing to open {url}")));
    }
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("rundll32.exe");
        c.arg("url.dll,FileProtocolHandler").arg(&url);
        c
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = std::process::Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&url);
        c
    };
    command.spawn()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_and_mail_urls_leave_the_app() {
        assert!(is_openable_url("https://example.com/a?b=1#c"));
        assert!(is_openable_url("HTTP://example.com"));
        assert!(is_openable_url("mailto:me@example.com"));
        assert!(!is_openable_url("file:///etc/passwd"));
        assert!(!is_openable_url("javascript:alert(1)"));
        assert!(!is_openable_url("C:\\Windows\\System32\\calc.exe"));
        assert!(!is_openable_url("https://example.com/a b"));
        assert!(!is_openable_url("https://example.com/\na"));
        assert!(!is_openable_url(""));
    }
}
