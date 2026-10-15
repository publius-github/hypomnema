//! Commands: read-only projections (upcoming, calendar, streaks, rates, dashboard context).

use tauri::State;

use crate::error::{Error, Result};
use crate::state::*;
use crate::{reminders, views};

#[tauri::command]
pub(crate) async fn upcoming_events(state: State<'_, AppState>) -> Result<views::UpcomingResult> {
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    let (events, errors) = views::upcoming_events(
        &vault.conn,
        &vault.config_dir(),
        chrono::Local::now().date_naive(),
    )?;
    Ok(views::UpcomingResult { events, errors })
}

#[tauri::command]
pub(crate) async fn dashboard_context(
    state: State<'_, AppState>,
    dates: Vec<String>,
) -> Result<reminders::DashboardContext> {
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    reminders::dashboard_context(&vault.conn, &vault.config_dir(), &dates)
}

#[tauri::command]
pub(crate) async fn birthdays_list(state: State<'_, AppState>) -> Result<views::BirthdaysResult> {
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    Ok(views::birthdays_list(
        &vault.config_dir(),
        chrono::Local::now().date_naive(),
    ))
}

#[tauri::command]
pub(crate) async fn calendar_outlook(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> Result<Vec<views::OutlookEvent>> {
    let parse = |s: &str| {
        chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
            .map_err(|_| Error::State(format!("invalid date '{s}'")))
    };
    let (from, to) = (parse(&from)?, parse(&to)?);
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    Ok(views::calendar_outlook(
        &vault.config_dir(),
        &vault.config,
        from,
        to,
        chrono::Local::now(),
    ))
}

#[tauri::command]
pub(crate) async fn recurring_list(state: State<'_, AppState>) -> Result<views::RecurringResult> {
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    Ok(views::recurring_list(&vault.config_dir()))
}

#[tauri::command]
pub(crate) async fn daily_streaks(state: State<'_, AppState>) -> Result<Vec<views::DailyStreak>> {
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    views::daily_streaks(
        &vault.conn,
        chrono::Local::now().date_naive(),
        vault.config.streak_strip_days as usize,
    )
}

#[tauri::command]
pub(crate) async fn habit_rates(state: State<'_, AppState>) -> Result<Vec<views::HabitRate>> {
    let guard = state.vault.lock_or_recover();
    let vault = guard.as_ref().ok_or_else(|| Error::NoVault)?;
    views::habit_rates(
        &vault.conn,
        &vault.config_dir(),
        &vault.config,
        chrono::Local::now().date_naive(),
    )
}
