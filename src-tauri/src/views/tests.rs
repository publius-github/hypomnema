use super::*;
use chrono::TimeZone;
use std::fs;

#[test]
fn weekday_label_only_for_concrete_days() {
    assert_eq!(weekday_label("0 9 * * SAT#1").as_deref(), Some("SAT#1"));
    assert_eq!(weekday_label("0 9 * * 6#1").as_deref(), Some("SAT#1"));
    assert_eq!(weekday_label("0 9 * * 1-5").as_deref(), Some("MON-FRI"));
    assert_eq!(weekday_label("0 9 * * mon,fri").as_deref(), Some("MON,FRI"));
    // both day fields free = fires every day
    assert_eq!(weekday_label("0 9 * * *").as_deref(), Some("EVERYDAY"));
    assert_eq!(weekday_label("0 9 * * ?").as_deref(), Some("EVERYDAY"));
    // day-of-month restricted: not an everyday rule, no marker
    assert_eq!(weekday_label("0 9 1 * ?"), None);
    assert_eq!(weekday_label("0 9 1 * *"), None);
    assert_eq!(weekday_label("0 9 * * */2"), None);
    // a restricted day-of-month ORs with the weekday in cron, so the
    // rule fires outside the named weekdays - no marker
    assert_eq!(weekday_label("0 9 30 * SAT#4"), None);
    assert_eq!(weekday_label("0 9 1-15 * MON"), None);
}

#[test]
fn daily_streaks_count_consecutive_done_instances() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::db::migrate(&conn).unwrap();
    let insert = |rule: &str, title: &str, date: &str, status: &str| {
        conn.execute(
            "INSERT INTO tasks (title, created_at, origin, cadence, rule_key,
                                    period_key, scheduled_date, status)
                 VALUES (?1, 'x', 'recurring', 'daily', ?2, ?3, ?3, ?4)",
            (title, rule, date, status),
        )
        .unwrap();
    };
    // MON-FRI style rule: no weekend instances, streak spans the gap
    insert("r1", "water plants", "2026-08-28", "done"); // Fri
    insert("r1", "water plants", "2026-08-27", "done");
    insert("r1", "water plants", "2026-08-26", "todo"); // breaks here
    insert("r1", "water plants", "2026-08-25", "done");
    // second rule: today open (does not break), yesterday done
    insert("r2", "journal", "2026-08-31", "todo"); // today
    insert("r2", "journal", "2026-08-30", "done");

    let today = NaiveDate::from_ymd_opt(2026, 8, 31).unwrap();
    let streaks = daily_streaks(&conn, today, 3).unwrap();
    assert_eq!(streaks.len(), 2);
    assert_eq!(streaks[0].title, "water plants");
    assert_eq!(streaks[0].streak, 2);
    assert!(!streaks[0].done_today);
    assert_eq!(streaks[1].title, "journal");
    assert_eq!(streaks[1].streak, 1);
    assert!(!streaks[1].done_today);
    // the newest instances, capped, oldest first
    let marks: Vec<_> = streaks[0]
        .recent
        .iter()
        .map(|d| (d.date.as_str(), d.status.as_str()))
        .collect();
    assert_eq!(
        marks,
        vec![
            ("2026-08-26", "todo"),
            ("2026-08-27", "done"),
            ("2026-08-28", "done")
        ]
    );
}

