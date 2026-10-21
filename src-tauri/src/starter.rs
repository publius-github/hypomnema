//! What a brand-new vault's database starts with: four lists with a few
//! tasks, and tasks on the first days, so the dashboard and the list columns
//! are not blank on the first look. The config files' starter rules
//! live next to the samples in `vault.rs`; the welcome screen's example
//! vault (`example.rs`) adds notes and a journal entry on top of this.
//!
//! Everything is created through the same functions a user's own edits
//! go through, so the starter content is ordinary content: edit it,
//! move it, delete it.

use chrono::{Duration, NaiveDate};
use rusqlite::Connection;

use crate::error::Result;
use crate::tasks::{self, NewTask};

/// Seeds the starter lists and tasks. Called once, by the opener, on a
/// vault whose database was just created.
pub fn seed(conn: &Connection, today: NaiveDate) -> Result<()> {
    let home = tasks::list_create(conn, "Home", Some("#5194e6"), false)?;
    let work = tasks::list_create(conn, "Work", Some("#0a8c81"), false)?;
    let study = tasks::list_create(conn, "Study", Some("#8a5cd6"), false)?;
    let health = tasks::list_create(conn, "Health", Some("#d9663b"), false)?;
    let task = |title: &str, list: Option<i64>, date: Option<String>| NewTask {
        title: title.into(),
        description_md: String::new(),
        list_id: list,
        scheduled_date: date,
        time: None,
        color: None,
        parent_task_id: None,
    };
    let day = |offset: i64| {
        Some(
            (today + Duration::days(offset))
                .format("%Y-%m-%d")
                .to_string(),
        )
    };
    // tasks with a day, spread over the dashboard's first columns
    tasks::task_create(
        conn,
        &task("Try dragging this task to tomorrow", None, day(0)),
    )?;
    tasks::task_create(
        conn,
        &NewTask {
            time: Some("11:00".into()),
            ..task("Reply to the pending emails", Some(work.id), day(0))
        },
    )?;
    tasks::task_create(
        conn,
        &NewTask {
            time: Some("10:30".into()),
            ..task("Call the dentist", Some(health.id), day(1))
        },
    )?;
    tasks::task_create(conn, &task("Buy a birthday present", Some(home.id), day(1)))?;
    tasks::task_create(conn, &task("Book the train tickets", Some(home.id), day(2)))?;
    tasks::task_create(
        conn,
        &task("Submit the quarterly report", Some(work.id), day(2)),
    )?;
    tasks::task_create(
        conn,
        &task("Finish the lecture notes", Some(study.id), day(3)),
    )?;

    // tasks waiting in the lists
    for title in [
        "{Errands} Buy coffee beans",
        "{Errands} Return the library books",
        "Fix the dripping tap",
    ] {
        tasks::task_create(conn, &task(title, Some(home.id), None))?;
    }
    let outline = tasks::task_create(
        conn,
        &NewTask {
            description_md: "Who it is for, what it changes, and the three steps that get it \
                             there."
                .into(),
            ..task("Draft the project outline", Some(work.id), None)
        },
    )?;
    for step in ["Collect the open questions", "Book a review slot"] {
        tasks::task_create(
            conn,
            &NewTask {
                parent_task_id: Some(outline.id),
                ..task(step, Some(work.id), None)
            },
        )?;
    }
    tasks::task_create(conn, &task("Prepare the team demo", Some(work.id), None))?;
    for title in [
        "Pick a course to start this month",
        "Learn ten new words",
        "Summarize one article in your own words",
    ] {
        tasks::task_create(conn, &task(title, Some(study.id), None))?;
    }
    for title in [
        "Book a check-up",
        "Buy running shoes",
        "Plan a week of simple dinners",
    ] {
        tasks::task_create(conn, &task(title, Some(health.id), None))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;
    use crate::{engine, reminders, vault, views};
    use chrono::{Local, TimeZone};
    use std::fs;

    #[test]
    fn a_new_vault_has_something_in_every_section_and_the_engine_accepts_it() {
        let root = std::env::temp_dir().join("hypomnema-starter-seed");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let vault = vault::Vault::open(&root).unwrap();
        assert!(vault.fresh);
        let today = NaiveDate::from_ymd_opt(2026, 10, 14).unwrap();
        seed(&vault.conn, today).unwrap();

        let lists = tasks::lists_all(&vault.conn).unwrap();
        assert_eq!(
            lists.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(),
            ["Home", "Work", "Study", "Health"]
        );
        let count: i64 = vault
            .conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 20);

        // the starter config files parse and feed every view
        let config_dir = vault::config_dir(&root);
        let recurring = views::recurring_list(&config_dir, Local::now());
        assert_eq!(recurring.rules.len(), 9);
        assert!(recurring.errors.is_empty(), "{:?}", recurring.errors);
        let birthdays = views::birthdays_list(&config_dir, today);
        assert_eq!(birthdays.birthdays.len(), 1);
        assert!(birthdays.errors.is_empty(), "{:?}", birthdays.errors);
        let overview = reminders::overview(&vault.conn, &config_dir, today).unwrap();
        assert_eq!(overview.phrases.len(), 2);
        assert_eq!(overview.reminders.len(), 2);
        assert_eq!(overview.blocks.len(), 2);
        assert!(overview.errors.is_empty(), "{:?}", overview.errors);

        let now = Local.with_ymd_and_hms(2026, 10, 14, 12, 0, 0).unwrap();
        let outcome = engine::run(&vault.conn, &config_dir, &AppConfig::default(), now).unwrap();
        assert!(outcome.errors.is_empty(), "{:?}", outcome.errors);
        assert!(outcome.generated > 0);
        let _ = fs::remove_dir_all(&root);
    }
}
