//! Commands: the rule and reminder YAML files, and the editable config files.

use std::path::PathBuf;

use tauri::State;

use crate::error::{Error, Result};
use crate::state::*;
use crate::{backup, config_files, reminders, vault};

#[tauri::command]
pub(crate) async fn recurring_add(
    state: State<'_, AppState>,
    rule: config_files::RecurringRule,
) -> Result<()> {
    backup_config(&state, "recurring.yml");
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    config_files::append_recurring(&vault.config_dir(), rule)
}

#[tauri::command]
pub(crate) async fn scheduled_add(
    state: State<'_, AppState>,
    event: config_files::ScheduledEvent,
) -> Result<()> {
    backup_config(&state, "scheduled.yml");
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    config_files::append_scheduled(&vault.config_dir(), event)
}

#[tauri::command]
pub(crate) async fn birthday_add(
    state: State<'_, AppState>,
    entry: config_files::BirthdayEntry,
) -> Result<()> {
    backup_config(&state, "birthdays.yml");
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    config_files::append_birthday(&vault.config_dir(), entry)
}

#[tauri::command]
pub(crate) async fn recurring_edit(
    state: State<'_, AppState>,
    index: usize,
    replacement: Option<config_files::RecurringRule>,
) -> Result<()> {
    backup_config(&state, "recurring.yml");
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    config_files::edit_recurring(&vault.config_dir(), index, replacement)
}

#[tauri::command]
pub(crate) async fn scheduled_edit(
    state: State<'_, AppState>,
    original: config_files::ScheduledEvent,
    replacement: Option<config_files::ScheduledEvent>,
) -> Result<()> {
    backup_config(&state, "scheduled.yml");
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    config_files::edit_scheduled(&vault.config_dir(), original, replacement)
}

#[tauri::command]
pub(crate) async fn birthday_edit(
    state: State<'_, AppState>,
    original: config_files::BirthdayEntry,
    replacement: Option<config_files::BirthdayEntry>,
) -> Result<()> {
    backup_config(&state, "birthdays.yml");
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    config_files::edit_birthday(&vault.config_dir(), original, replacement)
}

#[tauri::command]
pub(crate) async fn reminders_overview(
    state: State<'_, AppState>,
) -> Result<reminders::RemindersOverview> {
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    reminders::overview(
        &vault.conn,
        &vault.config_dir(),
        chrono::Local::now().date_naive(),
    )
}

#[tauri::command]
pub(crate) async fn focus_phrase_add(state: State<'_, AppState>, phrase: String) -> Result<()> {
    backup_config(&state, "weekly-focus.yml");
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    config_files::append_focus_phrase(&vault.config_dir(), phrase)
}

#[tauri::command]
pub(crate) async fn focus_phrase_edit(
    state: State<'_, AppState>,
    index: usize,
    replacement: Option<String>,
) -> Result<()> {
    backup_config(&state, "weekly-focus.yml");
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    config_files::edit_focus_phrase(&vault.config_dir(), index, replacement)
}

#[tauri::command]
pub(crate) async fn day_reminder_add(
    state: State<'_, AppState>,
    entry: reminders::DayReminder,
) -> Result<()> {
    backup_config(&state, "day-reminders.yml");
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    config_files::append_day_reminder(&vault.config_dir(), entry)
}

#[tauri::command]
pub(crate) async fn day_reminder_edit(
    state: State<'_, AppState>,
    index: usize,
    replacement: Option<reminders::DayReminder>,
) -> Result<()> {
    backup_config(&state, "day-reminders.yml");
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    config_files::edit_day_reminder(&vault.config_dir(), index, replacement)
}

#[tauri::command]
pub(crate) async fn schedule_block_add(
    state: State<'_, AppState>,
    block: reminders::ScheduleBlock,
) -> Result<()> {
    backup_config(&state, "day-schedule.yml");
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    config_files::append_schedule_block(&vault.config_dir(), block)
}

#[tauri::command]
pub(crate) async fn schedule_block_edit(
    state: State<'_, AppState>,
    index: usize,
    replacement: Option<reminders::ScheduleBlock>,
) -> Result<()> {
    backup_config(&state, "day-schedule.yml");
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    config_files::edit_schedule_block(&vault.config_dir(), index, replacement)
}

pub(crate) const EDITABLE_CONFIG_FILES: &[&str] = &[
    "recurring.yml",
    "scheduled.yml",
    "birthdays.yml",
    "weekly-focus.yml",
    "day-reminders.yml",
    "day-schedule.yml",
    "templates/journal.md",
];

pub(crate) fn is_editable_config_file(file: &str) -> bool {
    EDITABLE_CONFIG_FILES.contains(&file)
}

pub(crate) fn editable_config_path(state: &State<'_, AppState>, file: &str) -> Result<PathBuf> {
    if !is_editable_config_file(file) {
        return Err(Error::State(format!("not an editable config file: {file}")));
    }
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    Ok(vault.config_dir().join(file))
}

#[tauri::command]
pub(crate) async fn config_file_get(state: State<'_, AppState>, file: String) -> Result<String> {
    let path = editable_config_path(&state, &file)?;
    // A read failure must surface: showing the file as empty would let
    // the next save in the editor overwrite the real content.
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(Error::State(format!("cannot read {file}: {e}"))),
    }
}

/// Validates and, when valid, writes the config file. Invalid content is
/// never written, so the last valid state stays active (req. 19).
#[tauri::command]
pub(crate) async fn config_file_set(
    state: State<'_, AppState>,
    file: String,
    content: String,
) -> Result<Vec<config_files::ConfigError>> {
    let path = editable_config_path(&state, &file)?;
    let errors = config_files::validate_config_content(&file, &content);
    if errors.is_empty() {
        backup_config(&state, &file);
        vault::write_atomic(&path, &content)?;
    }
    Ok(errors)
}

/// Copies the file aside before a programmatic rewrite. Best effort by
/// design: a failing backup must not block the edit itself.
pub(crate) fn backup_config(state: &State<'_, AppState>, file: &str) {
    let guard = state.vault.lock_or_recover();
    if let Some(vault) = guard.as_ref() {
        let _ = backup::backup_config_file(
            &vault.config_dir(),
            file,
            vault.config.backup_keep,
            chrono::Local::now(),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editable_config_allowlist_blocks_everything_else() {
        assert!(is_editable_config_file("recurring.yml"));
        assert!(is_editable_config_file("templates/journal.md"));
        assert!(!is_editable_config_file("app.yml"));
        assert!(!is_editable_config_file("../app.yml"));
        assert!(!is_editable_config_file("../../etc/passwd"));
        assert!(!is_editable_config_file("recurring.yml/../app.yml"));
        assert!(!is_editable_config_file(""));
    }
}