#[test]
fn habit_rates_count_settled_instances_against_thresholds() {
    let dir = std::env::temp_dir().join("hypomnema-views-habit-rates");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 0 * * 1\"\n    threshold: 50\n    items:\n      - \"review\"\n",
    )
    .unwrap();
    let weekly_key = recurring_rule_key(
        &crate::config_files::RecurringRule {
            schedule: "0 0 * * 1".into(),
            description: String::new(),
            items: vec![],
            threshold: None,
        },
        "review",
    );

    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::db::migrate(&conn).unwrap();
    let insert = |rule: &str, cadence: &str, date: &str, status: &str| {
        conn.execute(
            "INSERT INTO tasks (title, created_at, origin, cadence, rule_key,
                                    period_key, scheduled_date, origin_date, status)
                 VALUES ('t', 'x', 'recurring', ?1, ?2, ?3, ?3, ?3, ?4)",
            (cadence, rule, date, status),
        )
        .unwrap();
    };
    // weekly: 5 done, 3 dropped, one open overdue copy still live
    for (i, status) in [
        "done", "done", "done", "done", "done", "dropped", "dropped", "dropped",
    ]
    .iter()
    .enumerate()
    {
        insert(
            &weekly_key,
            "weekly",
            &format!("2026-07-{:02}", i + 1),
            status,
        );
    }
    insert(&weekly_key, "weekly", "2026-08-24", "todo");
    // daily: a missed past day counts, today's open one does not,
    // waiting counts as done
    insert("d", "daily", "2026-08-28", "done");
    insert("d", "daily", "2026-08-29", "todo");
    insert("d", "daily", "2026-08-30", "waiting");
    insert("d", "daily", "2026-08-31", "todo");
    // too few settled instances for a rate
    insert("few", "daily", "2026-08-30", "done");

    let today = NaiveDate::from_ymd_opt(2026, 8, 31).unwrap();
    let config = AppConfig {
        habit_rate_threshold: 80,
        habit_rate_window: 0,
        habit_rate_min_instances: 3,
        ..AppConfig::default()
    };
    let rates = habit_rates(&conn, &dir, &config, today).unwrap();
    assert_eq!(rates.len(), 2);
    let daily = rates.iter().find(|r| r.rule_key == "d").unwrap();
    assert_eq!((daily.done, daily.total, daily.rate), (2, 3, 66));
    assert_eq!(daily.threshold, 80);
    assert!(daily.alert);
    let weekly = rates.iter().find(|r| r.rule_key == weekly_key).unwrap();
    assert_eq!((weekly.done, weekly.total, weekly.rate), (5, 8, 62));
    // the rule's own threshold wins over the default
    assert_eq!(weekly.threshold, 50);
    assert!(!weekly.alert);

    // the window keeps only the newest settled instances
    let windowed = AppConfig {
        habit_rate_window: 3,
        ..config
    };
    let rates = habit_rates(&conn, &dir, &windowed, today).unwrap();
    let weekly = rates.iter().find(|r| r.rule_key == weekly_key).unwrap();
    assert_eq!((weekly.done, weekly.total), (0, 3));
}

