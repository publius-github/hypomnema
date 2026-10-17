use super::*;
use crate::config_files::{append_birthday, append_recurring, append_scheduled, BirthdayEntry};
use crate::db;
use crate::views::{birthdays_list, recurring_list, upcoming_events};
use std::fs;
use std::path::PathBuf;

fn setup(name: &str) -> (Connection, PathBuf) {
    let conn = Connection::open_in_memory().unwrap();
    db::migrate(&conn).unwrap();
    let dir = std::env::temp_dir().join(format!("hypomnema-engine-{name}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    (conn, dir)
}

fn at(date: &str, time: &str) -> DateTime<Local> {
    Local
        .from_local_datetime(
            &format!("{date}T{time}")
                .parse::<chrono::NaiveDateTime>()
                .unwrap(),
        )
        .unwrap()
}

fn config(catchup: u32, columns: u32, retention: u32) -> AppConfig {
    AppConfig {
        catchup_days: catchup,
        // both grids feed the horizon (horizon_days), so the tests
        // pin them together to the width under test
        grid_columns: columns,
        days_page_columns: columns,
        retention_days: retention,
        ..AppConfig::default()
    }
}

fn count_tasks(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
        .unwrap()
}

#[test]
fn cadence_buckets_by_firing_frequency() {
    let now = at("2026-08-28", "12:00:00");
    let cfg = AppConfig::default();
    let of = |cron: &str| cadence_of(&Cron::new(cron).parse().unwrap(), now, &cfg);
    assert_eq!(of("0 0 * * *"), "daily");
    assert_eq!(of("0 9 * * 1-5"), "daily");
    assert_eq!(of("0 0 * * 1"), "weekly");
    assert_eq!(of("0 0 * * 2,5"), "weekly");
    assert_eq!(of("0 0 1 * *"), "monthly");
    assert_eq!(of("0 0 1 1,4,7,10 *"), "monthly");
    assert_eq!(of("0 0 15 6 *"), "yearly");
}

#[test]
fn generated_tasks_carry_cadence_and_backfill_updates_it() {
    let (conn, dir) = setup("cadence");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 0 * * *\"\n    items:\n      - \"water\"\n",
    )
    .unwrap();
    let cfg = config(1, 3, 0);
    let now = at("2026-08-28", "12:00:00");
    run(&conn, &dir, &cfg, now).unwrap();
    let cadence: String = conn
        .query_row("SELECT DISTINCT cadence FROM tasks", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cadence, "daily");

    // pre-cadence rows (NULL) pick up the rule's bucket on the next run
    conn.execute("UPDATE tasks SET cadence = NULL", []).unwrap();
    run(&conn, &dir, &cfg, now).unwrap();
    let backfilled: String = conn
        .query_row("SELECT DISTINCT cadence FROM tasks", [], |r| r.get(0))
        .unwrap();
    assert_eq!(backfilled, "daily");
}

#[test]
fn parse_item_extracts_list_prefix() {
    assert_eq!(
        parse_item("{05 Finance} pay bills"),
        (Some("05 Finance".into()), "pay bills".into())
    );
    assert_eq!(parse_item("no prefix"), (None, "no prefix".into()));
    assert_eq!(parse_item("{} empty"), (None, "{} empty".into()));
}

#[test]
fn dow_label_backfills_existing_instances() {
    let (conn, dir) = setup("dow-backfill");
    fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 9 * * SAT#1\"\n    description: FirstSat\n    items:\n      - \"{Home} monthly chores\"\n",
        )
        .unwrap();
    // grid wide enough to reach the first Saturday of September
    let cfg = config(7, 14, 0);
    // first pass generates instances (pretend it ran on an old
    // version: wipe the labels the way a migrated vault has them)
    run(&conn, &dir, &cfg, at("2026-08-25", "12:00:00")).unwrap();
    conn.execute("UPDATE tasks SET dow_label = NULL", [])
        .unwrap();

    // the next pass re-stamps every instance of the rule
    run(&conn, &dir, &cfg, at("2026-08-25", "13:00:00")).unwrap();
    let (total, labeled): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COUNT(dow_label) FROM tasks WHERE origin = 'recurring'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert!(total > 0, "rule generated no instances");
    assert_eq!(total, labeled, "some instances missed the backfill");
    let label: String = conn
        .query_row(
            "SELECT DISTINCT dow_label FROM tasks WHERE origin = 'recurring'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(label, "SAT#1");
}

#[test]
fn weekday_pinned_cron_sets_dow_label() {
    let (conn, dir) = setup("dow");
    fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 9 * * 6\"\n    description: Sat\n    items:\n      - \"weekly review\"\n  - schedule: \"0 6 * * *\"\n    description: Daily\n    items:\n      - \"water plants\"\n",
        )
        .unwrap();
    let cfg = config(7, 7, 0);
    run(&conn, &dir, &cfg, at("2026-08-25", "12:00:00")).unwrap();

    let sat: Option<String> = conn
        .query_row(
            "SELECT dow_label FROM tasks WHERE title = 'weekly review' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(sat.as_deref(), Some("SAT"));
    let daily: Option<String> = conn
        .query_row(
            "SELECT dow_label FROM tasks WHERE title = 'water plants' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    // both day fields free = the EVERYDAY marker (display is gated
    // by config.cron_weekday_labels on the frontend)
    assert_eq!(daily.as_deref(), Some("EVERYDAY"));
}

#[test]
fn daily_cron_generates_catchup_instances_once() {
    let (conn, dir) = setup("daily");
    fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    description: Daily\n    items:\n      - \"{Home} water plants\"\n",
        )
        .unwrap();
    let cfg = config(3, 7, 0);

    // first sighting of the rule: today + 6 grid days, no catch-up
    let outcome = run(&conn, &dir, &cfg, at("2026-08-25", "12:00:00")).unwrap();
    assert_eq!(outcome.generated, 7);
    assert!(outcome.errors.is_empty());

    // second run: nothing new (restart scenario)
    let outcome2 = run(&conn, &dir, &cfg, at("2026-08-25", "12:00:00")).unwrap();
    assert_eq!(outcome2.generated, 0);
    assert_eq!(count_tasks(&conn), 7);

    // three days later: only the new grid days generate; missed
    // dailies are NOT overdue work - they stay unchecked in their
    // own day and today has its own instance
    let outcome3 = run(&conn, &dir, &cfg, at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(outcome3.generated, 3);
    assert_eq!(outcome3.carried_over, 0);
    let overdue: i64 = conn
        .query_row("SELECT COUNT(*) FROM tasks WHERE overdue = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(overdue, 0);
    let stayed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE scheduled_date < '2026-08-28' AND status = 'todo'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stayed, 3);
}

#[test]
fn new_rule_starts_today_without_overdue() {
    let (conn, dir) = setup("new-rule");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"fresh\"\n",
    )
    .unwrap();
    // a 30-day catch-up window must not matter for a rule added today
    let outcome = run(&conn, &dir, &config(30, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(outcome.generated, 7);
    let overdue: i64 = conn
        .query_row("SELECT COUNT(*) FROM tasks WHERE overdue = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(overdue, 0);
}

#[test]
fn runaway_cron_is_skipped_with_an_error() {
    let (conn, dir) = setup("runaway");
    fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"* * * * *\"\n    description: Spam\n    items:\n      - \"noise\"\n",
        )
        .unwrap();
    let outcome = run(&conn, &dir, &config(30, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(outcome.generated, 0);
    assert_eq!(count_tasks(&conn), 0);
    assert_eq!(outcome.errors.len(), 1);
    assert!(outcome.errors[0].message.contains("fires more than"));
}

#[test]
fn old_recurring_ledger_rows_are_pruned() {
    let (conn, dir) = setup("ledger-prune");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"daily\"\n",
    )
    .unwrap();
    let cfg = config(3, 3, 0);
    run(&conn, &dir, &cfg, at("2026-08-01", "12:00:00")).unwrap();
    // a month later: rows whose period predates the catch-up window
    // are gone, recent ones stay, and nothing regenerates for the
    // pruned periods (they are outside the enumeration window anyway)
    run(&conn, &dir, &cfg, at("2026-08-28", "12:00:00")).unwrap();
    let stale: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM rule_runs WHERE substr(period_key, 1, 10) < '2026-08-25'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stale, 0);
    let recent: i64 = conn
        .query_row("SELECT COUNT(*) FROM rule_runs", [], |r| r.get(0))
        .unwrap();
    assert!(recent > 0);
}

#[test]
fn readded_rule_regenerates_periods_freed_by_removal() {
    let (conn, dir) = setup("readd");
    let rule_yaml = "tasks:\n  - schedule: \"0 6 * * *\"\n    description: Daily\n    items:\n      - \"water\"\n";
    fs::write(dir.join("recurring.yml"), rule_yaml).unwrap();
    let cfg = config(3, 3, 0);

    let first = run(&conn, &dir, &cfg, at("2026-08-25", "12:00:00")).unwrap();
    assert_eq!(first.generated, 3);

    // rule removed: the future instances and today's open one go,
    // their ledger rows stay
    fs::write(dir.join("recurring.yml"), "tasks: []\n").unwrap();
    let removed = run(&conn, &dir, &cfg, at("2026-08-25", "13:00:00")).unwrap();
    assert_eq!(removed.removed, 3);
    conn.execute("UPDATE tasks SET status = 'done'", [])
        .unwrap();

    // next day the same rule text comes back: it counts as new and
    // must fill the grid again, today's instance included
    fs::write(dir.join("recurring.yml"), rule_yaml).unwrap();
    let readded = run(&conn, &dir, &cfg, at("2026-08-26", "12:00:00")).unwrap();
    assert_eq!(readded.generated, 3);
    let today_tasks: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks
                 WHERE scheduled_date = '2026-08-26' AND status = 'todo'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(today_tasks, 1);
    let overdue: i64 = conn
        .query_row("SELECT COUNT(*) FROM tasks WHERE overdue = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(overdue, 0);
}

#[test]
fn edited_rule_does_not_duplicate_todays_task() {
    let (conn, dir) = setup("edited-rule");
    fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    description: Old\n    items:\n      - \"water\"\n",
        )
        .unwrap();
    let cfg = config(3, 7, 0);
    let now = at("2026-08-28", "12:00:00");
    run(&conn, &dir, &cfg, now).unwrap();
    assert_eq!(count_tasks(&conn), 7);

    // a cosmetic rename changes the rule key; the regenerated window
    // must replace, not duplicate, the old identity's instances
    fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    description: New\n    items:\n      - \"water\"\n",
        )
        .unwrap();
    run(&conn, &dir, &cfg, now).unwrap();
    assert_eq!(count_tasks(&conn), 7);
    let today_copies: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE scheduled_date = '2026-08-28'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(today_copies, 1);

    // a firing completed under the old identity stays done after the
    // next rename instead of reappearing as a fresh todo
    conn.execute(
        "UPDATE tasks SET status = 'done' WHERE scheduled_date = '2026-08-28'",
        [],
    )
    .unwrap();
    fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 6 * * *\"\n    description: Newer\n    items:\n      - \"water\"\n",
        )
        .unwrap();
    run(&conn, &dir, &cfg, now).unwrap();
    let today: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT status FROM tasks WHERE scheduled_date = '2026-08-28'")
            .unwrap();
        let rows = stmt.query_map([], |r| r.get(0)).unwrap();
        rows.collect::<std::result::Result<_, _>>().unwrap()
    };
    assert_eq!(today, vec!["done".to_string()]);
}

