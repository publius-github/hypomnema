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
) -> Result<()> {
    with_vault_root(&state, |root| journal::save_entry(root, &date, &content))?;
    crate::sync_scheduler::poke();
    Ok(())
}

#[tauri::command]
pub(crate) async fn journal_list(state: State<'_, AppState>) -> Result<Vec<String>> {
    with_vault_root(&state, journal::list_entries)
}

#[tauri::command]
pub(crate) async fn journal_search(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<journal::JournalSearchHit>> {
    with_vault_root(&state, |root| journal::search_entries(root, &query))
}
