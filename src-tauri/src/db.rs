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
    // 014: free-text list description shown in the list dialog.
    "ALTER TABLE lists ADD COLUMN description TEXT NOT NULL DEFAULT '';",
    // 015: list names are unique among ACTIVE lists only. An archived
    // list used to keep holding its name forever, so renaming (or
    // creating) a list with a name used once before failed on the
    // table-level UNIQUE - with nothing visible to explain why.
    // Rebuilding the table is the only way to drop that constraint;
    // the task -> list mapping is parked in a temp table first because
    // DROP TABLE fires the tasks.list_id ON DELETE SET NULL action
    // when foreign keys are on.
    "CREATE TABLE lists_new (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        auto INTEGER NOT NULL DEFAULT 0,
        favorite INTEGER NOT NULL DEFAULT 0,
        description TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO lists_new (id, name, sort_order, color, archived, auto, favorite, description)
        SELECT id, name, sort_order, color, archived, auto, favorite, description FROM lists;
    CREATE TABLE lists_task_map AS
        SELECT id AS task_id, list_id FROM tasks WHERE list_id IS NOT NULL;
    DROP TABLE lists;
    ALTER TABLE lists_new RENAME TO lists;
    UPDATE tasks SET list_id = (
        SELECT list_id FROM lists_task_map WHERE task_id = tasks.id
    ) WHERE list_id IS NULL AND id IN (SELECT task_id FROM lists_task_map);
    DROP TABLE lists_task_map;
    CREATE UNIQUE INDEX idx_lists_active_name ON lists(name) WHERE archived = 0;",
    // 016: per-record provenance for cross-device merge.
    // `updated_at` is UTC ISO-8601,
    // `updated_by` the writing device's id from `sync_device`.
    //
    // Stamped by triggers rather than at the ~70 call sites that write
    // these tables: a missed site would not fail any build, it would
    // silently make a changed row look untouched, and the other device's
    // edit would then win a merge it should have lost.
    //
    // Both columns stay nullable, and both triggers stand aside when a
    // statement supplies its own values - that is what lets
    // state_export's restore put a snapshot back with the stamps it was
    // taken with, instead of relabelling every row as "changed here, now".
    "ALTER TABLE tasks ADD COLUMN updated_at TEXT;
    ALTER TABLE tasks ADD COLUMN updated_by TEXT;
    ALTER TABLE lists ADD COLUMN updated_at TEXT;
    ALTER TABLE lists ADD COLUMN updated_by TEXT;
    CREATE TABLE sync_device (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        device_id TEXT NOT NULL
    );
    CREATE TRIGGER tasks_stamp_insert AFTER INSERT ON tasks
    WHEN NEW.updated_at IS NULL
    BEGIN
        UPDATE tasks SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            updated_by = (SELECT device_id FROM sync_device WHERE id = 1)
        WHERE id = NEW.id;
    END;
    CREATE TRIGGER tasks_stamp_update AFTER UPDATE ON tasks
    WHEN NEW.updated_at IS OLD.updated_at
    BEGIN
        UPDATE tasks SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            updated_by = (SELECT device_id FROM sync_device WHERE id = 1)
        WHERE id = NEW.id;
    END;
    CREATE TRIGGER lists_stamp_insert AFTER INSERT ON lists
    WHEN NEW.updated_at IS NULL
    BEGIN
        UPDATE lists SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            updated_by = (SELECT device_id FROM sync_device WHERE id = 1)
        WHERE id = NEW.id;
    END;
    CREATE TRIGGER lists_stamp_update AFTER UPDATE ON lists
    WHEN NEW.updated_at IS OLD.updated_at
    BEGIN
        UPDATE lists SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            updated_by = (SELECT device_id FROM sync_device WHERE id = 1)
        WHERE id = NEW.id;
    END;",
    // 017: list kind. 'todo' lists are working queues (done tasks are
    // swept overnight by clear_done_list_tasks and retention); a
    // 'checklist' keeps its checked items until the user unchecks them -
    // grocery lists, packing lists - and its tasks have no postponed
    // state in the UI.
    "ALTER TABLE lists ADD COLUMN kind TEXT NOT NULL DEFAULT 'todo'
        CHECK (kind IN ('todo', 'checklist'));",
    // 018: list groups. A group is a named folder in the list panel:
    // the panel shows the group, not its member lists - the lists live
    // behind a drill-in. Deleting a group releases its members back to
    // the panel (ON DELETE SET NULL). Stamped by the same trigger
    // pattern as migration 016, so cross-device merge arbitrates group
    // edits the same way it does list edits.
    "CREATE TABLE list_groups (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        updated_at TEXT,
        updated_by TEXT
    );
    ALTER TABLE lists ADD COLUMN group_id INTEGER
        REFERENCES list_groups(id) ON DELETE SET NULL;
    CREATE TRIGGER list_groups_stamp_insert AFTER INSERT ON list_groups
    WHEN NEW.updated_at IS NULL
    BEGIN
        UPDATE list_groups SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            updated_by = (SELECT device_id FROM sync_device WHERE id = 1)
        WHERE id = NEW.id;
    END;
    CREATE TRIGGER list_groups_stamp_update AFTER UPDATE ON list_groups
    WHEN NEW.updated_at IS OLD.updated_at
    BEGIN
        UPDATE list_groups SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            updated_by = (SELECT device_id FROM sync_device WHERE id = 1)
        WHERE id = NEW.id;
    END;",
    // 019: two more task statuses. 'waiting' is done on the user's side
    // but still waiting on someone else - open, carried over like
    // postponed; 'dropped' is not done and taken off the plan - closed
    // like done (swept, pruned, never carried), but never counted as a
    // completion. A CHECK constraint cannot be altered, so the table is
    // rebuilt. The new table's self-reference names tasks_new: DROP
    // TABLE tasks then has no child table to cascade into (with foreign
    // keys on it would otherwise delete every subtask), and the rename
    // rewrites the reference to tasks. Indexes and the migration 016
    // stamp triggers go with the old table and are recreated; the copy
    // keeps every row's stamps, since nothing about a row changed.
    "CREATE TABLE tasks_new (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        description_md TEXT NOT NULL DEFAULT '',
        list_id INTEGER REFERENCES lists(id) ON DELETE SET NULL,
        scheduled_date TEXT,
        time TEXT,
        status TEXT NOT NULL DEFAULT 'todo'
            CHECK (status IN ('todo', 'done', 'postponed', 'waiting', 'dropped')),
        color TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        parent_task_id INTEGER REFERENCES tasks_new(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        overdue INTEGER NOT NULL DEFAULT 0,
        origin TEXT NOT NULL DEFAULT 'manual',
        rule_key TEXT,
        period_key TEXT,
        archived_at TEXT,
        cadence TEXT,
        origin_date TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        dow_label TEXT,
        updated_at TEXT,
        updated_by TEXT
    );
    INSERT INTO tasks_new (id, title, description_md, list_id, scheduled_date, time,
                           status, color, sort_order, parent_task_id, created_at,
                           completed_at, overdue, origin, rule_key, period_key,
                           archived_at, cadence, origin_date, priority, dow_label,
                           updated_at, updated_by)
        SELECT id, title, description_md, list_id, scheduled_date, time,
               status, color, sort_order, parent_task_id, created_at,
               completed_at, overdue, origin, rule_key, period_key,
               archived_at, cadence, origin_date, priority, dow_label,
               updated_at, updated_by
        FROM tasks;
    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;
    CREATE INDEX idx_tasks_scheduled_date ON tasks(scheduled_date);
    CREATE INDEX idx_tasks_list_id ON tasks(list_id);
    CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
    CREATE INDEX idx_tasks_rule_period ON tasks(rule_key, period_key);
    CREATE TRIGGER tasks_stamp_insert AFTER INSERT ON tasks
    WHEN NEW.updated_at IS NULL
    BEGIN
        UPDATE tasks SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            updated_by = (SELECT device_id FROM sync_device WHERE id = 1)
        WHERE id = NEW.id;
    END;
    CREATE TRIGGER tasks_stamp_update AFTER UPDATE ON tasks
    WHEN NEW.updated_at IS OLD.updated_at
    BEGIN
        UPDATE tasks SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
            updated_by = (SELECT device_id FROM sync_device WHERE id = 1)
        WHERE id = NEW.id;
    END;",
    // 020: millisecond merge stamps. Whole seconds made two devices'
    // edits of one row within the same second a tie, and the merge could
    // only pick a side arbitrarily. Rows keep their old second stamps;
    // sync_merge compares the two forms as instants, not as strings.
    "DROP TRIGGER tasks_stamp_insert;
    CREATE TRIGGER tasks_stamp_insert AFTER INSERT ON tasks
    WHEN NEW.updated_at IS NULL
    BEGIN
        UPDATE tasks SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            updated_by = (SELECT device_id FROM sync_device WHERE id = 1)
        WHERE id = NEW.id;
    END;
    DROP TRIGGER tasks_stamp_update;
    CREATE TRIGGER tasks_stamp_update AFTER UPDATE ON tasks
    WHEN NEW.updated_at IS OLD.updated_at
    BEGIN
        UPDATE tasks SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            updated_by = (SELECT device_id FROM sync_device WHERE id = 1)
        WHERE id = NEW.id;
    END;
    DROP TRIGGER lists_stamp_insert;
    CREATE TRIGGER lists_stamp_insert AFTER INSERT ON lists
    WHEN NEW.updated_at IS NULL
    BEGIN
        UPDATE lists SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            updated_by = (SELECT device_id FROM sync_device WHERE id = 1)
        WHERE id = NEW.id;
    END;
    DROP TRIGGER lists_stamp_update;
    CREATE TRIGGER lists_stamp_update AFTER UPDATE ON lists
    WHEN NEW.updated_at IS OLD.updated_at
    BEGIN
        UPDATE lists SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            updated_by = (SELECT device_id FROM sync_device WHERE id = 1)
        WHERE id = NEW.id;
    END;
    DROP TRIGGER list_groups_stamp_insert;
    CREATE TRIGGER list_groups_stamp_insert AFTER INSERT ON list_groups
    WHEN NEW.updated_at IS NULL
    BEGIN
        UPDATE list_groups SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            updated_by = (SELECT device_id FROM sync_device WHERE id = 1)
        WHERE id = NEW.id;
    END;
    DROP TRIGGER list_groups_stamp_update;
    CREATE TRIGGER list_groups_stamp_update AFTER UPDATE ON list_groups
    WHEN NEW.updated_at IS OLD.updated_at
    BEGIN
        UPDATE list_groups SET
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            updated_by = (SELECT device_id FROM sync_device WHERE id = 1)
        WHERE id = NEW.id;
    END;",
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