#[test]
fn momentarily_empty_or_missing_file_does_not_reconcile() {
    let (conn, dir) = setup("truncated");
    let rule_yaml = "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"water\"\n";
    fs::write(dir.join("recurring.yml"), rule_yaml).unwrap();
    let cfg = config(3, 3, 0);
    let now = at("2026-08-25", "12:00:00");
    run(&conn, &dir, &cfg, now).unwrap();
    let before = count_tasks(&conn);

    // truncate-then-write save caught mid-flight: nothing removed
    fs::write(dir.join("recurring.yml"), "").unwrap();
    let outcome = run(&conn, &dir, &cfg, now).unwrap();
    assert_eq!(outcome.removed, 0);
    assert_eq!(count_tasks(&conn), before);

    // comments-only (the fresh-vault sample) and a missing file are
    // equally transient
    fs::write(dir.join("recurring.yml"), "# rules go here\n").unwrap();
    assert_eq!(run(&conn, &dir, &cfg, now).unwrap().removed, 0);
    fs::remove_file(dir.join("recurring.yml")).unwrap();
    assert_eq!(run(&conn, &dir, &cfg, now).unwrap().removed, 0);
    assert_eq!(count_tasks(&conn), before);

    // an explicit empty list is intentional and still reconciles:
    // future instances and today's open one are removed
    fs::write(dir.join("recurring.yml"), "tasks: []\n").unwrap();
    let explicit = run(&conn, &dir, &cfg, now).unwrap();
    assert_eq!(explicit.removed, 3);
}

#[test]
fn long_catchup_gap_collapses_to_one_overdue_task() {
    let (conn, dir) = setup("gap");
    // weekly cadence: catch-up applies (dailies skip it entirely)
    fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 9 * * 1\"\n    description: Mondays\n    items:\n      - \"weekly review\"\n",
        )
        .unwrap();
    // first seen on Monday 08-10; only that Monday is in the window
    let seeded = run(&conn, &dir, &config(1, 7, 0), at("2026-08-10", "12:00:00")).unwrap();
    assert_eq!(seeded.generated, 1);

    // three idle weeks later (Friday 08-28) with a 30-day catch-up:
    // the missed Mondays (08-17, 08-24) collapse into one firing
    // (08-24), plus the upcoming grid Monday 08-31. The seeded 08-10
    // copy and the 08-24 copy both carry over, then collapse into a
    // single overdue task - one rule never shows duplicates.
    let outcome = run(&conn, &dir, &config(30, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(outcome.generated, 2);
    assert_eq!(outcome.carried_over, 2);
    assert_eq!(count_tasks(&conn), 2);

    let overdue_today: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE overdue = 1 AND scheduled_date = '2026-08-28'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(overdue_today, 1);

    let monday: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE scheduled_date = '2026-08-31'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(monday, 1);
}

#[test]
fn missed_firing_is_dropped_when_todays_firing_exists() {
    let (conn, dir) = setup("dedup-next");
    fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 9 * * 1\"\n    description: Mondays\n    items:\n      - \"weekly review\"\n",
        )
        .unwrap();
    let cfg = config(30, 7, 0);
    // seeded Monday 08-24: one instance for that day (+ grid 08-31? no,
    // horizon 08-30), so exactly one task exists and stays open
    let seeded = run(&conn, &dir, &cfg, at("2026-08-24", "12:00:00")).unwrap();
    assert_eq!(seeded.generated, 1);

    // next Monday: today's own firing arrives; the missed 08-24 copy
    // is carried in and then dropped as a duplicate next to it
    let outcome = run(&conn, &dir, &cfg, at("2026-08-31", "12:00:00")).unwrap();
    assert!(outcome.removed >= 1);
    let today_rows: Vec<(String, i64)> = {
        let mut stmt = conn
            .prepare(
                "SELECT scheduled_date, overdue FROM tasks
                     WHERE archived_at IS NULL ORDER BY scheduled_date",
            )
            .unwrap();
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        rows.collect::<std::result::Result<_, _>>().unwrap()
    };
    assert_eq!(today_rows, vec![("2026-08-31".to_string(), 0)]);
}

