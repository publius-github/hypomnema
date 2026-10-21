//! The Android home-screen widgets' data.
//!
//! The widget cannot run the WebView or the core, so it draws from a
//! JSON file the core hands it after every export (`payload`), a plain
//! function over a connection, so the desktop builds and tests it; the
//! Android glue around it (the plugin call) is `android` below.

// on the desktop only the tests call the data functions: they are kept
// building there so the desktop gates cover them
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::config::AppConfig;
use crate::error::Result;
use crate::tasks;
use crate::tasks_mirror::split_category;

/// What a widget tap asked the app to open: the Day (today) or a list,
/// with the add field focused for the widget's + button.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct WidgetLaunch {
    pub day: bool,
    #[ts(type = "number | null")]
    pub list: Option<i64>,
    pub add: bool,
}

/// One task as the widget draws it: `title` is the text without its
/// `{Category}` prefix, which goes to `category` (for a generated task
/// the name of its list, as the Day screen's block headers name it)
/// with the chip colour the app would give it, and `dow` is the
/// weekday marker a rule's task carries (`[MON,SAT]` in the app).
/// `status` is the task's own: `todo`, `postponed`, `waiting` or (on a
/// checklist) `done`; a todo list's done tasks and every dropped task
/// stay out, as the app's day and list columns show them folded away.
#[derive(Serialize)]
struct WidgetTask {
    id: i64,
    title: String,
    category: Option<String>,
    category_color: Option<String>,
    dow: Option<String>,
    priority: bool,
    status: String,
}

#[derive(Serialize)]
struct WidgetList {
    id: i64,
    name: String,
    color: Option<String>,
    kind: String,
    group: Option<String>,
    tasks: Vec<WidgetTask>,
}

/// One Day section with the colour its plate wears in the app
/// (`cadenceColor`: none while `cadence_colors` is off, or for General
/// without a colour of its own - the neutral plate).
#[derive(Serialize)]
struct WidgetSection {
    label: String,
    color: Option<String>,
    tasks: Vec<WidgetTask>,
}

#[derive(Serialize)]
struct WidgetDay {
    date: String,
    sections: Vec<WidgetSection>,
}

/// The app's chrome as the widget paints it: the theme's palette
/// (`src/styles.css`, the VS Code Light+/Dark+ sets) with the
/// colors.yml overrides on top, so the widget reads like the app on
/// this device rather than like the launcher. `dow_label` is the
/// marker's colour resolved: the picked one at full strength, else the
/// muted tone at `dow_label_opacity` %.
#[derive(Serialize)]
struct WidgetTheme {
    dark: bool,
    surface: String,
    surface_alt: String,
    content: String,
    content_muted: String,
    accent: String,
    line: String,
    dow_label: String,
    dow_label_opacity: u32,
    /// The status marks: postponed wears the theme's warn tone, the
    /// others their colors.yml colour.
    postponed: String,
    waiting: String,
    done: String,
}

#[derive(Serialize)]
struct WidgetData {
    theme: WidgetTheme,
    /// `category_headers`: a block's category named once over its rows
    /// rather than as a chip on each, on the day and in the lists.
    category_headers: bool,
    day: WidgetDay,
    lists: Vec<WidgetList>,
}

fn theme(config: &AppConfig) -> WidgetTheme {
    let dark = config.theme != "light";
    let pick = |over: &str, dark_default: &str, light_default: &str| {
        if !over.is_empty() {
            over.to_string()
        } else if dark {
            dark_default.to_string()
        } else {
            light_default.to_string()
        }
    };
    let content_muted = pick(&config.content_muted_color, "#bfbfbf", "#606060");
    let (dow_label, dow_label_opacity) = if config.dow_label_color.is_empty() {
        (content_muted.clone(), config.dow_label_opacity)
    } else {
        (config.dow_label_color.clone(), 100)
    };
    WidgetTheme {
        dark,
        surface: pick(&config.surface_color, "#1e1e1e", "#ffffff"),
        surface_alt: pick(&config.surface_alt_color, "#252526", "#f3f3f3"),
        content: pick(&config.content_color, "#d4d4d4", "#333333"),
        content_muted,
        accent: pick(&config.accent_color, "#55a5ff", "#005fb8"),
        line: pick(&config.line_color, "#3c3c3c", "#e0e0e0"),
        dow_label,
        dow_label_opacity,
        postponed: if dark { "#fbbf24" } else { "#92400e" }.to_string(),
        waiting: config.waiting_color.clone(),
        done: config.done_color.clone(),
    }
}

