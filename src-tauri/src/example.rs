//! The example vault the welcome screen offers: the starter content
//! every new vault gets (`starter.rs` and the starter rules in
//! `vault.rs`: two lists with tasks, a recurring rule of each cadence,
//! a birthday, a weekly focus, reminders and a schedule) plus what a
//! vault of one's own should not be given - two linked notes, a journal
//! entry and a couple of tasks that point at them - so every section has
//! something to show on a first look.
//!
//! Everything goes through the same functions a user's own edits do
//! (`tasks::task_create`, `config_files::append_*`, `kb::write`,
//! `journal::save_entry`), so the example is an ordinary vault: the
//! config files keep their comments, the engine generates the rules'
//! tasks on its first run, and anything here can be edited or deleted.

use std::fs;
use std::path::Path;

use chrono::{Duration, NaiveDate};
use rusqlite::{Connection, OptionalExtension};

use crate::config_files::{self, ScheduledEvent};
use crate::error::{Error, Result};
use crate::tasks::{self, NewTask, TaskPatch};
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

/// Adds the example content on top of the starter content the opener
/// already seeded into this fresh vault.
pub fn seed(root: &Path, conn: &Connection, today: NaiveDate) -> Result<()> {
    let day = |offset: i64| {
        (today + Duration::days(offset))
            .format("%Y-%m-%d")
            .to_string()
    };
    let config_dir = vault::config_dir(root);

    let task = |title: &str, date: Option<String>| NewTask {
        title: title.into(),
        description_md: String::new(),
        list_id: None,
        scheduled_date: date,
        time: None,
        color: None,
        parent_task_id: None,
    };
    tasks::task_create(conn, &task("Read the Welcome note", Some(day(0))))?;
    tasks::task_create(
        conn,
        &NewTask {
            time: Some("11:00".into()),
            ..task("Call the bank about the card", Some(day(1)))
        },
    )?;
    // the starter's outline task gets a pointer at the notes
    let outline: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, description_md FROM tasks
             WHERE title = 'Draft the project outline' AND parent_task_id IS NULL",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((id, description)) = outline {
        tasks::task_update(
            conn,
            id,
            &TaskPatch {
                description_md: Some(format!(
                    "{description}\n\nSee [[Ideas]] for the parked ones."
                )),
                ..TaskPatch::default()
            },
        )?;
    }

    config_files::append_scheduled(
        &config_dir,
        ScheduledEvent {
            date: day(10),
            title: "Dentist appointment".into(),
            time: Some("10:30".into()),
        },
    )?;

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
        // what the opener does for every fresh vault, then the example
        crate::starter::seed(&vault.conn, today).unwrap();
        seed(&root, &vault.conn, today).unwrap();

        let lists = tasks::lists_all(&vault.conn).unwrap();
        assert!(lists.iter().any(|l| l.name == "Home"));
        let outline: String = vault
            .conn
            .query_row(
                "SELECT description_md FROM tasks WHERE title = 'Draft the project outline'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(outline.contains("[[Ideas]]"));
        let count: i64 = vault
            .conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 22);

        let config_dir = vault::config_dir(&root);
        assert_eq!(
            recurring_list(&config_dir, chrono::Local::now())
                .rules
                .len(),
            9
        );
        assert!(recurring_list(&config_dir, chrono::Local::now())
            .errors
            .is_empty());
        let (events, errors) = upcoming_events(&vault.conn, &config_dir, today).unwrap();
        // the example's own event plus the starter's dated list tasks
        assert_eq!(events.len(), 7);
        assert!(events.iter().any(|e| e.source == "scheduled.yml"));
        assert!(errors.is_empty(), "{errors:?}");

        assert!(root.join("Welcome.md").is_file());
        assert!(journal::entry_path(&root, "2026-10-14").unwrap().is_file());

        let now = Local.with_ymd_and_hms(2026, 10, 14, 12, 0, 0).unwrap();
        let outcome = engine::run(&vault.conn, &config_dir, &AppConfig::default(), now).unwrap();
        assert!(outcome.errors.is_empty(), "{:?}", outcome.errors);
        assert!(outcome.generated > 0);
    }
}
