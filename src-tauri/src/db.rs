use std::path::Path;

use rusqlite::Connection;

use crate::config::AppConfig;
use crate::error::{Error, Result};

const MIGRATIONS: &[&str] = &[
    // 001: settings mirror of config/app.yml
    "CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );",
    // 002: lists and task instances
    "CREATE TABLE lists (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        description_md TEXT NOT NULL DEFAULT '',
        list_id INTEGER REFERENCES lists(id) ON DELETE SET NULL,
        scheduled_date TEXT,
        time TEXT,
        status TEXT NOT NULL DEFAULT 'todo'
            CHECK (status IN ('todo', 'done', 'postponed')),
        color TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        overdue INTEGER NOT NULL DEFAULT 0,
        origin TEXT NOT NULL DEFAULT 'manual',
        rule_key TEXT,
        period_key TEXT,
        archived_at TEXT
    );
    CREATE INDEX idx_tasks_scheduled_date ON tasks(scheduled_date);
    CREATE INDEX idx_tasks_list_id ON tasks(list_id);
    CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);",
    // 003: dedup ledger shared by all generators (req. 10). A row here
    // means the (rule, period) instance was generated once, ever -
    // deleting the task does not resurrect it.
    "CREATE TABLE rule_runs (
        rule_key TEXT NOT NULL,
        period_key TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        PRIMARY KEY (rule_key, period_key)
    );",
    // 004: weekly focus rotation pointer (req. 12): which phrase index
    // is assigned to which ISO week
    "CREATE TABLE weekly_focus_state (
        iso_year INTEGER NOT NULL,
        iso_week INTEGER NOT NULL,
        phrase_index INTEGER NOT NULL,
        PRIMARY KEY (iso_year, iso_week)
    );",
    // 005: lists auto-created by the engine ({List} prefixes, Birthdays)
    // are hidden from the dashboard list zone unless they hold
    // unscheduled tasks
    "ALTER TABLE lists ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;",
    // 006: when a recurring rule was first seen by the engine. Catch-up
    // (missed firings -> overdue) applies only to rules that existed
    // before; a freshly added rule starts from today. Seeded from the
    // rule_runs ledger so pre-existing rules keep catching up.
    "CREATE TABLE rule_seen (
        rule_key TEXT PRIMARY KEY,
        first_seen TEXT NOT NULL
    );
    INSERT INTO rule_seen (rule_key, first_seen)
        SELECT rule_key, MIN(generated_at) FROM rule_runs GROUP BY rule_key;",
    // 007: reconcile and the first-seen ledger purge look tasks up by
    // (rule_key, period_key); without an index they scan the table
    "CREATE INDEX idx_tasks_rule_period ON tasks(rule_key, period_key);",
    // 008: how often a generated task's rule fires (daily/weekly/
    // monthly/yearly), so day columns can group tasks by cadence.
    // Backfilled by the engine from the current config on every run.
    "ALTER TABLE tasks ADD COLUMN cadence TEXT;",
    // 009: the date a generated task was originally scheduled for.
    // Carry-over rewrites scheduled_date, and for an exact-date task
    // the original date is the information the user planned around.
    "ALTER TABLE tasks ADD COLUMN origin_date TEXT;",
    // 010: user-set priority flag; priority tasks float to the top of
    // their list column in a dedicated group.
    "ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;",
    // 011: one-time backfills that previously ran inside every engine
    // pass: cadence for birthdays generated before migration 008, and
    // origin_date for tasks generated before migration 009 (scheduled
    // tasks keep their date in period_key; anything not yet carried
    // over still sits on its original date).
    "UPDATE tasks SET cadence = 'yearly' WHERE origin = 'birthday' AND cadence IS NULL;
    UPDATE tasks SET origin_date = period_key
        WHERE origin = 'scheduled' AND origin_date IS NULL AND length(period_key) = 10;
    UPDATE tasks SET origin_date = scheduled_date
        WHERE origin != 'manual' AND origin_date IS NULL
          AND scheduled_date IS NOT NULL AND overdue = 0;",
    // 012: display label for recurring rules pinned to concrete
    // weekdays ("SAT#1", "MON-FRI"); the engine keeps it in sync with
    // the rule's cron on every pass, so no backfill is needed here.
    "ALTER TABLE tasks ADD COLUMN dow_label TEXT;",
    // 013: favorite lists sort ahead of the rest in the dashboard
    // list zone.
    "ALTER TABLE lists ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;",
];

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    // A second handle on the DB (backup tooling, another instance)
    // should wait out a short lock instead of failing with SQLITE_BUSY.
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    // A vault touched by a newer build would otherwise open here and
    // fail later with an opaque row-mapping error - or worse, write
    // rows the newer schema does not expect.
    let latest = MIGRATIONS.len() as i64;
    if version > latest {
        return Err(Error::State(format!(
            "this vault was created by a newer version of the app \
             (database schema {version}, this build supports {latest}); \
             update the app instead of downgrading"
        )));
    }
    for (idx, migration) in MIGRATIONS.iter().enumerate() {
        let target = (idx + 1) as i64;
        if version < target {
            // Each step commits atomically with its version bump: a crash
            // mid-migration must not leave a half-applied schema behind
            // the old user_version (the re-run would then fail on
            // duplicate DDL).
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(migration)?;
            tx.pragma_update(None, "user_version", target)?;
            tx.commit()?;
        }
    }
    Ok(())
}

pub fn mirror_settings(conn: &Connection, config: &AppConfig) -> Result<()> {
    // one transaction so a crash mid-loop never leaves the mirror half
    // old, half new
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )?;
        for (key, value) in config.settings_pairs() {
            stmt.execute((key, value))?;
        }
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = memory_db();
        migrate(&conn).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
    }

    /// Not just idempotency from empty: a populated old-schema vault
    /// must upgrade with its rows intact and the later backfills applied.
    #[test]
    fn migrate_upgrades_a_populated_old_vault() {
        let conn = Connection::open_in_memory().unwrap();
        for (idx, migration) in MIGRATIONS.iter().take(2).enumerate() {
            conn.execute_batch(migration).unwrap();
            conn.pragma_update(None, "user_version", (idx + 1) as i64)
                .unwrap();
        }
        conn.execute("INSERT INTO lists (name) VALUES ('Inbox')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO tasks (title, created_at, origin, scheduled_date)
             VALUES ('cake', '2026-01-01T00:00:00Z', 'birthday', '2026-03-14')",
            [],
        )
        .unwrap();

        migrate(&conn).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
        // columns added later exist with defaults, backfill 011 applied
        let (priority, cadence, origin_date): (i64, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT priority, cadence, origin_date FROM tasks",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(priority, 0);
        assert_eq!(cadence.as_deref(), Some("yearly"));
        assert_eq!(origin_date.as_deref(), Some("2026-03-14"));
    }

    #[test]
    fn newer_schema_is_refused_instead_of_half_opened() {
        let conn = memory_db();
        conn.pragma_update(None, "user_version", 999).unwrap();
        let err = migrate(&conn).unwrap_err();
        assert!(err.to_string().contains("newer version"));
    }

    #[test]
    fn settings_mirror_upserts() {
        let conn = memory_db();
        let mut config = AppConfig::default();
        mirror_settings(&conn, &config).unwrap();

        config.theme = "light".into();
        mirror_settings(&conn, &config).unwrap();

        let theme: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'theme'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(theme, "light");
    }
}