#[test]
fn carried_over_daily_returns_to_its_own_day() {
    let (conn, dir) = setup("daily-home");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 9 * * 1-5\"\n    items:\n      - \"standup\"\n",
    )
    .unwrap();
    let cfg = config(3, 7, 0);
    // Friday 08-28: the weekday rule generates Friday's instance
    run(&conn, &dir, &cfg, at("2026-08-28", "12:00:00")).unwrap();

    // an older app version carried the unfinished daily to Saturday
    conn.execute(
        "UPDATE tasks SET scheduled_date = '2026-08-29'
             WHERE scheduled_date = '2026-08-28'",
        [],
    )
    .unwrap();
    run(&conn, &dir, &cfg, at("2026-08-29", "12:00:00")).unwrap();
    let friday: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE scheduled_date = '2026-08-28'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(friday, 1);
    let saturday: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE scheduled_date = '2026-08-29'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(saturday, 0);
}

#[test]
fn generated_tasks_keep_the_priority_flag() {
    // priority can be set on any task, generated ones included; an
    // engine pass must not strip a star the user placed
    let (conn, dir) = setup("generated-priority");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"water\"\n",
    )
    .unwrap();
    let cfg = config(1, 3, 0);
    let now = at("2026-08-28", "12:00:00");
    run(&conn, &dir, &cfg, now).unwrap();
    conn.execute("UPDATE tasks SET priority = 1", []).unwrap();
    run(&conn, &dir, &cfg, now).unwrap();
    let starred: i64 = conn
        .query_row("SELECT COUNT(*) FROM tasks WHERE priority = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(starred, 3);
}

#[test]
fn stale_duplicate_rows_are_cleaned_up() {
    let (conn, dir) = setup("stale-dupes");
    fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 9 * * 1\"\n    description: Mondays\n    items:\n      - \"{Home} review\"\n",
        )
        .unwrap();
    let cfg = config(3, 7, 0);
    // Monday 08-24: one instance generated
    run(&conn, &dir, &cfg, at("2026-08-24", "12:00:00")).unwrap();

    // simulate leftovers from older versions: the same (rule, period)
    // row inserted twice, plus an ancient keyless copy of the task
    conn.execute(
        "INSERT INTO tasks (title, scheduled_date, origin, rule_key, period_key, created_at)
             SELECT title, scheduled_date, origin, rule_key, period_key, created_at FROM tasks",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO tasks (title, scheduled_date, origin, created_at)
             SELECT title, scheduled_date, origin, created_at FROM tasks LIMIT 1",
        [],
    )
    .unwrap();
    assert_eq!(count_tasks(&conn), 3);

    let outcome = run(&conn, &dir, &cfg, at("2026-08-24", "13:00:00")).unwrap();
    assert!(outcome.removed >= 2);
    assert_eq!(count_tasks(&conn), 1);
}

#[test]
fn two_devices_generate_the_same_instance_under_the_same_id() {
    let yaml = "events:\n  - date: \"2026-08-24\"\n    title: dentist\n";
    let ids: Vec<i64> = ["same-id-a", "same-id-b"]
        .iter()
        .map(|name| {
            let (conn, dir) = setup(name);
            fs::write(dir.join("scheduled.yml"), yaml).unwrap();
            run(&conn, &dir, &config(3, 7, 0), at("2026-08-24", "09:00:00")).unwrap();
            conn.query_row("SELECT id FROM tasks", [], |r| r.get(0))
                .unwrap()
        })
        .collect();
    assert_eq!(ids[0], ids[1]);
}

#[test]
fn a_merged_twin_keeps_the_copy_someone_checked_off() {
    let (conn, dir) = setup("checked-twin");
    fs::write(
        dir.join("scheduled.yml"),
        "events:\n  - date: \"2026-08-24\"\n    title: dentist\n",
    )
    .unwrap();
    let cfg = config(3, 7, 0);
    run(&conn, &dir, &cfg, at("2026-08-24", "09:00:00")).unwrap();
    // the other device's copy, merged in under its own id and done
    conn.execute(
        "INSERT INTO tasks (id, title, scheduled_date, origin, rule_key, period_key,
                                created_at, status, completed_at)
             SELECT 5, title, scheduled_date, origin, rule_key, period_key, created_at,
                    'done', created_at FROM tasks",
        [],
    )
    .unwrap();
    let open_twin: i64 = conn
        .query_row("SELECT id FROM tasks WHERE id != 5", [], |r| r.get(0))
        .unwrap();
    conn.execute(
        "INSERT INTO tasks (title, parent_task_id, created_at)
             VALUES ('bring the card', ?1, '2026-08-24T00:00:00Z')",
        [open_twin],
    )
    .unwrap();

    run(&conn, &dir, &cfg, at("2026-08-24", "10:00:00")).unwrap();

    let rows: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, status FROM tasks WHERE parent_task_id IS NULL")
            .unwrap();
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        rows.collect::<std::result::Result<_, _>>().unwrap()
    };
    assert_eq!(rows, vec![(5, "done".to_string())]);
    let parent: i64 = conn
        .query_row(
            "SELECT parent_task_id FROM tasks WHERE title = 'bring the card'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(parent, 5);
}

