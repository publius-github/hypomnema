//! What a brand-new vault's database starts with: two lists with a few
//! tasks, and one task on today, so the dashboard and the list columns
//! are not blank on the first look. The config files' starter rules
//! live next to the samples in `vault.rs`; the welcome screen's example
//! vault (`example.rs`) adds notes and a journal entry on top of this.
//!
//! Everything is created through the same functions a user's own edits
//! go through, so the starter content is ordinary content: edit it,
//! move it, delete it.

use chrono::NaiveDate;
use rusqlite::Connection;

use crate::error::Result;
use crate::tasks::{self, NewTask};

/// Seeds the starter lists and tasks. Called once, by the opener, on a
/// vault whose database was just created.
pub fn seed(conn: &Connection, today: NaiveDate) -> Result<()> {
    let home = tasks::list_create(conn, "Home", Some("#5194e6"), false)?;
    let work = tasks::list_create(conn, "Work", Some("#0a8c81"), false)?;
    let task = |title: &str, list: Option<i64>, date: Option<String>| NewTask {
        title: title.into(),
        description_md: String::new(),
        list_id: list,
        scheduled_date: date,
        time: None,
        color: None,
        parent_task_id: None,
    };
    tasks::task_create(
        conn,
        &task(
            "Try dragging this task to tomorrow",
            None,
            Some(today.format("%Y-%m-%d").to_string()),
        ),
    )?;
    tasks::task_create(
        conn,
        &task("{Errands} Buy coffee beans", Some(home.id), None),
    )?;
    tasks::task_create(
        conn,
        &task("{Errands} Return the library books", Some(home.id), None),
    )?;
    tasks::task_create(conn, &task("Fix the dripping tap", Some(home.id), None))?;
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
            ["Home", "Work"]
        );
        let count: i64 = vault
            .conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 7);

        // the starter config files parse and feed every view
        let config_dir = vault::config_dir(&root);
        let recurring = views::recurring_list(&config_dir, Local::now());
        assert_eq!(recurring.rules.len(), 3);
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
