//! Commands: the Tracker's metrics (definitions in config/metrics.yml,
//! values in the measurements table - see metrics.rs).

use tauri::State;

use crate::cmd_rules::backup_config;
use crate::error::{Error, Result};
use crate::metrics;
use crate::state::*;
use crate::views::TrendUnit;

#[tauri::command]
pub(crate) async fn metrics_overview(
    state: State<'_, AppState>,
) -> Result<metrics::MetricsOverview> {
    with_vault(&state, |vault| {
        metrics::overview(&vault.conn, &vault.config_dir())
    })
}

#[tauri::command]
pub(crate) async fn metric_series(
    state: State<'_, AppState>,
    metric: String,
    unit: String,
    count: u32,
) -> Result<metrics::MetricSeries> {
    let unit =
        TrendUnit::parse(&unit).ok_or_else(|| Error::State(format!("unknown period: {unit}")))?;
    with_vault(&state, |vault| {
        let (defs, _) = metrics::load(&vault.config_dir());
        let def = defs
            .into_iter()
            .find(|d| d.id == metric)
            .ok_or_else(|| Error::State(format!("no metric '{metric}' in metrics.yml")))?;
        metrics::series(
            &vault.conn,
            &def,
            unit,
            count,
            chrono::Local::now().date_naive(),
        )
    })
}

/// The metric's value on the day, if one is stored.
#[tauri::command]
pub(crate) async fn measurement_on(
    state: State<'_, AppState>,
    metric: String,
    date: String,
) -> Result<Option<f64>> {
    with_conn(&state, |conn| Ok(metrics::value_on(conn, &metric, &date)))
}

#[tauri::command]
pub(crate) async fn measurements_since(
    state: State<'_, AppState>,
    from: String,
) -> Result<Vec<metrics::Measurement>> {
    with_conn(&state, |conn| metrics::since(conn, &from))
}

#[tauri::command]
pub(crate) async fn measurement_set(
    state: State<'_, AppState>,
    metric: String,
    date: String,
    value: f64,
) -> Result<()> {
    with_conn(&state, |conn| metrics::set(conn, &metric, &date, value))?;
    state.request_export();
    Ok(())
}

#[tauri::command]
pub(crate) async fn measurement_delete(
    state: State<'_, AppState>,
    metric: String,
    date: String,
) -> Result<()> {
    with_conn(&state, |conn| metrics::delete(conn, &metric, &date))?;
    state.request_export();
    Ok(())
}

#[tauri::command]
pub(crate) async fn metric_add(state: State<'_, AppState>, def: metrics::MetricDef) -> Result<()> {
    backup_config(&state, metrics::FILE);
    with_vault(&state, |vault| metrics::add(&vault.config_dir(), def))
}

/// Rewrites a metric's definition, or removes it with no `def`.
#[tauri::command]
pub(crate) async fn metric_update(
    state: State<'_, AppState>,
    id: String,
    def: Option<metrics::MetricDef>,
) -> Result<()> {
    backup_config(&state, metrics::FILE);
    with_vault(&state, |vault| {
        metrics::update(&vault.config_dir(), &id, def)
    })
}