#[test]
fn priority_carry_over_overdue_follows_the_setting() {
    let seed = |conn: &Connection| {
        conn.execute(
            "INSERT INTO tasks (title, scheduled_date, priority, created_at)
                 VALUES ('starred', '2026-08-27', 1, '2026-08-27T00:00:00+00:00'),
                        ('plain', '2026-08-27', 0, '2026-08-27T00:00:00+00:00')",
            [],
        )
        .unwrap();
    };
    let rows = |conn: &Connection| -> Vec<(String, String, i64)> {
        let mut stmt = conn
            .prepare("SELECT title, scheduled_date, overdue FROM tasks ORDER BY title")
            .unwrap();
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap();
        rows.collect::<std::result::Result<_, _>>().unwrap()
    };

    // default: a starred task left unfinished is overdue like any other
    let (conn, dir) = setup("priority-carry-on");
    seed(&conn);
    run(&conn, &dir, &config(1, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(
        rows(&conn),
        vec![
            ("plain".to_string(), "2026-08-28".to_string(), 1),
            ("starred".to_string(), "2026-08-28".to_string(), 1),
        ]
    );

    // setting off: priority rides along without the mark
    let (conn, dir) = setup("priority-carry-off");
    seed(&conn);
    let cfg = AppConfig {
        priority_overdue: false,
        ..config(1, 7, 0)
    };
    run(&conn, &dir, &cfg, at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(
        rows(&conn),
        vec![
            ("plain".to_string(), "2026-08-28".to_string(), 1),
            ("starred".to_string(), "2026-08-28".to_string(), 0),
        ]
    );
}

#[test]
fn done_list_backlog_tasks_clear_on_day_rollover() {
    let (conn, dir) = setup("clear-done-lists");
    conn.execute(
        "INSERT INTO lists (name, sort_order) VALUES ('Inbox', 0)",
        [],
    )
    .unwrap();
    let list_id = conn.last_insert_rowid();
    let insert =
        |title: &str, date: Option<&str>, status: &str, done_at: Option<&str>, priority: i64| {
            conn.execute(
                "INSERT INTO tasks (title, list_id, scheduled_date, status, completed_at,
                                    priority, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, '2026-08-25T00:00:00+00:00')",
                (title, list_id, date, status, done_at, priority),
            )
            .unwrap();
        };
    // completed_at is stored in UTC, the day boundary is local: the
    // stamps are local times so the test holds in every time zone
    let yesterday = at("2026-08-27", "15:00:00")
        .with_timezone(&Utc)
        .to_rfc3339();
    let this_morning = at("2026-08-28", "10:00:00")
        .with_timezone(&Utc)
        .to_rfc3339();
    // done yesterday: clears; done today: stays; open backlog: stays
    insert("old done", None, "done", Some(&yesterday), 0);
    insert("fresh done", None, "done", Some(&this_morning), 0);
    insert("open", None, "todo", None, 0);
    // starred copy done yesterday clears too (it shows in the list)
    insert(
        "starred done",
        Some("2026-08-27"),
        "done",
        Some(&yesterday),
        1,
    );

    run(&conn, &dir, &config(1, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
    let titles: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT title FROM tasks ORDER BY title")
            .unwrap();
        let rows = stmt.query_map([], |r| r.get(0)).unwrap();
        rows.collect::<std::result::Result<_, _>>().unwrap()
    };
    assert_eq!(titles, vec!["fresh done".to_string(), "open".to_string()]);

    // with the setting off nothing is touched
    let (conn2, dir2) = setup("clear-done-lists-off");
    conn2
        .execute(
            "INSERT INTO lists (name, sort_order) VALUES ('Inbox', 0)",
            [],
        )
        .unwrap();
    conn2
        .execute(
            "INSERT INTO tasks (title, list_id, status, completed_at, created_at)
                 VALUES ('old done', 1, 'done', '2026-08-27T15:00:00+00:00',
                         '2026-08-25T00:00:00+00:00')",
            [],
        )
        .unwrap();
    let cfg = AppConfig {
        clear_done_list_tasks: false,
        ..config(1, 7, 0)
    };
    run(&conn2, &dir2, &cfg, at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(count_tasks(&conn2), 1);
}

/// A task ticked off on a future day column keeps that day: neither
/// the list sweep nor retention may take it before the day is past.
#[test]
fn a_task_done_ahead_of_time_survives_until_its_day_is_past() {
    let (conn, dir) = setup("done-ahead");
    conn.execute(
        "INSERT INTO lists (name, sort_order) VALUES ('Inbox', 0)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO tasks (title, list_id, scheduled_date, status, completed_at,
                                priority, created_at)
             VALUES ('friday', 1, '2026-08-30', 'done', '2026-08-27T15:00:00+00:00',
                     1, '2026-08-25T00:00:00+00:00')",
        [],
    )
    .unwrap();

    // two days before its date: the day column still shows it done
    run(&conn, &dir, &config(1, 7, 1), at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(count_tasks(&conn), 1);

    // the day after its date: the sweep takes it
    run(&conn, &dir, &config(1, 7, 1), at("2026-08-31", "12:00:00")).unwrap();
    assert_eq!(count_tasks(&conn), 0);
}

/// Checklist lists keep their checked items: neither the overnight
/// list sweep nor retention pruning may touch them.
#[test]
fn checklist_lists_keep_done_tasks_through_sweep_and_retention() {
    let (conn, dir) = setup("checklist-keep");
    conn.execute_batch(
        "INSERT INTO lists (id, name, sort_order, kind)
             VALUES (1, 'Groceries', 0, 'checklist'),
                    (2, 'Inbox', 1, 'todo');
             INSERT INTO tasks (id, title, list_id, status, completed_at, created_at)
             VALUES (1, 'milk', 1, 'done', '2026-07-01T00:00:00+00:00', ''),
                    (2, 'old chore', 2, 'done', '2026-07-01T00:00:00+00:00', '');",
    )
    .unwrap();

    // retention_days = 1 and the sweep both fire on this run
    run(&conn, &dir, &config(1, 7, 1), at("2026-08-28", "12:00:00")).unwrap();

    let titles: Vec<String> = {
        let mut stmt = conn.prepare("SELECT title FROM tasks ORDER BY id").unwrap();
        let rows = stmt.query_map([], |r| r.get(0)).unwrap();
        rows.collect::<rusqlite::Result<_>>().unwrap()
    };
    assert_eq!(titles, vec!["milk".to_string()]);
}

#[test]
fn birthday_title_updates_when_year_added() {
    let (conn, dir) = setup("bday-title");
    fs::write(
        dir.join("birthdays.yml"),
        "birthdays:\n  - name: \"Jane\"\n    date: \"08-29\"\n",
    )
    .unwrap();
    let cfg = config(3, 7, 0);
    let now = at("2026-08-28", "12:00:00");
    run(&conn, &dir, &cfg, now).unwrap();
    let title: String = conn
        .query_row("SELECT title FROM tasks", [], |r| r.get(0))
        .unwrap();
    assert_eq!(title, "Birthday: Jane");

    // the year added later must reach the already-generated instance
    fs::write(
        dir.join("birthdays.yml"),
        "birthdays:\n  - name: \"Jane\"\n    date: \"08-29\"\n    year: 1990\n",
    )
    .unwrap();
    run(&conn, &dir, &cfg, now).unwrap();
    let updated: String = conn
        .query_row("SELECT title FROM tasks", [], |r| r.get(0))
        .unwrap();
    assert_eq!(updated, "Birthday: Jane (turns 36)");
}

#[test]
fn deleted_instance_regenerates() {
    let (conn, dir) = setup("deleted");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"task\"\n",
    )
    .unwrap();
    let now = at("2026-08-28", "12:00:00");
    let cfg = config(1, 7, 0);

    run(&conn, &dir, &cfg, now).unwrap();
    let count = |conn: &Connection| -> i64 {
        conn.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap()
    };
    let before = count(&conn);
    assert!(before > 0);
    let ids: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT id FROM tasks").unwrap();
        let rows = stmt.query_map([], |r| r.get(0)).unwrap();
        rows.collect::<std::result::Result<_, _>>().unwrap()
    };
    for id in ids {
        crate::tasks::task_delete(&conn, id).unwrap();
    }
    assert_eq!(count(&conn), 0);

    // deleting via the card is not how a rule dies: the delete took
    // the rule_runs rows with it, so every still-current period of
    // the live rule fires again on the next run
    run(&conn, &dir, &cfg, now).unwrap();
    assert_eq!(count(&conn), before);
}

#[test]
fn orphaned_ledger_rows_regenerate_current_periods() {
    let (conn, dir) = setup("orphaned-ledger");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"{Home} water\"\n",
    )
    .unwrap();
    let cfg = config(3, 7, 0);
    run(&conn, &dir, &cfg, at("2026-08-25", "12:00:00")).unwrap();

    // older versions could hard-delete task rows while their
    // rule_runs rows survived (dedup cleanups, clear-done): the
    // period looked "generated" forever and the grid stayed empty
    conn.execute("DELETE FROM tasks", []).unwrap();
    let outcome = run(&conn, &dir, &cfg, at("2026-08-28", "12:00:00")).unwrap();

    // every day from today to the horizon is repaired; periods
    // already in the past stay gone
    assert_eq!(outcome.generated, 7);
    for day in 28..=31 {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE scheduled_date = ?1",
                [format!("2026-08-{day}")],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "missing task on 2026-08-{day}");
    }
    let past: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE scheduled_date < '2026-08-28'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(past, 0);

    // a completed copy under another identity still counts as
    // "period represented": no todo resurrects next to it
    conn.execute(
        "UPDATE tasks SET rule_key = 'old-identity', status = 'done'
             WHERE scheduled_date = '2026-08-28'",
        [],
    )
    .unwrap();
    let again = run(&conn, &dir, &cfg, at("2026-08-28", "13:00:00")).unwrap();
    assert_eq!(again.generated, 0);
}

