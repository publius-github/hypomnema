//! The example vault the welcome screen offers: a few lists and tasks, a
//! recurring rule of each cadence, an upcoming event, a weekly focus, a
//! reminder, two linked notes and a journal entry - enough that every
//! section has something to show on a first look.
//!
//! Everything goes through the same functions a user's own edits do
//! (`tasks::task_create`, `config_files::append_*`, `kb::write`,
//! `journal::save_entry`), so the example is an ordinary vault: the
//! config files keep their comments, the engine generates the rules'
//! tasks on its first run, and anything here can be edited or deleted.

use std::fs;
use std::path::Path;

use chrono::{Duration, NaiveDate};
use rusqlite::Connection;

use crate::config_files::{self, BirthdayEntry, RecurringRule, ScheduledEvent};
use crate::error::{Error, Result};
use crate::reminders::DayReminder;
use crate::tasks::{self, NewTask};
use crate::{journal, kb, vault};

const WELCOME_NOTE: &str = "\
# Welcome to Hypomnema

This is an example vault. Everything in it is a plain file in the folder
you chose, and all of it can be changed or deleted.

- **Dashboard** shows the week's days on top and your lists below. Drag a
  task to another day or list; with the keyboard, focus it, press Space,
  move it with the arrow keys and press Space again.
- **Upcoming** holds the rules that create tasks on their own - see
  *Recurring* for a daily, a weekly and a monthly one.
- **Journal** keeps one Markdown entry per day.
- **Notes** is this tree. Link notes with double brackets, like
  [[Ideas]], and Ctrl+click a link to follow it.

When you are ready for a vault of your own, pick an empty folder in
Settings > Data.
";

const IDEAS_NOTE: &str = "\
# Ideas

- A calmer weekly review: Friday afternoon, twenty minutes
- Batch the errands into one trip

Back to [[Welcome]].
";

/// Refuses a folder that already holds anything: the example must never
/// be mixed into someone's real notes.
pub fn ensure_empty(root: &Path) -> Result<()> {
    if root.exists() {
        let mut entries = fs::read_dir(root)?;
        if entries.next().is_some() {
            return Err(Error::State(
                "the example vault needs an empty folder - pick or create one".into(),
            ));
        }
    } else {
        fs::create_dir_all(root)?;
    }
    Ok(())
}

/// Fills a freshly opened vault with the example content.
pub fn seed(root: &Path, conn: &Connection, today: NaiveDate) -> Result<()> {
    let day = |offset: i64| {
        (today + Duration::days(offset))
            .format("%Y-%m-%d")
            .to_string()
    };
    let config_dir = vault::config_dir(root);

    // lists and the tasks in them
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
    tasks::task_create(conn, &task("Read the Welcome note", None, Some(day(0))))?;
    tasks::task_create(
        conn,
        &NewTask {
            time: Some("11:00".into()),
            ..task("Call the bank about the card", None, Some(day(1)))
        },
    )?;
    tasks::task_create(
        conn,
        &task("Try dragging this task to tomorrow", None, Some(day(0))),
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
                             there.\n\nSee [[Ideas]] for the parked ones."
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

    // rules and the other YAML-backed views
    config_files::append_recurring(
        &config_dir,
        RecurringRule {
            schedule: "0 8 * * *".into(),
            description: "Every morning".into(),
            items: vec!["Water the plants".into()],
            threshold: None,
        },
    )?;
    config_files::append_recurring(
        &config_dir,
        RecurringRule {
            schedule: "0 9 * * MON".into(),
            description: "Weekly review".into(),
            items: vec![
                "Plan the week".into(),
                "{Home} Take out the recycling".into(),
            ],
            threshold: None,
        },
    )?;
    config_files::append_recurring(
        &config_dir,
        RecurringRule {
            schedule: "0 9 1 * *".into(),
            description: "Monthly bills".into(),
            items: vec!["{Home} Pay the rent".into()],
            threshold: None,
        },
    )?;
    config_files::append_scheduled(
        &config_dir,
        ScheduledEvent {
            date: day(10),
            title: "Dentist appointment".into(),
            time: Some("10:30".into()),
        },
    )?;
    config_files::append_birthday(
        &config_dir,
        BirthdayEntry {
            name: "Ada Lovelace".into(),
            date: "12-10".into(),
            year: Some(1815),
        },
    )?;
    config_files::append_focus_phrase(
        &config_dir,
        "Finish one thing before starting the next".into(),
    )?;
    config_files::append_day_reminder(
        &config_dir,
        DayReminder {
            day_type: "workday".into(),
            text: "Plan the first hour before opening mail".into(),
        },
    )?;

    // notes and the journal
    kb::write_from(root, "Welcome.md", WELCOME_NOTE, None, false)?;
    kb::write_from(root, "Ideas.md", IDEAS_NOTE, None, false)?;
    journal::save_entry_from(root, &day(0), "Started with the example vault.\n", None)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;
    use crate::engine;
    use crate::views::{recurring_list, upcoming_events};
    use chrono::{Local, TimeZone};

    fn temp_root(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("hypomnema-example-{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_folder_with_anything_in_it_is_refused() {
        let root = temp_root("busy");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("notes.md"), "mine").unwrap();
        assert!(ensure_empty(&root).is_err());
        assert_eq!(fs::read_to_string(root.join("notes.md")).unwrap(), "mine");
    }

    #[test]
    fn a_missing_folder_is_created() {
        let root = temp_root("missing").join("nested");
        ensure_empty(&root).unwrap();
        assert!(root.is_dir());
    }

    #[test]
    fn the_example_fills_every_section_and_the_engine_accepts_it() {
        let root = temp_root("seed");
        ensure_empty(&root).unwrap();
        let vault = vault::Vault::open(&root).unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 10, 14).unwrap();
        seed(&root, &vault.conn, today).unwrap();

        let lists = tasks::lists_all(&vault.conn).unwrap();
        assert!(lists.iter().any(|l| l.name == "Home"));
        let count: i64 = vault
            .conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 9);

        let config_dir = vault::config_dir(&root);
        assert_eq!(recurring_list(&config_dir).rules.len(), 3);
        assert!(recurring_list(&config_dir).errors.is_empty());
        let (events, errors) = upcoming_events(&vault.conn, &config_dir, today).unwrap();
        assert_eq!(events.len(), 1);
        assert!(errors.is_empty(), "{errors:?}");

        assert!(root.join("Welcome.md").is_file());
        assert!(journal::entry_path(&root, "2026-10-14").unwrap().is_file());

        let now = Local.with_ymd_and_hms(2026, 10, 14, 12, 0, 0).unwrap();
        let outcome = engine::run(&vault.conn, &config_dir, &AppConfig::default(), now).unwrap();
        assert!(outcome.errors.is_empty(), "{:?}", outcome.errors);
        assert!(outcome.generated > 0);
    }
}
