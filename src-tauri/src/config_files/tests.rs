use super::*;
use crate::views::recurring_list;
use std::path::PathBuf;

fn dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("hypomnema-config-{name}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn schedule_block_times_are_zero_padded_on_write() {
    let dir = dir("block-padding");
    append_schedule_block(
        &dir,
        ScheduleBlock {
            from: "9:00".into(),
            to: "12:5".into(),
            label: "Deep work".into(),
        },
    )
    .unwrap();
    let mut errors = Vec::new();
    let file =
        load_yaml::<crate::reminders::DayScheduleFile>(&dir, "day-schedule.yml", &mut errors)
            .unwrap();
    assert_eq!(file.blocks[0].from, "09:00");
    assert_eq!(file.blocks[0].to, "12:05");
    assert!(append_schedule_block(
        &dir,
        ScheduleBlock {
            from: "25:00".into(),
            to: "26:00".into(),
            label: "Nope".into(),
        },
    )
    .is_err());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn edit_and_delete_config_entries_round_trip() {
    let dir = dir("edit-entries");
    let event = ScheduledEvent {
        date: "2026-09-10".into(),
        title: "dentist".into(),
        time: None,
    };
    append_scheduled(&dir, event.clone()).unwrap();
    let updated = ScheduledEvent {
        date: "2026-09-11".into(),
        title: "dentist moved".into(),
        time: Some("10:00".into()),
    };
    edit_scheduled(&dir, event.clone(), Some(updated.clone())).unwrap();
    assert!(edit_scheduled(&dir, event, None).is_err());
    edit_scheduled(&dir, updated, None).unwrap();
    let mut errors = Vec::new();
    let file = load_yaml::<ScheduledFile>(&dir, "scheduled.yml", &mut errors).unwrap();
    assert!(file.events.is_empty());

    let entry = BirthdayEntry {
        name: "Jane".into(),
        date: "08-30".into(),
        year: None,
    };
    append_birthday(&dir, entry.clone()).unwrap();
    assert!(edit_birthday(
        &dir,
        entry.clone(),
        Some(BirthdayEntry {
            name: "Jane".into(),
            date: "99-99".into(),
            year: None,
        }),
    )
    .is_err());
    edit_birthday(&dir, entry, None).unwrap();
    let file = load_yaml::<BirthdaysFile>(&dir, "birthdays.yml", &mut errors).unwrap();
    assert!(file.birthdays.is_empty());

    append_recurring(
        &dir,
        RecurringRule {
            schedule: "0 0 * * *".into(),
            description: String::new(),
            items: vec!["x".into()],
            threshold: None,
        },
    )
    .unwrap();
    assert!(edit_recurring(
        &dir,
        0,
        Some(RecurringRule {
            schedule: "bad".into(),
            description: String::new(),
            items: vec!["x".into()],
            threshold: None,
        }),
    )
    .is_err());
    edit_recurring(
        &dir,
        0,
        Some(RecurringRule {
            schedule: "0 0 * * 1".into(),
            description: "Mondays".into(),
            items: vec!["y".into()],
            threshold: None,
        }),
    )
    .unwrap();
    assert!(edit_recurring(&dir, 5, None).is_err());
    let listed = recurring_list(&dir);
    assert_eq!(listed.rules.len(), 1);
    assert_eq!(listed.rules[0].schedule, "0 0 * * 1");
    edit_recurring(&dir, 0, None).unwrap();
    assert!(recurring_list(&dir).rules.is_empty());
}

#[test]
fn splice_preserves_comments_and_blank_lines() {
    let dir = dir("splice");
    let original = "# my rules\n\ntasks:\n  # morning block\n  - schedule: \"0 6 * * *\"\n    description: Morning\n    items:\n      - \"water\"\n\n  - schedule: \"0 0 * * 1\"\n    description: Weekly\n    items:\n      - \"review\"\n";
    fs::write(dir.join("recurring.yml"), original).unwrap();

    append_recurring(
        &dir,
        RecurringRule {
            schedule: "0 0 1 * *".into(),
            description: "Monthly".into(),
            items: vec!["bills".into()],
            threshold: None,
        },
    )
    .unwrap();
    let after = fs::read_to_string(dir.join("recurring.yml")).unwrap();
    assert!(after.starts_with("# my rules\n\ntasks:\n  # morning block\n"));
    assert!(after.contains("Monthly"));

    // editing the middle rule keeps the header comment and the rest
    edit_recurring(
        &dir,
        1,
        Some(RecurringRule {
            schedule: "0 0 * * 2".into(),
            description: "Tuesdays".into(),
            items: vec!["review".into()],
            threshold: None,
        }),
    )
    .unwrap();
    let after = fs::read_to_string(dir.join("recurring.yml")).unwrap();
    assert!(after.contains("# my rules"));
    assert!(after.contains("# morning block"));
    assert!(after.contains("Tuesdays"));
    assert!(!after.contains("Weekly"));

    edit_recurring(&dir, 2, None).unwrap();
    let after = fs::read_to_string(dir.join("recurring.yml")).unwrap();
    assert!(!after.contains("Monthly"));
    assert!(after.contains("# morning block"));
    assert_eq!(recurring_list(&dir).rules.len(), 2);
}

#[test]
fn subfolder_yaml_merges_by_top_level_key() {
    let dir = dir("extras");
    fs::write(dir.join("recurring.yml"), "tasks: []\n").unwrap();
    fs::create_dir_all(dir.join("packs")).unwrap();
    // one pack file may feed several sections at once
    fs::write(
            dir.join("packs").join("work.yml"),
            "tasks:\n  - schedule: \"0 9 * * 1-5\"\n    description: Standup\n    items:\n      - \"standup\"\nevents:\n  - date: 2026-09-10\n    title: \"review\"\n",
        )
        .unwrap();
    fs::write(dir.join("packs").join("notes.txt"), "ignored").unwrap();

    let mut errors = Vec::new();
    let tasks = load_extras::<RecurringFile>(&dir, "tasks", &mut errors);
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].0, "packs/work.yml");
    assert_eq!(tasks[0].1.tasks[0].description, "Standup");
    let events = load_extras::<ScheduledFile>(&dir, "events", &mut errors);
    assert_eq!(events.len(), 1);
    let bdays = load_extras::<BirthdaysFile>(&dir, "birthdays", &mut errors);
    assert!(bdays.is_empty());
    assert!(errors.is_empty());

    let listed = recurring_list(&dir);
    assert_eq!(listed.rules.len(), 1);
    assert_eq!(listed.rules[0].source, "packs/work.yml");
}