#[test]
fn clear_done_does_not_resurrect_todays_tasks() {
    let (conn, dir) = setup("clear-done");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"daily\"\n",
    )
    .unwrap();
    let cfg = config(1, 7, 0);
    let now = at("2026-08-28", "12:00:00");
    run(&conn, &dir, &cfg, now).unwrap();
    conn.execute(
        "UPDATE tasks SET status = 'done' WHERE scheduled_date = '2026-08-28'",
        [],
    )
    .unwrap();

    assert_eq!(crate::tasks::tasks_delete_done(&conn).unwrap(), 1);
    let outcome = run(&conn, &dir, &cfg, now).unwrap();
    assert_eq!(outcome.generated, 0);
    let today_live: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks
                 WHERE scheduled_date = '2026-08-28' AND archived_at IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(today_live, 0);
}

#[test]
fn user_edits_survive_regeneration() {
    let (conn, dir) = setup("edits");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"original\"\n",
    )
    .unwrap();
    let now = at("2026-08-28", "12:00:00");
    let cfg = config(1, 7, 0);

    run(&conn, &dir, &cfg, now).unwrap();
    conn.execute("UPDATE tasks SET title = 'edited', status = 'done'", [])
        .unwrap();

    run(&conn, &dir, &cfg, now).unwrap();
    let title: String = conn
        .query_row("SELECT title FROM tasks LIMIT 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(title, "edited");
}

#[test]
fn config_edit_applies_new_rules_without_touching_existing() {
    let (conn, dir) = setup("config-edit");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"a\"\n",
    )
    .unwrap();
    let now = at("2026-08-28", "12:00:00");
    let cfg = config(1, 7, 0);
    run(&conn, &dir, &cfg, now).unwrap();

    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"a\"\n      - \"b\"\n",
    )
    .unwrap();
    let outcome = run(&conn, &dir, &cfg, now).unwrap();
    // the new item 'b' is unseen, so it starts from today: 7
    // firings (today + 6 grid days); 'a' stays deduped
    assert_eq!(outcome.generated, 7);
    assert_eq!(count_tasks(&conn), 14);
}

#[test]
fn broken_yaml_reports_line_and_keeps_tasks() {
    let (conn, dir) = setup("broken");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"a\"\n",
    )
    .unwrap();
    let now = at("2026-08-28", "12:00:00");
    let cfg = config(1, 7, 0);
    run(&conn, &dir, &cfg, now).unwrap();
    let before = count_tasks(&conn);

    fs::write(dir.join("recurring.yml"), "tasks:\n  - schedule: [\n").unwrap();
    let outcome = run(&conn, &dir, &cfg, now).unwrap();
    assert_eq!(outcome.errors.len(), 1);
    assert_eq!(outcome.errors[0].file, "recurring.yml");
    assert!(outcome.errors[0].line.is_some());
    assert_eq!(count_tasks(&conn), before);
}