/// Records which device is writing to this database, for the merge stamps
/// migration 016's triggers put on every row. Called on every vault open:
/// the same vault opened on another machine must stamp with that machine's
/// id, so this is per-connection truth, not a one-time setup step.
pub fn set_device_id(conn: &Connection, device_id: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO sync_device (id, device_id) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET device_id = excluded.device_id",
        [device_id],
    )?;
    Ok(())
}

/// The schema version of an existing database that `migrate` is about
/// to upgrade, or None when there is nothing to do (current, newer - which
/// `migrate` refuses - or a brand-new empty file at version 0).
pub fn pending_upgrade_from(conn: &Connection) -> Result<Option<i64>> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let latest = MIGRATIONS.len() as i64;
    Ok((version > 0 && version < latest).then_some(version))
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

    fn stamps_of(conn: &Connection, id: i64) -> (Option<String>, Option<String>) {
        conn.query_row(
            "SELECT updated_at, updated_by FROM tasks WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    }

    #[test]
    fn an_inserted_row_is_stamped_with_this_device() {
        let conn = memory_db();
        set_device_id(&conn, "device-a").unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, origin)
             VALUES (1, 't', '2026-01-01T00:00:00Z', 'manual')",
            [],
        )
        .unwrap();

        let (at, by) = stamps_of(&conn, 1);
        assert_eq!(by.as_deref(), Some("device-a"));
        assert!(at.is_some_and(|s| s.ends_with('Z')));
    }

    /// The reason the stamps live in triggers at all: no caller has to
    /// remember, so an UPDATE anywhere in the codebase still records that
    /// this device touched the row.
    #[test]
    fn an_updated_row_is_restamped_without_the_caller_asking() {
        let conn = memory_db();
        set_device_id(&conn, "device-a").unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, origin, updated_at, updated_by)
             VALUES (1, 't', '2026-01-01T00:00:00Z', 'manual', '2020-01-01T00:00:00Z', 'someone-else')",
            [],
        )
        .unwrap();

        conn.execute("UPDATE tasks SET title = 'edited' WHERE id = 1", [])
            .unwrap();

        let (at, by) = stamps_of(&conn, 1);
        assert_eq!(by.as_deref(), Some("device-a"));
        assert_ne!(at.as_deref(), Some("2020-01-01T00:00:00Z"));
    }

    /// state_export::restore puts a snapshot back verbatim. If the
    /// triggers overwrote what it supplies, every restore would relabel
    /// the whole vault as "changed here, just now" and the next merge
    /// would let this device win everything.
    #[test]
    fn a_row_restored_with_its_own_stamps_keeps_them() {
        let conn = memory_db();
        set_device_id(&conn, "device-a").unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, origin, updated_at, updated_by)
             VALUES (1, 't', '2026-01-01T00:00:00Z', 'manual', '2026-05-05T05:05:05Z', 'device-b')",
            [],
        )
        .unwrap();

        assert_eq!(
            stamps_of(&conn, 1),
            (
                Some("2026-05-05T05:05:05Z".to_string()),
                Some("device-b".to_string())
            )
        );
    }

    #[test]
    fn lists_are_stamped_too() {
        let conn = memory_db();
        set_device_id(&conn, "device-a").unwrap();
        conn.execute("INSERT INTO lists (id, name) VALUES (1, 'Inbox')", [])
            .unwrap();
        let by: Option<String> = conn
            .query_row("SELECT updated_by FROM lists WHERE id = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(by.as_deref(), Some("device-a"));
    }

    /// A vault opened before any device id was recorded still works; the
    /// stamp is simply unattributed rather than the write failing.
    #[test]
    fn writes_without_a_recorded_device_still_succeed() {
        let conn = memory_db();
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, origin)
             VALUES (1, 't', '2026-01-01T00:00:00Z', 'manual')",
            [],
        )
        .unwrap();
        let (at, by) = stamps_of(&conn, 1);
        assert!(at.is_some());
        assert_eq!(by, None);
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

    /// The task-table rebuild in 019 runs with foreign keys ON too: the
    /// subtasks must survive the DROP, keep cascading afterwards, and
    /// every row keeps the stamps it had - while new writes are stamped
    /// by the recreated triggers.
    #[test]
    fn migration_019_rebuilds_tasks_intact_with_foreign_keys_on() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        for (idx, migration) in MIGRATIONS.iter().take(18).enumerate() {
            conn.execute_batch(migration).unwrap();
            conn.pragma_update(None, "user_version", (idx + 1) as i64)
                .unwrap();
        }
        set_device_id(&conn, "device-a").unwrap();
        conn.execute_batch(
            "INSERT INTO lists (id, name) VALUES (1, 'Work');
             INSERT INTO tasks (id, title, created_at, list_id, status, priority,
                                updated_at, updated_by)
             VALUES (1, 'parent', '', 1, 'postponed', 1, '2026-01-01T00:00:00Z', 'old');
             INSERT INTO tasks (id, title, created_at, parent_task_id, updated_at, updated_by)
             VALUES (2, 'child', '', 1, '2026-01-01T00:00:00Z', 'old');",
        )
        .unwrap();

        migrate(&conn).unwrap();

        let rows: Vec<(i64, Option<i64>, String, i64, String)> = conn
            .prepare(
                "SELECT id, parent_task_id, status, priority, updated_by
                 FROM tasks ORDER BY id",
            )
            .unwrap()
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![
                (1, None, "postponed".into(), 1, "old".into()),
                (2, Some(1), "todo".into(), 0, "old".into()),
            ]
        );
        for status in ["waiting", "dropped"] {
            conn.execute("UPDATE tasks SET status = ?1 WHERE id = 2", [status])
                .unwrap();
        }
        assert!(conn
            .execute("UPDATE tasks SET status = 'later' WHERE id = 2", [])
            .is_err());
        assert_eq!(stamps_of(&conn, 2).1.as_deref(), Some("device-a"));
        conn.execute("DELETE FROM tasks WHERE id = 1", []).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0, "the subtask cascades with its parent");
    }

    /// The list-table rebuild in 015 runs with foreign keys ON in
    /// production, where DROP TABLE lists would otherwise null every
    /// tasks.list_id through the ON DELETE SET NULL action.
    #[test]
    fn migration_015_keeps_task_list_links_with_foreign_keys_on() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        for (idx, migration) in MIGRATIONS.iter().take(14).enumerate() {
            conn.execute_batch(migration).unwrap();
            conn.pragma_update(None, "user_version", (idx + 1) as i64)
                .unwrap();
        }
        conn.execute("INSERT INTO lists (name) VALUES ('Work')", [])
            .unwrap();
        let list_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO tasks (title, created_at, origin, list_id)
             VALUES ('report', '2026-01-01T00:00:00Z', 'manual', ?1)",
            [list_id],
        )
        .unwrap();

        migrate(&conn).unwrap();

        let linked: Option<i64> = conn
            .query_row("SELECT list_id FROM tasks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(linked, Some(list_id));
        // archived namesakes are allowed now, active ones still are not
        conn.execute("UPDATE lists SET archived = 1 WHERE id = ?1", [list_id])
            .unwrap();
        conn.execute("INSERT INTO lists (name) VALUES ('Work')", [])
            .unwrap();
        let clash = conn.execute("INSERT INTO lists (name) VALUES ('Work')", []);
        assert!(clash.is_err(), "two active lists cannot share a name");
    }

    #[test]
    fn pending_upgrade_is_reported_only_for_an_older_populated_schema() {
        let conn = Connection::open_in_memory().unwrap();
        // a brand-new file has nothing to back up
        assert_eq!(pending_upgrade_from(&conn).unwrap(), None);
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        assert_eq!(pending_upgrade_from(&conn).unwrap(), Some(1));
        migrate(&conn).unwrap();
        assert_eq!(pending_upgrade_from(&conn).unwrap(), None);
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