#[test]
fn validate_config_content_catches_schema_cron_and_date_errors() {
    assert!(validate_config_content(
        "recurring.yml",
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items: [\"a\"]\n"
    )
    .is_empty());
    assert_eq!(
        validate_config_content(
            "recurring.yml",
            "tasks:\n  - schedule: \"nope\"\n    items: [\"a\"]\n"
        )
        .len(),
        1
    );
    let broken = validate_config_content("recurring.yml", "tasks: [\n");
    assert_eq!(broken.len(), 1);
    assert!(broken[0].line.is_some());
    assert_eq!(
        validate_config_content(
            "scheduled.yml",
            "events:\n  - date: 2026-15-01\n    title: x\n"
        )
        .len(),
        1
    );
    assert_eq!(
        validate_config_content(
            "birthdays.yml",
            "birthdays:\n  - name: x\n    date: \"31-12\"\n"
        )
        .len(),
        1
    );
    // impossible calendar days fail; 02-29 stays valid (leap years)
    assert_eq!(parse_mmdd("02-30"), None);
    assert_eq!(parse_mmdd("04-31"), None);
    assert_eq!(parse_mmdd("02-29"), Some((2, 29)));
    assert!(validate_config_content("day-schedule.yml", "blocks: []\n").is_empty());
}
