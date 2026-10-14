//! Row ids for `tasks`, `lists` and `list_groups` that two devices can
//! mint independently without colliding.
//!
//! The JSONL snapshot merges row by row keyed by `id` (`sync_state.rs`),
//! so SQLite's own choice - `MAX(id) + 1` - is wrong the moment two
//! devices sync: both start from the same maximum and hand the same next
//! id to two different tasks, which the merge then fuses into one. Every
//! production insert therefore names its id:
//!
//! - an engine-generated task gets an id derived from its
//!   `(rule_key, period_key)`, so the phone and the desktop generating the
//!   same instance produce the same row and the merge collapses it;
//! - a list or group gets one derived from its name, so two devices that
//!   each create "Work" end up with one list rather than two that clash
//!   on the unique active-name index;
//! - anything else (a manual task, a name whose derived id is taken) gets
//!   a random one.
//!
//! Both ranges sit above any sequential id an older vault holds and below
//! 2^52, so `MAX(id) + 1` from a missed site still fits a JS number.

use rusqlite::Connection;

use crate::error::{Error, Result};

const RANDOM_FLOOR: i64 = 1 << 40;
const DERIVED_FLOOR: i64 = 1 << 51;

/// `updated_at` of an engine-generated row nobody has touched yet. A
/// fresh copy of an instance carries no decision of anyone's, so any real
/// edit on the other device - checking it off - must outrank it however
/// late this device happened to generate it.
pub const UNTOUCHED_AT: &str = "1970-01-01T00:00:00Z";
/// `updated_by` paired with [`UNTOUCHED_AT`]; also tells the merge that a
/// value this row lost was nobody's to log as a conflict.
pub const UNTOUCHED_BY: &str = "engine";

/// Stable 64-bit FNV-1a: the derived ids must be the same on every device
/// and every build.
fn fnv1a64(input: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn derived(seed: &str) -> i64 {
    DERIVED_FLOOR + (fnv1a64(seed) % DERIVED_FLOOR as u64) as i64
}

fn random() -> Result<i64> {
    let mut bytes = [0u8; 8];
    getrandom::getrandom(&mut bytes).map_err(|e| Error::State(format!("no randomness: {e}")))?;
    let span = (DERIVED_FLOOR - RANDOM_FLOOR) as u64;
    Ok(RANDOM_FLOOR + (u64::from_le_bytes(bytes) % span) as i64)
}

pub fn generated_task_seed(rule_key: &str, period_key: &str) -> String {
    format!("task|{rule_key}|{period_key}")
}

pub fn list_seed(name: &str) -> String {
    format!("list|{name}")
}

pub fn group_seed(name: &str) -> String {
    format!("group|{name}")
}

#[derive(Clone, Copy)]
pub enum Table {
    Tasks,
    Lists,
    ListGroups,
}

impl Table {
    fn name(self) -> &'static str {
        match self {
            Table::Tasks => "tasks",
            Table::Lists => "lists",
            Table::ListGroups => "list_groups",
        }
    }
}

fn is_free(conn: &Connection, table: Table, id: i64) -> Result<bool> {
    Ok(conn.query_row(
        &format!(
            "SELECT NOT EXISTS(SELECT 1 FROM {} WHERE id = ?1)",
            table.name()
        ),
        [id],
        |row| row.get(0),
    )?)
}

/// An id for a new row: the one derived from `seed` when given and free,
/// otherwise a random free one.
pub fn fresh(conn: &Connection, table: Table, seed: Option<&str>) -> Result<i64> {
    if let Some(seed) = seed {
        let id = derived(seed);
        if is_free(conn, table, id)? {
            return Ok(id);
        }
    }
    loop {
        let id = random()?;
        if is_free(conn, table, id)? {
            return Ok(id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derived_ids_are_stable_and_in_their_range() {
        let a = derived(&generated_task_seed("abc", "2026-10-14"));
        assert_eq!(a, derived(&generated_task_seed("abc", "2026-10-14")));
        assert_ne!(a, derived(&generated_task_seed("abc", "2026-10-15")));
        assert!((DERIVED_FLOOR..2 * DERIVED_FLOOR).contains(&a));
        // JS numbers hold integers exactly up to 2^53
        assert!(a + 1 < 1 << 53);
    }

    #[test]
    fn random_ids_stay_below_the_derived_range() {
        for _ in 0..1000 {
            let id = random().unwrap();
            assert!((RANDOM_FLOOR..DERIVED_FLOOR).contains(&id));
        }
    }

    #[test]
    fn a_taken_derived_id_falls_back_to_a_random_one() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE lists (id INTEGER PRIMARY KEY, name TEXT)")
            .unwrap();
        let first = fresh(&conn, Table::Lists, Some(&list_seed("Work"))).unwrap();
        assert_eq!(first, derived(&list_seed("Work")));
        conn.execute("INSERT INTO lists (id, name) VALUES (?1, 'Work')", [first])
            .unwrap();
        let second = fresh(&conn, Table::Lists, Some(&list_seed("Work"))).unwrap();
        assert_ne!(second, first);
        assert!(second < DERIVED_FLOOR);
    }
}
