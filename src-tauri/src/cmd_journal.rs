//! Commands: journal entries.

use tauri::State;

use crate::error::Result;
use crate::journal;
use crate::state::*;

#[tauri::command]
pub(crate) async fn journal_open(
    state: State<'_, AppState>,
    date: String,
) -> Result<journal::JournalEntry> {
    with_vault_root(&state, |root| journal::open_entry(root, &date))
}

#[tauri::command]
pub(crate) async fn journal_save(
    state: State<'_, AppState>,
    date: String,
    content: String,
    base: Option<String>,
) -> Result<String> {
    let text = with_vault_root(&state, |root| {
        let saved = journal::save_entry_from(root, &date, &content, base.as_deref())?;
        if let Some(copy) = &saved.kept_aside {
            let file = journal::entry_path(root, &date)?;
            crate::sync_conflicts::log_kept_aside(root, &file, copy);
        }
        Ok(saved.text)
    })?;
    crate::sync_scheduler::poke();
    Ok(text)
}

#[tauri::command]
pub(crate) async fn journal_list(state: State<'_, AppState>) -> Result<Vec<String>> {
    journal::list_entries(&vault_root(&state)?)
}

#[tauri::command]
pub(crate) async fn journal_search(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<journal::JournalSearchHit>> {
    journal::search_entries(&vault_root(&state)?, &query)
}
