use std::path::Path;

use rusqlite::Connection;

use crate::config::AppConfig;
use crate::error::Result;

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
];

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for (idx, migration) in MIGRATIONS.iter().enumerate() {
        let target = (idx + 1) as i64;
        if version < target {
            conn.execute_batch(migration)?;
            conn.pragma_update(None, "user_version", target)?;
        }
    }
    Ok(())
}

pub fn mirror_settings(conn: &Connection, config: &AppConfig) -> Result<()> {
    let mut stmt = conn.prepare(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )?;
    for (key, value) in config.settings_pairs() {
        stmt.execute((key, value))?;
    }
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