#[test]
fn invalid_cron_reported_other_rules_still_run() {
    let (conn, dir) = setup("badcron");
    fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"not a cron\"\n    items:\n      - \"x\"\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"y\"\n",
        )
        .unwrap();
    let outcome = run(&conn, &dir, &config(1, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(outcome.errors.len(), 1);
    assert!(outcome.generated > 0);
}

#[test]
fn cron_ignore_time_counts_missed_firings_by_date() {
    // weekly rule (dailies skip catch-up), gap since 08-20, engine
    // runs Friday 08-28 12:00 with a 1-day catch-up: the missed
    // Thursday 08-27 00:00 firing counts with day granularity but
    // falls outside the exact [08-27 12:00] window
    let recurring = "tasks:\n  - schedule: \"0 0 * * 4\"\n    items:\n      - \"x\"\n";

    let (conn, dir) = setup("ignore-time-on");
    fs::write(dir.join("recurring.yml"), recurring).unwrap();
    run(&conn, &dir, &config(1, 7, 0), at("2026-08-20", "12:00:00")).unwrap();
    let outcome = run(&conn, &dir, &config(1, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
    // missed 08-27 plus the grid Thursday 09-03
    assert_eq!(outcome.generated, 2);

    let (conn, dir) = setup("ignore-time-off");
    fs::write(dir.join("recurring.yml"), recurring).unwrap();
    let cfg = AppConfig {
        cron_ignore_time: false,
        ..config(1, 7, 0)
    };
    run(&conn, &dir, &cfg, at("2026-08-20", "12:00:00")).unwrap();
    let outcome = run(&conn, &dir, &cfg, at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(outcome.generated, 1);
}

#[test]
fn subfolder_pack_generates_and_reconciles_independently() {
    let (conn, dir) = setup("packs");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"root task\"\n",
    )
    .unwrap();
    fs::create_dir_all(dir.join("packs")).unwrap();
    fs::write(
        dir.join("packs").join("extra.yml"),
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"pack task\"\n",
    )
    .unwrap();
    let cfg = config(1, 3, 0);
    let now = at("2026-08-28", "12:00:00");
    let outcome = run(&conn, &dir, &cfg, now).unwrap();
    assert_eq!(outcome.generated, 6);

    // removing the pack file reconciles its tasks (today's open one
    // included) away while the root rule keeps everything
    fs::remove_file(dir.join("packs").join("extra.yml")).unwrap();
    let outcome = run(&conn, &dir, &cfg, now).unwrap();
    assert_eq!(outcome.removed, 3);
    let pack_left: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE title = 'pack task'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(pack_left, 0);
    let root_left: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE title = 'root task'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(root_left, 3);
}

#[test]
fn removed_rule_takes_all_instances_history_included() {
    let (conn, dir) = setup("reconcile");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"a\"\n      - \"b\"\n",
    )
    .unwrap();
    let cfg = config(1, 7, 0);
    run(&conn, &dir, &cfg, at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(count_tasks(&conn), 14);
    // a completed instance becomes history...
    conn.execute(
        "UPDATE tasks SET status = 'done', completed_at = '2026-08-28T13:00:00Z'
             WHERE title = 'b' AND scheduled_date = '2026-08-28'",
        [],
    )
    .unwrap();

    // ...but dropping item 'b' takes everything: open instances,
    // today's copy AND the pre-today history that would otherwise
    // keep showing in the Calendar
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 6 * * *\"\n    items:\n      - \"a\"\n",
    )
    .unwrap();
    let outcome = run(&conn, &dir, &cfg, at("2026-08-29", "12:00:00")).unwrap();
    assert_eq!(outcome.removed, 7);
    let b_left: i64 = conn
        .query_row("SELECT COUNT(*) FROM tasks WHERE title = 'b'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(b_left, 0);

    // a broken file must not wipe anything
    let before = count_tasks(&conn);
    fs::write(dir.join("recurring.yml"), "tasks: [\n").unwrap();
    let outcome = run(&conn, &dir, &cfg, at("2026-08-29", "13:00:00")).unwrap();
    assert_eq!(outcome.removed, 0);
    assert_eq!(count_tasks(&conn), before);
}

#[test]
fn scheduled_event_materializes_inside_window_only() {
    let (conn, dir) = setup("scheduled");
    fs::write(
            dir.join("scheduled.yml"),
            "events:\n  - date: 2026-08-30\n    title: \"{02 Personal} dentist\"\n    time: \"10:30\"\n  - date: 2026-12-01\n    title: \"far away\"\n",
        )
        .unwrap();
    let now = at("2026-08-28", "12:00:00");
    let cfg = config(7, 7, 0);

    let outcome = run(&conn, &dir, &cfg, now).unwrap();
    assert_eq!(outcome.generated, 1);
    let (time, origin): (String, String) = conn
        .query_row(
            "SELECT time, origin FROM tasks WHERE title = 'dentist'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(time, "10:30");
    assert_eq!(origin, "scheduled");

    // the far event and the still-open materialized one both stay in
    // the Upcoming list; only completion clears an entry
    let (pending, _) =
        upcoming_events(&conn, &dir, at("2026-08-28", "12:00:00").date_naive()).unwrap();
    let dates: Vec<&str> = pending.iter().map(|e| e.date.as_str()).collect();
    assert_eq!(dates, vec!["2026-08-30", "2026-12-01"]);
    conn.execute(
        "UPDATE tasks SET status = 'done' WHERE title = 'dentist'",
        [],
    )
    .unwrap();
    let (pending, _) =
        upcoming_events(&conn, &dir, at("2026-08-28", "12:00:00").date_naive()).unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].date, "2026-12-01");

    // deleting the materialized task does not resurrect it
    conn.execute("DELETE FROM tasks", []).unwrap();
    let outcome2 = run(&conn, &dir, &cfg, now).unwrap();
    assert_eq!(outcome2.generated, 0);
}

#[test]
fn origin_date_survives_carry_over() {
    let (conn, dir) = setup("origin-date");
    fs::write(
        dir.join("scheduled.yml"),
        "events:\n  - date: 2026-08-26\n    title: \"dentist\"\n",
    )
    .unwrap();
    let outcome = run(&conn, &dir, &config(7, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(outcome.generated, 1);
    let (scheduled, origin): (String, String) = conn
        .query_row(
            "SELECT scheduled_date, origin_date FROM tasks WHERE title = 'dentist'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(scheduled, "2026-08-28");
    assert_eq!(origin, "2026-08-26");
}

#[test]
fn birthday_generates_once_per_year_with_age() {
    let (conn, dir) = setup("birthday");
    fs::write(
        dir.join("birthdays.yml"),
        "birthdays:\n  - name: \"John Smith\"\n    date: \"08-30\"\n    year: 1985\n",
    )
    .unwrap();
    let now = at("2026-08-28", "12:00:00");
    let cfg = config(7, 7, 0);

    let outcome = run(&conn, &dir, &cfg, now).unwrap();
    assert_eq!(outcome.generated, 1);
    let title: String = conn
        .query_row("SELECT title FROM tasks LIMIT 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(title, "Birthday: John Smith (turns 41)");

    let list: String = conn
        .query_row(
            "SELECT l.name FROM tasks t JOIN lists l ON l.id = t.list_id",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(list, "Birthdays");

    assert_eq!(run(&conn, &dir, &cfg, now).unwrap().generated, 0);
}

#[test]
fn scheduled_event_stores_zero_padded_date_and_time_and_follows_a_moved_time() {
    let (conn, dir) = setup("scheduled-padding");
    fs::write(
        dir.join("scheduled.yml"),
        "events:\n  - date: 2026-9-8\n    title: \"dentist\"\n    time: \"9:30\"\n",
    )
    .unwrap();
    let now = at("2026-09-07", "12:00:00");
    let cfg = config(7, 7, 0);
    assert_eq!(run(&conn, &dir, &cfg, now).unwrap().generated, 1);
    let (date, time): (String, String) = conn
        .query_row(
            "SELECT scheduled_date, time FROM tasks WHERE title = 'dentist'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    // the model compares these strings; unpadded ones fall out of every window
    assert_eq!((date.as_str(), time.as_str()), ("2026-09-08", "09:30"));

    fs::write(
        dir.join("scheduled.yml"),
        "events:\n  - date: 2026-9-8\n    title: \"dentist\"\n    time: \"15:30\"\n",
    )
    .unwrap();
    assert_eq!(run(&conn, &dir, &cfg, now).unwrap().generated, 0);
    let time: String = conn
        .query_row("SELECT time FROM tasks WHERE title = 'dentist'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(time, "15:30");
}

#[test]
fn birthday_missed_across_new_year_is_caught_up() {
    let (conn, dir) = setup("birthday-new-year");
    fs::write(
        dir.join("birthdays.yml"),
        "birthdays:\n  - name: \"Jane\"\n    date: \"12-27\"\n",
    )
    .unwrap();
    // catch-up 14 days back from January 3rd reaches into December
    let outcome = run(&conn, &dir, &config(14, 7, 0), at("2027-01-03", "12:00:00")).unwrap();
    assert_eq!(outcome.generated, 1);
    let (date, period): (String, String) = conn
        .query_row(
            "SELECT scheduled_date, period_key FROM tasks WHERE origin = 'birthday'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    // carry-over then moves it to today with the overdue mark
    assert_eq!(date, "2027-01-03");
    assert_eq!(period, "2026");
}

#[test]
fn birthday_outside_window_not_generated() {
    let (conn, dir) = setup("birthday-out");
    fs::write(
        dir.join("birthdays.yml"),
        "birthdays:\n  - name: \"Jane\"\n    date: \"01-15\"\n",
    )
    .unwrap();
    let outcome = run(&conn, &dir, &config(7, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(outcome.generated, 0);
}

#[test]
fn carry_over_moves_only_undone_parent_tasks() {
    let (conn, dir) = setup("carry");
    // deliberate: a postponed task whose new date has also passed is
    // treated like any open task - carried to today, marked overdue
    conn.execute_batch(
        "INSERT INTO tasks (id, title, scheduled_date, status, created_at, cadence, overdue)
             VALUES (1, 'old todo', '2026-08-20', 'todo', '', NULL, 0),
                    (2, 'old done', '2026-08-20', 'done', '', NULL, 0),
                    (3, 'future', '2026-09-05', 'todo', '', NULL, 0),
                    (4, 'old postponed', '2026-08-21', 'postponed', '', NULL, 0),
                    (5, 'old daily', '2026-08-25', 'todo', '', 'daily', 0),
                    (6, 'carried daily', '2026-08-28', 'todo', '', 'daily', 1);",
    )
    .unwrap();
    let outcome = run(&conn, &dir, &config(1, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(outcome.carried_over, 2);
    // a missed daily is not overdue: it stays in its own day
    let daily: (String, i64) = conn
        .query_row(
            "SELECT scheduled_date, overdue FROM tasks WHERE id = 5",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(daily, ("2026-08-25".into(), 0));
    // stale overdue marks from earlier versions are cleared
    let cleared: i64 = conn
        .query_row("SELECT overdue FROM tasks WHERE id = 6", [], |r| r.get(0))
        .unwrap();
    assert_eq!(cleared, 0);
    let postponed: (String, i64) = conn
        .query_row(
            "SELECT scheduled_date, overdue FROM tasks WHERE id = 4",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(postponed, ("2026-08-28".into(), 1));

    let (date, overdue): (String, i64) = conn
        .query_row(
            "SELECT scheduled_date, overdue FROM tasks WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(date, "2026-08-28");
    assert_eq!(overdue, 1);

    let done_date: String = conn
        .query_row("SELECT scheduled_date FROM tasks WHERE id = 2", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(done_date, "2026-08-20");
}

/// Waiting rides the carry-over like postponed (the user's part is
/// done, the wait is not over); dropped stays on its day like done,
/// and retention prunes it with the done tasks.
#[test]
fn carry_over_takes_waiting_and_leaves_dropped() {
    let (conn, dir) = setup("waiting-dropped");
    conn.execute_batch(
        "INSERT INTO tasks (id, title, scheduled_date, status, completed_at, created_at)
             VALUES (1, 'waiting', '2026-08-20', 'waiting', NULL, ''),
                    (2, 'dropped', '2026-08-20', 'dropped', '2026-08-20T10:00:00+00:00', ''),
                    (3, 'old dropped', '2026-06-01', 'dropped', '2026-06-01T10:00:00+00:00', '');",
    )
    .unwrap();
    let outcome = run(&conn, &dir, &config(1, 7, 30), at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(outcome.carried_over, 1);
    assert_eq!(outcome.pruned, 1);
    let dates: Vec<(i64, String)> = conn
        .prepare("SELECT id, scheduled_date FROM tasks ORDER BY id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<std::result::Result<_, _>>()
        .unwrap();
    assert_eq!(
        dates,
        vec![(1, "2026-08-28".to_string()), (2, "2026-08-20".to_string())]
    );
}

#[test]
fn retention_prunes_old_done_tasks() {
    let (conn, dir) = setup("prune");
    conn.execute_batch(
        "INSERT INTO tasks (id, title, status, completed_at, created_at)
             VALUES (1, 'old', 'done', '2026-07-01T00:00:00+00:00', ''),
                    (2, 'recent', 'done', '2026-08-27T00:00:00+00:00', ''),
                    (3, 'open', 'todo', NULL, '');",
    )
    .unwrap();
    let outcome = run(&conn, &dir, &config(1, 7, 30), at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(outcome.pruned, 1);
    assert_eq!(count_tasks(&conn), 2);
}

#[test]
fn retention_zero_keeps_everything() {
    let (conn, dir) = setup("prune-zero");
    conn.execute_batch(
        "INSERT INTO tasks (id, title, status, completed_at, created_at)
             VALUES (1, 'old', 'done', '2020-01-01T00:00:00+00:00', '');",
    )
    .unwrap();
    let outcome = run(&conn, &dir, &config(1, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(outcome.pruned, 0);
    assert_eq!(count_tasks(&conn), 1);
}

#[test]
fn quick_add_writes_back_and_materializes_next_run() {
    let (conn, dir) = setup("quickadd");
    append_scheduled(
        &dir,
        ScheduledEvent {
            date: "2026-08-29".into(),
            title: "{02 Personal} dentist".into(),
            time: Some("10:30".into()),
        },
    )
    .unwrap();
    append_birthday(
        &dir,
        BirthdayEntry {
            name: "Jane".into(),
            date: "08-30".into(),
            year: Some(2000),
        },
    )
    .unwrap();
    assert!(append_birthday(
        &dir,
        BirthdayEntry {
            name: "Bad".into(),
            date: "13-99".into(),
            year: None,
        },
    )
    .is_err());

    let outcome = run(&conn, &dir, &config(7, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
    assert_eq!(outcome.generated, 2);
    assert!(outcome.errors.is_empty());

    let list = birthdays_list(&dir, at("2026-08-28", "12:00:00").date_naive());
    assert_eq!(list.birthdays.len(), 1);
    assert_eq!(list.birthdays[0].days_until, 2);
    assert_eq!(list.birthdays[0].turns, Some(26));
}

#[test]
fn recurring_quick_add_validates_and_lists() {
    let (conn, dir) = setup("recurring-add");
    append_recurring(
        &dir,
        RecurringRule {
            schedule: "0 6 * * *".into(),
            description: "Daily".into(),
            items: vec!["{Home} water plants".into(), "  ".into()],
            threshold: None,
        },
    )
    .unwrap();
    assert!(append_recurring(
        &dir,
        RecurringRule {
            schedule: "not a cron".into(),
            description: String::new(),
            items: vec!["x".into()],
            threshold: None,
        },
    )
    .is_err());
    assert!(append_recurring(
        &dir,
        RecurringRule {
            schedule: "0 6 * * *".into(),
            description: String::new(),
            items: vec![],
            threshold: None,
        },
    )
    .is_err());

    let listed = recurring_list(&dir);
    assert_eq!(listed.rules.len(), 1);
    assert_eq!(listed.rules[0].items, vec!["{Home} water plants"]);
    assert!(listed.errors.is_empty());

    let outcome = run(&conn, &dir, &config(1, 7, 0), at("2026-08-28", "12:00:00")).unwrap();
    // freshly added rule: today + 6 future grid days, no catch-up
    assert_eq!(outcome.generated, 7);
}

#[test]
fn monthly_cron_period_key_is_stable() {
    let (conn, dir) = setup("monthly");
    fs::write(
            dir.join("recurring.yml"),
            "tasks:\n  - schedule: \"0 0 1 * *\"\n    description: Monthly\n    items:\n      - \"{05 Finance} pay bills\"\n",
        )
        .unwrap();
    let cfg = config(40, 7, 0);

    // first sighting on 08-05: no catch-up (08-01 predates the
    // rule) and the next firing (09-01) is beyond the grid horizon
    let first = run(&conn, &dir, &cfg, at("2026-08-05", "09:00:00")).unwrap();
    assert_eq!(first.generated, 0);
    // 09-03: the 09-01 firing was missed after the sighting and
    // materializes once; a re-run generates nothing new
    let outcome = run(&conn, &dir, &cfg, at("2026-09-03", "09:00:00")).unwrap();
    assert_eq!(outcome.generated, 1);
    let again = run(&conn, &dir, &cfg, at("2026-09-03", "09:00:00")).unwrap();
    assert_eq!(again.generated, 0);
    assert_eq!(count_tasks(&conn), 1);
}

/// Cross-device engine parity.
///
/// There is no second engine to compare against - the phone
/// cross-compiles *this* code. The risk is real all the same, and this
/// is its actual shape: two devices already
/// sharing a vault split the moment a build changes how a key is
/// derived, because `rule_runs` rows written by the old derivation
/// stop matching tasks generated by the new one and every rule
/// regenerates as a duplicate.
///
/// So these are golden values, not a round trip. A change that makes
/// them fail is not necessarily wrong, but it is a migration, and it
/// must not happen by accident.
#[test]
fn rule_keys_are_the_same_values_every_build_derives() {
    let rule = RecurringRule {
        schedule: "0 9 * * 1-5".into(),
        description: "Weekday mornings".into(),
        items: vec!["{Work} stand-up".into()],
        threshold: None,
    };
    assert_eq!(
        recurring_rule_key(&rule, "{Work} stand-up"),
        "6b58472f6f3f4d8f"
    );
    assert_eq!(
        scheduled_rule_key(&ScheduledEvent {
            date: "2026-09-08".into(),
            title: "Dentist".into(),
            time: Some("14:30".into()),
        }),
        "3291f3b01af6ed9a"
    );
    // The birthday key is derived inline at its generator rather than
    // in a named function; pin the same string it builds.
    assert_eq!(fnv1a64("birthday|Ada|12-10"), "8a290ecf92354013");
    // A time on a scheduled event must not enter its key: moving an
    // appointment an hour later would otherwise regenerate it as a
    // second task rather than updating the one that exists.
    assert_eq!(
        scheduled_rule_key(&ScheduledEvent {
            date: "2026-09-08".into(),
            title: "Dentist".into(),
            time: None,
        }),
        scheduled_rule_key(&ScheduledEvent {
            date: "2026-09-08".into(),
            title: "Dentist".into(),
            time: Some("14:30".into()),
        })
    );
}

/// Period keys are the other half of the dedup pair, and they are
/// formats rather than hashes - `state_export`'s JSONL carries them
/// between devices verbatim, and `prune` slices them by byte offset
/// (`substr(period_key, 1, 10)`), so their shape is load-bearing.
#[test]
fn period_keys_keep_the_shapes_the_ledger_and_the_pruner_expect() {
    let (conn, dir) = setup("period-key-shapes");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n  - schedule: \"0 9 * * *\"\n    description: Daily\n    items:\n      - ping\n",
    )
    .unwrap();
    fs::write(
        dir.join("scheduled.yml"),
        "events:\n  - date: 2026-09-08\n    title: Dentist\n",
    )
    .unwrap();
    fs::write(
        dir.join("birthdays.yml"),
        "birthdays:\n  - name: Ada\n    date: 09-09\n",
    )
    .unwrap();

    run(&conn, &dir, &config(1, 7, 0), at("2026-09-08", "12:00:00")).unwrap();

    let keys: Vec<(String, String)> = conn
        .prepare("SELECT origin, period_key FROM tasks WHERE period_key IS NOT NULL")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();

    for (origin, period_key) in keys {
        match origin.as_str() {
            // The 16-char minute-precision form the retention sweep
            // recognizes with `length(period_key) = 16`.
            "recurring" => assert_eq!(period_key.len(), 16, "{period_key}"),
            "scheduled" => assert_eq!(period_key.len(), 10, "{period_key}"),
            "birthday" => assert_eq!(period_key.len(), 4, "{period_key}"),
            other => panic!("unexpected origin {other}"),
        }
    }
}

/// The engine's promises, checked over months of irregular use
/// rather than one hand-picked moment: the app opened at odd hours,
/// skipped for days, restarted twice in a row, with tasks completed
/// and deleted in between. A fixed seed keeps a failure reproducible.
#[test]
fn invariants_hold_over_a_long_irregular_run() {
    let (conn, dir) = setup("invariants");
    fs::write(
        dir.join("recurring.yml"),
        "tasks:\n\
             \x20 - schedule: \"0 0 * * *\"\n    items:\n      - \"daily\"\n\
             \x20 - schedule: \"0 9 * * 1-5\"\n    items:\n      - \"workdays\"\n\
             \x20 - schedule: \"0 0 * * 1\"\n    items:\n      - \"{Home} weekly\"\n\
             \x20 - schedule: \"0 0 1 * *\"\n    items:\n      - \"monthly\"\n\
             \x20 - schedule: \"0 9 * * SAT#1\"\n    items:\n      - \"first saturday\"\n",
    )
    .unwrap();
    let cfg = config(7, 7, 0);
    let mut seed: u64 = 0x5eed_cafe;
    let mut next = move |bound: u64| {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed % bound
    };
    let snapshot = |conn: &Connection| -> Vec<(i64, String, String, Option<String>)> {
        let mut stmt = conn
            .prepare("SELECT id, title, status, scheduled_date FROM tasks ORDER BY id")
            .unwrap();
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap();
        rows.collect::<std::result::Result<_, _>>().unwrap()
    };
    let generated_ids = |conn: &Connection, status: &str| -> Vec<i64> {
        let mut stmt = conn
            .prepare("SELECT id FROM tasks WHERE rule_key IS NOT NULL AND status = ?1 ORDER BY id")
            .unwrap();
        let rows = stmt.query_map([status], |r| r.get(0)).unwrap();
        rows.collect::<std::result::Result<_, _>>().unwrap()
    };

    let mut now = at("2026-01-01", "08:00:00");
    let mut completed: Vec<i64> = Vec::new();
    let mut deleted: Vec<(String, String)> = Vec::new();
    for _ in 0..200 {
        now += Duration::hours(1 + next(60) as i64);
        run(&conn, &dir, &cfg, now).unwrap();

        // a restart at the same moment changes nothing
        let before = snapshot(&conn);
        run(&conn, &dir, &cfg, now).unwrap();
        assert_eq!(before, snapshot(&conn), "second run at {now} changed tasks");

        // one task per (rule, period), ever
        let duplicates: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM (SELECT 1 FROM tasks WHERE rule_key IS NOT NULL
                     GROUP BY rule_key, period_key HAVING COUNT(*) > 1)",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(duplicates, 0, "duplicate instances at {now}");

        // the user's statuses are never overwritten
        for id in &completed {
            let status: String = conn
                .query_row("SELECT status FROM tasks WHERE id = ?1", [id], |r| r.get(0))
                .unwrap();
            assert_eq!(status, "done", "task {id} lost its status at {now}");
        }

        // a deleted instance a later firing has superseded does not
        // come back (the rule's current one regenerates by design:
        // task_delete drops its ledger row)
        for (rule, period) in &deleted {
            let back: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM tasks WHERE rule_key = ?1 AND period_key = ?2",
                    [rule, period],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(back, 0, "deleted {rule} {period} regenerated at {now}");
        }

        let open = generated_ids(&conn, "todo");
        if !open.is_empty() && next(3) == 0 {
            let id = open[next(open.len() as u64) as usize];
            conn.execute("UPDATE tasks SET status = 'done' WHERE id = ?1", [id])
                .unwrap();
            completed.push(id);
        }
        let open = generated_ids(&conn, "todo");
        if !open.is_empty() && next(4) == 0 {
            let id = open[next(open.len() as u64) as usize];
            let key: (String, String) = conn
                .query_row(
                    "SELECT rule_key, period_key FROM tasks WHERE id = ?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            // superseded: a later firing of the same rule is already due
            let superseded: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM rule_runs WHERE rule_key = ?1
                         AND period_key > ?2 AND substr(period_key, 1, 10) <= ?3)",
                    [&key.0, &key.1, &now.format("%Y-%m-%d").to_string()],
                    |r| r.get(0),
                )
                .unwrap();
            tasks::task_delete(&conn, id).unwrap();
            if superseded {
                deleted.push(key);
            }
        }
    }
    assert!(!completed.is_empty() && !deleted.is_empty());
    assert!(
        snapshot(&conn).len() > 100,
        "too little was generated to prove much"
    );
}

/// A zone whose clocks skip midnight on 2026-09-06 (00:00 -> 01:00, the
/// Santiago kind of change) and repeat its first hour on 2026-04-05.
#[derive(Clone)]
struct MidnightDst;

impl TimeZone for MidnightDst {
    type Offset = chrono::FixedOffset;

    fn from_offset(_: &chrono::FixedOffset) -> Self {
        MidnightDst
    }

    fn offset_from_local_date(&self, _: &NaiveDate) -> chrono::LocalResult<chrono::FixedOffset> {
        chrono::LocalResult::None
    }

    fn offset_from_local_datetime(
        &self,
        local: &chrono::NaiveDateTime,
    ) -> chrono::LocalResult<chrono::FixedOffset> {
        let summer = chrono::FixedOffset::west_opt(3 * 3600).unwrap();
        let winter = chrono::FixedOffset::west_opt(4 * 3600).unwrap();
        let first_hour = local.time() < chrono::NaiveTime::from_hms_opt(1, 0, 0).unwrap();
        match local.date().to_string().as_str() {
            "2026-09-06" if first_hour => chrono::LocalResult::None,
            "2026-04-05" if first_hour => chrono::LocalResult::Ambiguous(summer, winter),
            _ => chrono::LocalResult::Single(summer),
        }
    }

    fn offset_from_utc_date(&self, _: &NaiveDate) -> chrono::FixedOffset {
        chrono::FixedOffset::west_opt(3 * 3600).unwrap()
    }

    fn offset_from_utc_datetime(&self, _: &chrono::NaiveDateTime) -> chrono::FixedOffset {
        chrono::FixedOffset::west_opt(3 * 3600).unwrap()
    }
}

#[test]
fn a_day_whose_midnight_is_skipped_starts_right_after_the_gap() {
    let day = NaiveDate::from_ymd_opt(2026, 9, 6).unwrap();
    let start = day_start(&MidnightDst, day).unwrap();
    assert_eq!(start.naive_local().to_string(), "2026-09-06 01:00:00");
}

#[test]
fn a_repeated_midnight_starts_the_day_at_its_earlier_instance() {
    let day = NaiveDate::from_ymd_opt(2026, 4, 5).unwrap();
    let start = day_start(&MidnightDst, day).unwrap();
    assert_eq!(start.naive_local().to_string(), "2026-04-05 00:00:00");
    assert_eq!(start.offset().local_minus_utc(), -3 * 3600);
}

#[test]
fn an_ordinary_day_starts_at_midnight() {
    let day = NaiveDate::from_ymd_opt(2026, 9, 7).unwrap();
    let start = day_start(&MidnightDst, day).unwrap();
    assert_eq!(start.naive_local().to_string(), "2026-09-07 00:00:00");
}