/// `cadenceColor` from `src/lib/tasks.ts`.
fn cadence_color(config: &AppConfig, key: &str) -> Option<String> {
    if !config.cadence_colors {
        return None;
    }
    let color = match key {
        "exact" => &config.cadence_color_exact,
        "general" => &config.cadence_color_general,
        "daily" => &config.cadence_color_daily,
        "weekly" => &config.cadence_color_weekly,
        "monthly" => &config.cadence_color_monthly,
        "yearly" => &config.cadence_color_yearly,
        _ => return None,
    };
    (!color.is_empty()).then(|| color.clone())
}

/// The JSON the widgets draw from. `lists`: the user's own lists
/// (auto lists - `{Category}` prefixes, Birthdays - are the engine's
/// and stay out), in alphabetical order, with the tasks the phone's
/// list screen shows as open - top-level, unscheduled or priority or
/// manual - in that screen's order, and for a checklist its ticked
/// items after them (a todo list sweeps its done tasks, a checklist
/// keeps them until unticked). `day`: `today`'s open top-level tasks in
/// the Day screen's sections - the cadence groups in the config's
/// `cadence_group_order`, inside one grouped by category block then in
/// column order, as `groupByCadence` lays them out.
pub fn payload(conn: &Connection, today: &str, config: &AppConfig) -> Result<String> {
    let day = day_payload(conn, today, config)?;
    let groups = tasks::groups_all(conn)?;
    let mut lists: Vec<_> = tasks::lists_all(conn)?
        .into_iter()
        .filter(|l| !l.auto)
        .collect();
    lists.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.name.cmp(&b.name))
            .then(a.id.cmp(&b.id))
    });
    let mut stmt = conn.prepare(
        "SELECT id, title, priority, status FROM tasks
         WHERE list_id = ?1 AND parent_task_id IS NULL
           AND (scheduled_date IS NULL OR priority = 1 OR origin = 'manual')
           AND status IN ('todo', 'postponed', 'waiting', 'done')
         ORDER BY CASE status WHEN 'todo' THEN 0 WHEN 'postponed' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END,
           priority DESC, time IS NULL, time, sort_order, id",
    )?;
    let mut out = Vec::with_capacity(lists.len());
    for list in lists {
        let checklist = list.kind == "checklist";
        let mut tasks: Vec<WidgetTask> = stmt
            .query_map([list.id], |row| {
                let title: String = row.get(1)?;
                let (category, text) = split_category(&title);
                Ok(WidgetTask {
                    id: row.get(0)?,
                    title: text.to_string(),
                    category: category.map(str::to_string),
                    category_color: None,
                    dow: None,
                    priority: row.get::<_, i64>(2)? != 0,
                    status: row.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .filter(|t| checklist || t.status != "done")
            .collect();
        // the list is its own column: the chip colour alternates by
        // category block counted down the list (`categoryBlockIndex`)
        let mut block_index = 0usize;
        let mut last_block: Option<String> = None;
        for task in &mut tasks {
            let Some(category) = &task.category else {
                continue;
            };
            if last_block.as_ref().is_some_and(|b| b != category) {
                block_index += 1;
            }
            last_block = Some(category.clone());
            task.category_color = Some(category_color(config, block_index));
        }
        out.push(WidgetList {
            id: list.id,
            name: list.name,
            color: list.color,
            kind: list.kind,
            group: list
                .group_id
                .and_then(|id| groups.iter().find(|g| g.id == id))
                .map(|g| g.name.clone()),
            tasks,
        });
    }
    serde_json::to_string(&WidgetData {
        theme: theme(config),
        category_headers: config.category_headers,
        day,
        lists: out,
    })
    .map_err(|e| crate::error::Error::State(format!("widget payload: {e}")))
}

/// The Day screen's closed sections a widget shows (`closedSections`):
/// Postponed and Done, waiting, in this order after the cadences; Done
/// and Not done, dropped stay out of the widget.
const CLOSED_LABELS: &[(&str, &str)] = &[("postponed", "Postponed"), ("waiting", "Done, waiting")];

const CADENCE_LABELS: &[(&str, &str)] = &[
    ("exact", "Exact date"),
    ("general", "General"),
    ("daily", "Daily"),
    ("weekly", "Weekly"),
    ("monthly", "Monthly"),
    ("yearly", "Yearly"),
];

struct DayRow {
    task: WidgetTask,
    section: &'static str,
    block: String,
    time: Option<String>,
    sort_order: i64,
}

/// `categoryChipColor` from `src/lib/tasks.ts` for the modes a widget
/// can follow: one colour for every category, or the two alternating
/// by category block counted straight through the sections. The
/// `varied` palette is per list and hashed on the frontend; the widget
/// falls back to the single colour for it.
fn category_color(config: &AppConfig, block_index: usize) -> String {
    match config.category_color_mode.as_str() {
        "alternate" if block_index % 2 == 1 => config.category_color_b.clone(),
        "alternate" => config.category_color_a.clone(),
        _ => config.category_color.clone(),
    }
}

/// `cadenceKeyOf` from `src/lib/tasks.ts`: scheduled events and
/// birthdays are exact-date, so is a dated manual list task that is
/// not a priority pin, rule instances go by their cadence, the rest is
/// General.
fn section_key(
    origin: &str,
    cadence: Option<&str>,
    list_id: Option<i64>,
    priority: bool,
) -> &'static str {
    if origin == "scheduled" || origin == "birthday" {
        return "exact";
    }
    if origin == "manual" && list_id.is_some() && !priority {
        return "exact";
    }
    match cadence {
        Some("daily") => "daily",
        Some("weekly") => "weekly",
        Some("monthly") => "monthly",
        Some("yearly") => "yearly",
        _ => "general",
    }
}

fn day_payload(conn: &Connection, today: &str, config: &AppConfig) -> Result<WidgetDay> {
    let lists = tasks::lists_all(conn)?;
    let list_name = |id: Option<i64>| {
        id.and_then(|id| lists.iter().find(|l| l.id == id))
            .map(|l| l.name.clone())
    };
    let mut stmt = conn.prepare(
        "SELECT id, title, priority, origin, cadence, list_id, time, sort_order, dow_label, status
         FROM tasks
         WHERE scheduled_date = ?1 AND parent_task_id IS NULL
           AND status IN ('todo', 'postponed', 'waiting')",
    )?;
    let mut rows = stmt
        .query_map([today], |row| {
            let title: String = row.get(1)?;
            let priority = row.get::<_, i64>(2)? != 0;
            let origin: String = row.get(3)?;
            let cadence: Option<String> = row.get(4)?;
            let list_id: Option<i64> = row.get(5)?;
            let (category, text) = split_category(&title);
            // the block is what the Day screen heads the rows with: the
            // category, else the list of a generated task
            let block = category
                .map(str::to_string)
                .or_else(|| list_name(list_id))
                .unwrap_or_default();
            let dow: Option<String> = row.get(8)?;
            let status: String = row.get(9)?;
            // `splitDone`: under done_display "separate" a postponed or
            // waiting task leaves its cadence for its own section
            let separate = config.done_display == "separate" && status != "todo";
            Ok(DayRow {
                section: if separate {
                    match status.as_str() {
                        "postponed" => "postponed",
                        _ => "waiting",
                    }
                } else {
                    section_key(&origin, cadence.as_deref(), list_id, priority)
                },
                task: WidgetTask {
                    id: row.get(0)?,
                    title: text.to_string(),
                    category: (!block.is_empty()).then(|| block.clone()),
                    category_color: None,
                    dow: dow.filter(|_| config.cron_weekday_labels),
                    priority,
                    status,
                },
                block,
                time: row.get(6)?,
                sort_order: row.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.sort_by(|a, b| {
        a.block
            .cmp(&b.block)
            .then_with(|| match (&a.time, &b.time) {
                (None, None) => std::cmp::Ordering::Equal,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (Some(_), None) => std::cmp::Ordering::Less,
                (Some(x), Some(y)) => x.cmp(y),
            })
            .then(a.sort_order.cmp(&b.sort_order))
            .then(a.task.id.cmp(&b.task.id))
    });
    // the configured order, unknown names dropped, missing ones
    // appended in default position - as the config sanitizes it
    let mut order: Vec<&str> = config
        .cadence_group_order
        .iter()
        .map(String::as_str)
        .filter(|k| CADENCE_LABELS.iter().any(|(key, _)| key == k))
        .collect();
    for (key, _) in CADENCE_LABELS {
        if !order.contains(key) {
            order.push(key);
        }
    }
    order.extend(CLOSED_LABELS.iter().map(|(key, _)| *key));
    // the chip colour alternates by category block counted down the
    // whole column, across the sections; an uncategorized row takes the
    // current index without advancing it (`categoryBlockIndex`)
    let mut block_index = 0usize;
    let mut last_block: Option<&str> = None;
    let mut sections = Vec::new();
    for key in order {
        let closed = CLOSED_LABELS.iter().any(|(k, _)| *k == key);
        let mut section_rows: Vec<&DayRow> = rows.iter().filter(|r| r.section == key).collect();
        // `sortClosedAlpha`: a closed section reads by category, then
        // title; the block counter runs on through it as in the column
        if closed && config.closed_sections_sort_alpha {
            section_rows.sort_by(|a, b| {
                a.block
                    .to_lowercase()
                    .cmp(&b.block.to_lowercase())
                    .then_with(|| {
                        a.task
                            .title
                            .to_lowercase()
                            .cmp(&b.task.title.to_lowercase())
                    })
            });
        }
        let mut tasks = Vec::new();
        for r in section_rows {
            if !r.block.is_empty() {
                if last_block.is_some_and(|b| b != r.block) {
                    block_index += 1;
                }
                last_block = Some(r.block.as_str());
            }
            tasks.push(WidgetTask {
                id: r.task.id,
                title: r.task.title.clone(),
                category: r.task.category.clone(),
                category_color: r
                    .task
                    .category
                    .as_ref()
                    .map(|_| category_color(config, block_index)),
                dow: r.task.dow.clone(),
                priority: r.task.priority,
                status: r.task.status.clone(),
            });
        }
        if tasks.is_empty() {
            continue;
        }
        let label = CADENCE_LABELS
            .iter()
            .chain(CLOSED_LABELS)
            .find(|(k, _)| *k == key)
            .map(|(_, l)| l.to_string())
            .unwrap_or_default();
        let color = match key {
            "postponed" => Some(config.postponed_plate_color.clone()),
            "waiting" => Some(config.waiting_plate_color.clone()),
            _ => cadence_color(config, key),
        };
        sections.push(WidgetSection {
            label,
            color: color.filter(|c| !c.is_empty()),
            tasks,
        });
    }
    Ok(WidgetDay {
        date: today.to_string(),
        sections,
    })
}

#[cfg(target_os = "android")]
pub(crate) mod android {
    //! The glue: pushing the payload to the Kotlin side.

    use tauri::AppHandle;
    use tauri_plugin_widget::WidgetExt;

    use crate::applog;
    use crate::config::AppConfig;
    use crate::state::today_string;

    /// Hands the widgets a fresh payload. Best effort, like the exports
    /// it rides on: a widget a step behind is redrawn by the next one.
    pub(crate) fn publish(app: &AppHandle, conn: &rusqlite::Connection, config: &AppConfig) {
        let json = match super::payload(conn, &today_string(), config) {
            Ok(json) => json,
            Err(e) => {
                applog::error(format!("widget payload failed: {e}"));
                return;
            }
        };
        if let Err(e) = app.widget().publish(&json) {
            applog::warn(e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::tasks::{list_create, task_create, task_update, NewTask, TaskPatch};
    use rusqlite::Connection;
    use serde_json::Value;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        conn
    }

    fn config(order: &[&str]) -> AppConfig {
        let mut config = AppConfig::default();
        if !order.is_empty() {
            config.cadence_group_order = order.iter().map(|s| s.to_string()).collect();
        }
        config
    }

    fn task(conn: &Connection, list: i64, title: &str) -> i64 {
        task_create(
            conn,
            &NewTask {
                title: title.into(),
                list_id: Some(list),
                ..Default::default()
            },
        )
        .unwrap()
        .id
    }

    fn done(conn: &Connection, id: i64) {
        task_update(
            conn,
            id,
            &TaskPatch {
                status: Some("done".into()),
                ..Default::default()
            },
        )
        .unwrap();
    }

    #[test]
    fn a_todo_list_shows_open_tasks_only_and_a_checklist_keeps_ticked_ones_last() {
        let conn = conn();
        let todo = list_create(&conn, "Work", None, false).unwrap().id;
        let check = list_create(&conn, "Groceries", Some("#ef4444"), false)
            .unwrap()
            .id;
        conn.execute("UPDATE lists SET kind = 'checklist' WHERE id = ?1", [check])
            .unwrap();
        let a = task(&conn, todo, "{Admin} open");
        let b = task(&conn, todo, "closed");
        done(&conn, b);
        let c = task(&conn, todo, "{Ops} second block");
        let milk = task(&conn, check, "milk");
        let eggs = task(&conn, check, "eggs");
        done(&conn, milk);

        let mut config = config(&[]);
        config.category_color_mode = "alternate".into();
        let data: Value =
            serde_json::from_str(&payload(&conn, "2026-10-20", &config).unwrap()).unwrap();
        let lists = data["lists"].as_array().unwrap();
        let work = lists.iter().find(|l| l["name"] == "Work").unwrap();
        let rows = work["tasks"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["id"].as_i64().unwrap(), a);
        assert_eq!(rows[0]["title"], "open");
        assert_eq!(rows[0]["category"], "Admin");
        assert_eq!(rows[0]["category_color"], config.category_color_a);
        assert_eq!(rows[1]["id"].as_i64().unwrap(), c);
        assert_eq!(rows[1]["category_color"], config.category_color_b);
        assert_eq!(work["kind"], "todo");

        let groceries = lists.iter().find(|l| l["name"] == "Groceries").unwrap();
        let rows = groceries["tasks"].as_array().unwrap();
        assert_eq!(groceries["color"], "#ef4444");
        assert_eq!(groceries["kind"], "checklist");
        assert_eq!(rows[0]["id"].as_i64().unwrap(), eggs);
        assert_eq!(rows[0]["status"], "todo");
        assert_eq!(rows[1]["id"].as_i64().unwrap(), milk);
        assert_eq!(rows[1]["status"], "done");
    }

    #[test]
    fn lists_go_alphabetically_without_the_engines_and_a_group_is_named() {
        let conn = conn();
        let plain = list_create(&conn, "plain", None, false).unwrap().id;
        let fav = list_create(&conn, "Starred", None, false).unwrap().id;
        tasks::list_set_favorite(&conn, fav, true).unwrap();
        list_create(&conn, "Birthdays", None, true).unwrap();
        let group = tasks::group_create(&conn, "Home").unwrap().id;
        tasks::list_set_group(&conn, plain, Some(group)).unwrap();

        let data: Value =
            serde_json::from_str(&payload(&conn, "2026-10-20", &config(&[])).unwrap()).unwrap();
        let lists = data["lists"].as_array().unwrap();
        let names: Vec<&str> = lists.iter().map(|l| l["name"].as_str().unwrap()).collect();
        assert_eq!(names, vec!["plain", "Starred"]);
        assert_eq!(lists[0]["group"], "Home");
    }

    #[test]
    fn the_day_carries_todays_open_tasks_in_the_day_screens_sections() {
        let conn = conn();
        let list = list_create(&conn, "Errands", None, false).unwrap().id;
        let dated = |title: &str, list_id: Option<i64>| {
            task_create(
                &conn,
                &NewTask {
                    title: title.into(),
                    list_id,
                    scheduled_date: Some("2026-10-20".into()),
                    ..Default::default()
                },
            )
            .unwrap()
            .id
        };
        let general = dated("call back", None);
        let errand = dated("post office", Some(list));
        let closed = dated("done already", None);
        done(&conn, closed);
        let tomorrow = task_create(
            &conn,
            &NewTask {
                title: "later".into(),
                scheduled_date: Some("2026-10-21".into()),
                ..Default::default()
            },
        )
        .unwrap()
        .id;
        conn.execute(
            "UPDATE tasks SET origin = 'recurring', cadence = 'daily', dow_label = 'MON,SAT'
             WHERE id = ?1",
            [general],
        )
        .unwrap();
        let note = dated("{Home} water plants", None);

        let mut config = config(&["daily", "exact"]);
        config.category_color_mode = "alternate".into();
        let data: Value =
            serde_json::from_str(&payload(&conn, "2026-10-20", &config).unwrap()).unwrap();
        assert_eq!(data["day"]["date"], "2026-10-20");
        let sections = data["day"]["sections"].as_array().unwrap();
        let labels: Vec<&str> = sections
            .iter()
            .map(|s| s["label"].as_str().unwrap())
            .collect();
        assert_eq!(labels, vec!["Daily", "Exact date", "General"]);
        assert_eq!(sections[0]["color"], config.cadence_color_daily);
        assert!(sections[2]["color"].is_null());
        assert_eq!(data["category_headers"], true);
        let daily = &sections[0]["tasks"][0];
        assert_eq!(daily["id"].as_i64().unwrap(), general);
        assert_eq!(daily["dow"], "MON,SAT");
        assert!(daily["category"].is_null());
        let exact = &sections[1]["tasks"][0];
        assert_eq!(exact["id"].as_i64().unwrap(), errand);
        assert_eq!(exact["category"], "Errands");
        assert_eq!(exact["category_color"], config.category_color_a);
        let home = &sections[2]["tasks"][0];
        assert_eq!(home["id"].as_i64().unwrap(), note);
        assert_eq!(home["title"], "water plants");
        assert_eq!(home["category"], "Home");
        assert_eq!(home["category_color"], config.category_color_b);
        let all: Vec<i64> = sections
            .iter()
            .flat_map(|s| s["tasks"].as_array().unwrap().iter())
            .map(|t| t["id"].as_i64().unwrap())
            .collect();
        assert!(!all.contains(&closed));
        assert!(!all.contains(&tomorrow));
    }

    #[test]
    fn the_theme_is_the_apps_palette_under_the_colors_yml_overrides() {
        let conn = conn();
        let mut config = config(&[]);
        config.theme = "dark".into();
        config.accent_color = "#123456".into();
        let data: Value =
            serde_json::from_str(&payload(&conn, "2026-10-20", &config).unwrap()).unwrap();
        assert_eq!(data["theme"]["dark"], true);
        assert_eq!(data["theme"]["surface"], "#1e1e1e");
        assert_eq!(data["theme"]["accent"], "#123456");
        assert_eq!(data["theme"]["dow_label"], config.dow_label_color);
        assert_eq!(data["theme"]["dow_label_opacity"], 100);

        config.theme = "light".into();
        config.dow_label_color = String::new();
        let data: Value =
            serde_json::from_str(&payload(&conn, "2026-10-20", &config).unwrap()).unwrap();
        assert_eq!(data["theme"]["dark"], false);
        assert_eq!(data["theme"]["content"], "#333333");
        assert_eq!(data["theme"]["dow_label"], "#606060");
        assert_eq!(data["theme"]["dow_label_opacity"], config.dow_label_opacity);
    }

    fn set_status(conn: &Connection, id: i64, status: &str) {
        task_update(
            conn,
            id,
            &TaskPatch {
                status: Some(status.into()),
                ..Default::default()
            },
        )
        .unwrap();
    }

    #[test]
    fn postponed_and_waiting_tasks_show_in_both_widgets_and_dropped_ones_do_not() {
        let conn = conn();
        let list = list_create(&conn, "Work", None, false).unwrap().id;
        let open = task(&conn, list, "open");
        let later = task(&conn, list, "later");
        set_status(&conn, later, "postponed");
        let asked = task(&conn, list, "asked");
        set_status(&conn, asked, "waiting");
        let gone = task(&conn, list, "gone");
        set_status(&conn, gone, "dropped");
        let dated = |title: &str, status: &str| {
            let id = task_create(
                &conn,
                &NewTask {
                    title: title.into(),
                    scheduled_date: Some("2026-10-20".into()),
                    ..Default::default()
                },
            )
            .unwrap()
            .id;
            set_status(&conn, id, status);
            id
        };
        let today = dated("today", "todo");
        let day_later = dated("{B} day later", "postponed");
        let day_later_a = dated("{A} earlier block", "postponed");
        let day_asked = dated("day asked", "waiting");
        dated("day gone", "dropped");

        let mut config = config(&[]);
        config.done_display = "separate".into();
        let data: Value =
            serde_json::from_str(&payload(&conn, "2026-10-20", &config).unwrap()).unwrap();
        assert_eq!(data["theme"]["waiting"], config.waiting_color);
        let rows = data["lists"][0]["tasks"].as_array().unwrap();
        let got: Vec<(i64, &str)> = rows
            .iter()
            .map(|t| (t["id"].as_i64().unwrap(), t["status"].as_str().unwrap()))
            .collect();
        assert_eq!(
            got,
            vec![(open, "todo"), (later, "postponed"), (asked, "waiting")]
        );
        let sections = data["day"]["sections"].as_array().unwrap();
        let labels: Vec<&str> = sections
            .iter()
            .map(|s| s["label"].as_str().unwrap())
            .collect();
        assert_eq!(labels, vec!["General", "Postponed", "Done, waiting"]);
        assert_eq!(sections[0]["tasks"][0]["id"].as_i64().unwrap(), today);
        assert_eq!(sections[1]["color"], config.postponed_plate_color);
        assert_eq!(sections[1]["tasks"][0]["id"].as_i64().unwrap(), day_later_a);
        assert_eq!(sections[1]["tasks"][1]["id"].as_i64().unwrap(), day_later);
        assert_eq!(sections[2]["tasks"][0]["id"].as_i64().unwrap(), day_asked);
        assert_eq!(sections[2]["tasks"][0]["status"], "waiting");

        // inline: a postponed task keeps its cadence section
        config.done_display = "inline".into();
        let data: Value =
            serde_json::from_str(&payload(&conn, "2026-10-20", &config).unwrap()).unwrap();
        let sections = data["day"]["sections"].as_array().unwrap();
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0]["tasks"].as_array().unwrap().len(), 4);
    }

    #[test]
    fn weekday_markers_follow_the_setting() {
        let conn = conn();
        let id = task_create(
            &conn,
            &NewTask {
                title: "stretch".into(),
                scheduled_date: Some("2026-10-20".into()),
                ..Default::default()
            },
        )
        .unwrap()
        .id;
        conn.execute(
            "UPDATE tasks SET dow_label = 'EVERYDAY' WHERE id = ?1",
            [id],
        )
        .unwrap();
        let mut config = config(&[]);
        config.cron_weekday_labels = false;
        let data: Value =
            serde_json::from_str(&payload(&conn, "2026-10-20", &config).unwrap()).unwrap();
        assert!(data["day"]["sections"][0]["tasks"][0]["dow"].is_null());
    }
}