#[test]
fn outlook_projects_beyond_horizon_within_cadence_caps() {
    let dir = std::env::temp_dir().join("hypomnema-views-outlook");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 0 * * *\"\n    items:\n      - \"{Home} water\"\n  - schedule: \"0 0 * * 1\"\n    items:\n      - \"weekly review\"\n",
        )
        .unwrap();
    fs::write(
            dir.join("scheduled.yml"),
            "events:\n  - date: 2026-09-20\n    title: \"dentist\"\n  - date: 2028-01-01\n    title: \"too far\"\n",
        )
        .unwrap();
    fs::write(
        dir.join("birthdays.yml"),
        "birthdays:\n  - name: \"Jane\"\n    date: \"10-05\"\n",
    )
    .unwrap();
    let config = AppConfig {
        grid_columns: 7,
        calendar_daily_days: 10,
        calendar_weekly_weeks: 3,
        ..AppConfig::default()
    };
    // Friday 2026-08-28; grid horizon ends 2026-09-03
    let now = Local
        .from_local_datetime(
            &"2026-08-28T12:00:00"
                .parse::<chrono::NaiveDateTime>()
                .unwrap(),
        )
        .unwrap();
    let from = NaiveDate::from_ymd_opt(2026, 8, 1).unwrap();
    let to = NaiveDate::from_ymd_opt(2026, 12, 31).unwrap();
    let events = calendar_outlook(&dir, &config, from, to, now);

    // daily: only 09-04..09-07 (after horizon, within 10 days)
    let daily: Vec<&str> = events
        .iter()
        .filter(|e| e.kind == "daily")
        .map(|e| e.date.as_str())
        .collect();
    assert_eq!(
        daily,
        vec!["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"]
    );
    assert!(events.iter().all(|e| e.title != "{Home} water"));

    // weekly Mondays within 3 weeks: 09-07, 09-14 (09-18 is the cap)
    let weekly: Vec<&str> = events
        .iter()
        .filter(|e| e.kind == "weekly")
        .map(|e| e.date.as_str())
        .collect();
    assert_eq!(weekly, vec!["2026-09-07", "2026-09-14"]);

    // one-off date within a year shows; the 2028 one does not
    assert!(events
        .iter()
        .any(|e| e.kind == "date" && e.date == "2026-09-20"));
    assert!(!events.iter().any(|e| e.title == "too far"));

    // birthday projected at its next occurrence
    assert!(events
        .iter()
        .any(|e| e.kind == "birthday" && e.date == "2026-10-05"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn upcoming_lists_pending_and_open_events_plus_dated_list_tasks() {
    let dir = std::env::temp_dir().join("hypomnema-views-upcoming");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
            dir.join("scheduled.yml"),
            "events:\n  - date: 2026-9-8\n    title: \"unpadded\"\n  - date: 2026-09-10\n    title: \"done already\"\n  - date: 2026-09-12\n    title: \"still open\"\n    time: \"14:00\"\n",
        )
        .unwrap();
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::db::migrate(&conn).unwrap();
    let key = |date: &str, title: &str| {
        scheduled_rule_key(&crate::config_files::ScheduledEvent {
            date: date.into(),
            title: title.into(),
            time: None,
        })
    };
    let materialize = |date: &str, title: &str, status: &str| {
        let rule = key(date, title);
        conn.execute(
            "INSERT INTO rule_runs (rule_key, period_key, generated_at) VALUES (?1, ?2, 'x')",
            (&rule, date),
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tasks (title, created_at, origin, rule_key, period_key,
                                    scheduled_date, status)
                 VALUES (?1, 'x', 'scheduled', ?2, ?3, ?3, ?4)",
            (title, &rule, date, status),
        )
        .unwrap();
    };
    materialize("2026-09-10", "done already", "done");
    materialize("2026-09-12", "still open", "todo");
    // dated manual list tasks show too, unless the date is a priority pin
    let list = crate::tasks::list_create(&conn, "Errands", None, false).unwrap();
    conn.execute(
        "INSERT INTO tasks (title, created_at, origin, list_id, scheduled_date, status, priority)
             VALUES ('post office', 'x', 'manual', ?1, '2026-09-09', 'todo', 0),
                    ('starred', 'x', 'manual', ?1, '2026-09-08', 'todo', 1),
                    ('yesterday', 'x', 'manual', ?1, '2026-09-07', 'todo', 0)",
        [list.id],
    )
    .unwrap();

    let today = NaiveDate::from_ymd_opt(2026, 9, 8).unwrap();
    let (events, errors) = upcoming_events(&conn, &dir, today).unwrap();
    assert!(errors.is_empty());
    let shown: Vec<(&str, &str)> = events
        .iter()
        .map(|e| (e.date.as_str(), e.title.as_str()))
        .collect();
    assert_eq!(
        shown,
        vec![
            ("2026-09-08", "unpadded"),
            ("2026-09-09", "post office"),
            ("2026-09-12", "still open"),
        ]
    );
    assert_eq!(events[1].source, "list \"Errands\"");
    assert_eq!(events[2].time.as_deref(), Some("14:00"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn birthdays_roll_to_next_year_and_report_bad_dates() {
    let dir = std::env::temp_dir().join("hypomnema-views-birthdays");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
            dir.join("birthdays.yml"),
            "birthdays:\n  - name: \"Past\"\n    date: \"01-15\"\n    year: 1990\n  - name: \"Today\"\n    date: \"09-08\"\n  - name: \"Leap\"\n    date: \"02-29\"\n  - name: \"Broken\"\n    date: \"13-40\"\n",
        )
        .unwrap();
    let today = NaiveDate::from_ymd_opt(2026, 9, 8).unwrap();
    let result = birthdays_list(&dir, today);
    let by_name = |name: &str| result.birthdays.iter().find(|b| b.name == name).unwrap();
    // a date already passed this year is next year's occurrence
    assert_eq!(by_name("Past").next_occurrence, "2027-01-15");
    assert_eq!(by_name("Past").turns, Some(37));
    // today counts as upcoming, with zero days to go
    assert_eq!(by_name("Today").next_occurrence, "2026-09-08");
    assert_eq!(by_name("Today").days_until, 0);
    assert_eq!(by_name("Today").turns, None);
    // 02-29 falls back to 02-28 in a non-leap year
    assert_eq!(by_name("Leap").next_occurrence, "2027-02-28");
    // sorted by next occurrence
    let order: Vec<&str> = result.birthdays.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(order, vec!["Today", "Past", "Leap"]);
    assert_eq!(result.errors.len(), 1);
    assert!(result.errors[0].message.contains("Broken"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn recurring_list_keeps_broken_rules_and_names_their_error() {
    let dir = std::env::temp_dir().join("hypomnema-views-recurring-list");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 9 * * 1\"\n    description: \"weekly\"\n    items: [\"review\"]\n  - schedule: \"not cron\"\n    description: \"broken\"\n    items: [\"x\"]\n",
        )
        .unwrap();
    fs::create_dir_all(dir.join("packs")).unwrap();
    fs::write(
        dir.join("packs/home.yml"),
        "tasks:\n  - schedule: \"0 8 * * *\"\n    items: [\"{Home} water\"]\n",
    )
    .unwrap();
    // a Wednesday: the weekly Monday rule fires five days on
    let now = Local.with_ymd_and_hms(2026, 10, 14, 12, 0, 0).unwrap();
    let result = recurring_list(&dir, now);
    assert_eq!(result.rules.len(), 3);
    assert_eq!(
        result.rules[0].next_occurrence.as_deref(),
        Some("2026-10-19 09:00")
    );
    assert_eq!(result.rules[1].description, "broken");
    assert_eq!(result.rules[1].next_occurrence, None);
    assert_eq!(
        result.rules[2].next_occurrence.as_deref(),
        Some("2026-10-15 08:00")
    );
    assert_eq!(result.rules[2].source, "packs/home.yml");
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].file, "recurring.yml");
    assert!(result.errors[0].message.contains("rule 2 ('broken')"));
    let _ = fs::remove_dir_all(&dir);
}
