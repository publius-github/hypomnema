//! Merging the JSONL state snapshot record by record - the step that
//! turns `sync_merge.rs`'s generic field merge into something that
//! actually runs over this app's tasks and lists.
//! docs/android/ROADMAP.md Phase 1/3, REQUIREMENTS.md §3.
//!
//! Why these files and not the database: `state/*.jsonl` is the
//! authoritative text form of everything app.db holds (`state_export.rs`),
//! and it is what travels between devices. Merging it means the merged
//! result rebuilds into a database on the next open, through the same
//! disposable-cache path that already exists - no second write path into
//! SQLite, and no merge logic that has to understand schema migrations.
//!
//! Each file gets the merge its content deserves rather than one blanket
//! rule:
//! - `tasks.jsonl` / `lists.jsonl` carry per-row `updated_at`/`updated_by`
//!   (db.rs migration 016), so a same-field collision resolves by the
//!   newer stamp and the loser goes to the conflict log.
//! - `rule_runs.jsonl` is a set union: both devices generating the same
//!   period independently must collapse to one row, never two.
//! - `rule_seen.jsonl` keeps the *earliest* first-seen date, because that
//!   date is what stops catch-up re-running a rule's whole history.
//! - `weekly_focus.jsonl` is a plain value with no stamp of its own; a
//!   genuine collision keeps this device's pin and logs the other.
//!
//! A row's own `updated_at`/`updated_by` are lifted out of the field map
//! before merging and put back on the way out: leaving them in would make
//! every touched row collide with itself on the stamp fields.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};

use crate::error::{Error, Result};
use crate::ids;
use crate::sync_merge::{merge_record, FieldConflict, Record};

/// One row's identity within its file, in the order `state_export.rs`
/// writes them - numeric ids sort numerically, not as text, so a merged
/// file stays byte-comparable with a freshly exported one.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum KeyPart {
    Num(i64),
    Text(String),
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct RowKey(Vec<KeyPart>);

/// How one state file is keyed and merged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateFile {
    /// Stamped rows keyed by `id`: the real three-way merge.
    Stamped,
    /// `(rule_key, period_key)` pairs, merged as a set union.
    RuleRuns,
    /// `rule_key` -> first-seen date, earliest wins.
    RuleSeen,
    /// `(iso_year, iso_week)` -> phrase index, no stamp to arbitrate with.
    WeeklyFocus,
}

impl StateFile {
    /// Which merge a state file gets, by name. `None` for anything not
    /// part of the snapshot - a caller must not guess a merge for a file
    /// whose shape it does not know.
    pub fn of(file_name: &str) -> Option<Self> {
        match file_name {
            "tasks.jsonl" | "lists.jsonl" | "list_groups.jsonl" => Some(Self::Stamped),
            "rule_runs.jsonl" => Some(Self::RuleRuns),
            "rule_seen.jsonl" => Some(Self::RuleSeen),
            "weekly_focus.jsonl" => Some(Self::WeeklyFocus),
            _ => None,
        }
    }

    fn key_fields(self) -> &'static [&'static str] {
        match self {
            Self::Stamped => &["id"],
            Self::RuleRuns => &["rule_key", "period_key"],
            Self::RuleSeen => &["rule_key"],
            Self::WeeklyFocus => &["iso_year", "iso_week"],
        }
    }
}

/// Is this vault-relative path one of the snapshot files?
pub fn state_file_of(vault_relative: &str) -> Option<StateFile> {
    let name = vault_relative.strip_prefix(&format!("{}/state/", crate::vault::WORK_DIR))?;
    if name.contains('/') {
        return None;
    }
    StateFile::of(name)
}

/// What a merge produced: the file to write, and everything it had to
/// choose between while producing it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StateMerge {
    pub text: String,
    pub conflicts: Vec<FieldConflict>,
}

fn parse_rows(text: &str, kind: StateFile) -> Result<BTreeMap<RowKey, Map<String, Value>>> {
    let mut rows = BTreeMap::new();
    for (i, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(line)
            .map_err(|e| Error::State(format!("state merge: line {}: {e}", i + 1)))?;
        let Value::Object(object) = value else {
            return Err(Error::State(format!(
                "state merge: line {} is not a JSON object",
                i + 1
            )));
        };
        rows.insert(row_key(&object, kind)?, object);
    }
    Ok(rows)
}

fn row_key(row: &Map<String, Value>, kind: StateFile) -> Result<RowKey> {
    kind.key_fields()
        .iter()
        .map(|field| match row.get(*field) {
            Some(Value::Number(n)) if n.is_i64() => Ok(KeyPart::Num(n.as_i64().unwrap_or(0))),
            Some(Value::String(s)) => Ok(KeyPart::Text(s.clone())),
            other => Err(Error::State(format!(
                "state merge: row has no usable \"{field}\" key (got {other:?})"
            ))),
        })
        .collect::<Result<Vec<_>>>()
        .map(RowKey)
}

fn to_jsonl(rows: impl IntoIterator<Item = Map<String, Value>>) -> String {
    let mut out = String::new();
    for row in rows {
        out.push_str(&Value::Object(row).to_string());
        out.push('\n');
    }
    out
}

/// Splits a row into the merge stamps and everything else. Leaving the
/// stamps among the fields would make every edited row collide with
/// itself on `updated_at`.
fn as_record(mut row: Map<String, Value>) -> Record {
    let updated_at = take_string(&mut row, "updated_at");
    let updated_by = take_string(&mut row, "updated_by");
    Record {
        updated_at,
        updated_by,
        fields: row,
    }
}

fn take_string(row: &mut Map<String, Value>, field: &str) -> String {
    match row.remove(field) {
        Some(Value::String(s)) => s,
        // An older build's snapshot has no stamps at all (they are
        // optional in both directions on purpose, state_export.rs). An
        // empty stamp loses every tie, which is the right way for an
        // unstamped row to lose to a stamped one.
        _ => String::new(),
    }
}

fn from_record(record: Record) -> Map<String, Value> {
    let mut row = record.fields;
    if !record.updated_at.is_empty() {
        row.insert("updated_at".into(), Value::String(record.updated_at));
    }
    if !record.updated_by.is_empty() {
        row.insert("updated_by".into(), Value::String(record.updated_by));
    }
    row
}

/// Merges one snapshot file. `base` is the copy both devices last agreed
/// on (`None` when this device has never had one, which makes every
/// difference look like a change on both sides - deliberately cautious).
pub fn merge_state_file(
    kind: StateFile,
    base: Option<&str>,
    local: &str,
    remote: &str,
) -> Result<StateMerge> {
    match kind {
        StateFile::Stamped => merge_stamped(base, local, remote),
        StateFile::RuleRuns => Ok(merge_union(
            parse_rows(local, kind)?,
            parse_rows(remote, kind)?,
        )),
        StateFile::RuleSeen => merge_rule_seen(local, remote),
        StateFile::WeeklyFocus => merge_weekly_focus(base, local, remote),
    }
}

fn merge_stamped(base: Option<&str>, local: &str, remote: &str) -> Result<StateMerge> {
    let kind = StateFile::Stamped;
    let base_rows = match base {
        Some(text) => parse_rows(text, kind)?,
        None => BTreeMap::new(),
    };
    let local_rows = parse_rows(local, kind)?;
    let remote_rows = parse_rows(remote, kind)?;

    let mut keys: BTreeSet<&RowKey> = local_rows.keys().collect();
    keys.extend(remote_rows.keys());
    keys.extend(base_rows.keys());

    let mut conflicts = Vec::new();
    let mut merged = Vec::new();
    for key in keys {
        let to_record =
            |rows: &BTreeMap<RowKey, Map<String, Value>>| rows.get(key).cloned().map(as_record);
        let base_record = base.and_then(|_| to_record(&base_rows));
        let local_record = to_record(&local_rows);
        let remote_record = to_record(&remote_rows);
        let mut row_conflicts = Vec::new();
        if let Some(record) = merge_record(
            base_record.as_ref(),
            local_record.as_ref(),
            remote_record.as_ref(),
            &mut row_conflicts,
        ) {
            merged.push(from_record(record));
        }
        // A conflict is only findable later if it says which row it was
        // in - "title" alone is every task in the vault.
        // A fresh engine copy of an instance holds nobody's decision:
        // what it loses (its own created_at, its place in the day) is
        // not a conflict anyone needs to read about.
        row_conflicts.retain(|c| c.discarded_updated_by != ids::UNTOUCHED_BY);
        for mut conflict in row_conflicts {
            conflict.field = format!("{}: {}", describe_key(key), conflict.field);
            conflicts.push(conflict);
        }
    }
    Ok(StateMerge {
        text: to_jsonl(merged),
        conflicts,
    })
}

fn describe_key(key: &RowKey) -> String {
    key.0
        .iter()
        .map(|part| match part {
            KeyPart::Num(n) => n.to_string(),
            KeyPart::Text(s) => s.clone(),
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// The dedup ledger: a plain set union, never a choice. Two devices that
/// generated the same period must end up with one row, and neither row is
/// more true than the other.
fn merge_union(
    local: BTreeMap<RowKey, Map<String, Value>>,
    remote: BTreeMap<RowKey, Map<String, Value>>,
) -> StateMerge {
    let mut merged = local;
    for (key, row) in remote {
        merged.entry(key).or_insert(row);
    }
    StateMerge {
        text: to_jsonl(merged.into_values()),
        conflicts: Vec::new(),
    }
}

/// First-seen dates decide how far back catch-up reaches, so the earliest
/// one is the safe answer: taking the later of two would re-run a rule's
/// history as a pile of fresh overdue tasks.
fn merge_rule_seen(local: &str, remote: &str) -> Result<StateMerge> {
    let kind = StateFile::RuleSeen;
    let mut merged = parse_rows(local, kind)?;
    for (key, row) in parse_rows(remote, kind)? {
        match merged.get(&key) {
            Some(mine) => {
                let theirs_is_earlier = row.get("first_seen").and_then(Value::as_str)
                    < mine.get("first_seen").and_then(Value::as_str);
                if theirs_is_earlier {
                    merged.insert(key, row);
                }
            }
            None => {
                merged.insert(key, row);
            }
        }
    }
    Ok(StateMerge {
        text: to_jsonl(merged.into_values()),
        conflicts: Vec::new(),
    })
}

/// The focus rotation's week pin. Nothing stamps it, so a real collision
/// has no timestamp to arbitrate with: this device's pin stands and the
/// other is logged, rather than a phrase silently changing mid-week.
fn merge_weekly_focus(base: Option<&str>, local: &str, remote: &str) -> Result<StateMerge> {
    let kind = StateFile::WeeklyFocus;
    let base_rows = match base {
        Some(text) => parse_rows(text, kind)?,
        None => BTreeMap::new(),
    };
    let local_rows = parse_rows(local, kind)?;
    let remote_rows = parse_rows(remote, kind)?;

    let mut keys: BTreeSet<&RowKey> = local_rows.keys().collect();
    keys.extend(remote_rows.keys());
    let mut conflicts = Vec::new();
    let mut merged = Vec::new();
    for key in keys {
        let base_row = base_rows.get(key);
        let local_row = local_rows.get(key);
        let remote_row = remote_rows.get(key);
        let chosen = match (local_row, remote_row) {
            (Some(l), Some(r)) if l == r => Some(l),
            (Some(l), Some(r)) => {
                if Some(l) == base_row {
                    Some(r)
                } else if Some(r) == base_row {
                    Some(l)
                } else {
                    conflicts.push(FieldConflict {
                        field: format!("{}: phrase_index", describe_key(key)),
                        kept: l.get("phrase_index").cloned().unwrap_or(Value::Null),
                        kept_updated_by: String::new(),
                        discarded: r.get("phrase_index").cloned().unwrap_or(Value::Null),
                        discarded_updated_by: String::new(),
                    });
                    Some(l)
                }
            }
            (Some(l), None) => Some(l),
            (None, Some(r)) => Some(r),
            (None, None) => None,
        };
        if let Some(row) = chosen {
            merged.push(row.clone());
        }
    }
    Ok(StateMerge {
        text: to_jsonl(merged),
        conflicts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(id: i64, title: &str, stamp: &str, by: &str) -> String {
        format!(
            "{{\"id\":{id},\"title\":\"{title}\",\"status\":\"todo\",\
             \"updated_at\":\"{stamp}\",\"updated_by\":\"{by}\"}}"
        )
    }

    fn titles(text: &str) -> Vec<String> {
        text.lines()
            .map(|line| {
                serde_json::from_str::<Value>(line).unwrap()["title"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect()
    }

    #[test]
    fn state_files_are_recognized_by_their_place_in_the_vault() {
        assert_eq!(
            state_file_of(".hypomnema/state/tasks.jsonl"),
            Some(StateFile::Stamped)
        );
        assert_eq!(
            state_file_of(".hypomnema/state/rule_runs.jsonl"),
            Some(StateFile::RuleRuns)
        );
        // The mirror's merge base lives one level deeper and is a
        // statement about this device, not a shared record.
        assert!(state_file_of(".hypomnema/state/mirror-base/Inbox.md").is_none());
        assert!(state_file_of("journal/2026-09-08.md").is_none());
    }

    #[test]
    fn a_task_added_on_each_device_survives_on_both() {
        let base = task(1, "shared", "t0", "desktop");
        let local = format!("{}\n{}", base, task(2, "added on desktop", "t1", "desktop"));
        let remote = format!("{}\n{}", base, task(3, "added on phone", "t1", "phone"));

        let merged = merge_state_file(StateFile::Stamped, Some(&base), &local, &remote).unwrap();

        assert_eq!(
            titles(&merged.text),
            vec!["shared", "added on desktop", "added on phone"]
        );
        assert!(merged.conflicts.is_empty());
    }

    #[test]
    fn checking_a_task_off_on_the_phone_is_not_undone_by_the_desktops_untouched_copy() {
        let base = task(1, "water the plants", "t0", "desktop");
        let remote = "{\"id\":1,\"title\":\"water the plants\",\"status\":\"done\",\
                      \"updated_at\":\"t1\",\"updated_by\":\"phone\"}";

        let merged = merge_state_file(StateFile::Stamped, Some(&base), &base, remote).unwrap();

        assert!(merged.text.contains("\"status\":\"done\""));
        assert!(merged.conflicts.is_empty());
    }

    #[test]
    fn an_instance_generated_on_both_devices_keeps_the_desktops_check_off() {
        // Same derived id on both ends (ids.rs); the phone generated its
        // copy after the desktop had already checked it off.
        let desktop = "{\"id\":7,\"title\":\"pay rent\",\"status\":\"done\",\
                       \"created_at\":\"2026-10-14T06:00:00Z\",\
                       \"updated_at\":\"2026-10-14T08:00:00Z\",\"updated_by\":\"desktop\"}";
        let phone = format!(
            "{{\"id\":7,\"title\":\"pay rent\",\"status\":\"todo\",\
             \"created_at\":\"2026-10-14T19:00:00Z\",\
             \"updated_at\":\"{}\",\"updated_by\":\"{}\"}}",
            ids::UNTOUCHED_AT,
            ids::UNTOUCHED_BY
        );

        let merged = merge_state_file(StateFile::Stamped, None, &phone, desktop).unwrap();

        assert_eq!(merged.text.lines().count(), 1);
        assert!(merged.text.contains("\"status\":\"done\""));
        assert!(merged.conflicts.is_empty(), "{:?}", merged.conflicts);
    }

    #[test]
    fn the_same_task_edited_on_both_devices_keeps_the_newer_and_logs_the_other() {
        let base = task(1, "buy milk", "t0", "desktop");
        let local = task(1, "buy oat milk", "t1", "desktop");
        let remote = task(1, "buy soy milk", "t2", "phone");

        let merged = merge_state_file(StateFile::Stamped, Some(&base), &local, &remote).unwrap();

        assert_eq!(titles(&merged.text), vec!["buy soy milk"]);
        assert_eq!(merged.conflicts.len(), 1);
        // The row has to be identifiable: "title" alone is every task.
        assert_eq!(merged.conflicts[0].field, "1: title");
        assert_eq!(
            merged.conflicts[0].discarded,
            Value::String("buy oat milk".into())
        );
    }

    #[test]
    fn a_task_deleted_here_and_untouched_there_stays_deleted() {
        let base = format!(
            "{}\n{}",
            task(1, "keep", "t0", "d"),
            task(2, "drop", "t0", "d")
        );
        let local = task(1, "keep", "t0", "d");
        let remote = base.clone();

        let merged = merge_state_file(StateFile::Stamped, Some(&base), &local, &remote).unwrap();

        assert_eq!(titles(&merged.text), vec!["keep"]);
        assert!(merged.conflicts.is_empty());
    }

    #[test]
    fn a_task_deleted_here_but_edited_there_comes_back_and_says_so() {
        let base = task(1, "buy milk", "t0", "desktop");
        let remote = task(1, "buy oat milk", "t1", "phone");

        let merged = merge_state_file(StateFile::Stamped, Some(&base), "", &remote).unwrap();

        assert_eq!(titles(&merged.text), vec!["buy oat milk"]);
        assert_eq!(merged.conflicts.len(), 1);
    }

    #[test]
    fn rows_stay_in_id_order_so_the_file_matches_a_fresh_export() {
        // Ids sorted as text would put 10 before 2.
        let local = format!(
            "{}\n{}",
            task(2, "two", "t0", "d"),
            task(10, "ten", "t0", "d")
        );
        let merged = merge_state_file(StateFile::Stamped, None, &local, "").unwrap();
        assert_eq!(titles(&merged.text), vec!["two", "ten"]);
    }

    #[test]
    fn an_unstamped_row_from_an_older_build_loses_to_a_stamped_one() {
        let base = "{\"id\":1,\"title\":\"old\"}";
        let local = "{\"id\":1,\"title\":\"edited by an old build\"}";
        let remote = task(1, "edited by a new build", "t1", "phone");

        let merged = merge_state_file(StateFile::Stamped, Some(base), local, &remote).unwrap();

        assert_eq!(titles(&merged.text), vec!["edited by a new build"]);
    }

    #[test]
    fn the_dedup_ledger_is_a_union_with_no_duplicate_periods() {
        let local = "{\"rule_key\":\"a\",\"period_key\":\"2026-09-08\",\"generated_at\":\"x\"}\n\
                     {\"rule_key\":\"b\",\"period_key\":\"2026-09-08\",\"generated_at\":\"x\"}";
        let remote = "{\"rule_key\":\"a\",\"period_key\":\"2026-09-08\",\"generated_at\":\"y\"}\n\
                      {\"rule_key\":\"a\",\"period_key\":\"2026-09-09\",\"generated_at\":\"y\"}";

        let merged = merge_state_file(StateFile::RuleRuns, None, local, remote).unwrap();

        assert_eq!(merged.text.lines().count(), 3);
        assert!(merged.conflicts.is_empty());
    }

    #[test]
    fn first_seen_keeps_the_earlier_date_so_catch_up_does_not_re_run_history() {
        let local = "{\"rule_key\":\"a\",\"first_seen\":\"2026-09-01\"}";
        let remote = "{\"rule_key\":\"a\",\"first_seen\":\"2026-01-01\"}";

        let merged = merge_state_file(StateFile::RuleSeen, None, local, remote).unwrap();

        assert!(merged.text.contains("2026-01-01"));
        assert_eq!(merged.text.lines().count(), 1);
    }

    #[test]
    fn a_focus_pin_changed_on_one_side_only_is_taken_without_a_conflict() {
        let base = "{\"iso_year\":2026,\"iso_week\":37,\"phrase_index\":1}";
        let remote = "{\"iso_year\":2026,\"iso_week\":37,\"phrase_index\":4}";

        let merged = merge_state_file(StateFile::WeeklyFocus, Some(base), base, remote).unwrap();

        assert!(merged.text.contains("\"phrase_index\":4"));
        assert!(merged.conflicts.is_empty());
    }

    #[test]
    fn a_focus_pin_changed_on_both_sides_keeps_this_device_and_logs_the_other() {
        let base = "{\"iso_year\":2026,\"iso_week\":37,\"phrase_index\":1}";
        let local = "{\"iso_year\":2026,\"iso_week\":37,\"phrase_index\":2}";
        let remote = "{\"iso_year\":2026,\"iso_week\":37,\"phrase_index\":3}";

        let merged = merge_state_file(StateFile::WeeklyFocus, Some(base), local, remote).unwrap();

        assert!(merged.text.contains("\"phrase_index\":2"));
        assert_eq!(merged.conflicts.len(), 1);
    }

    #[test]
    fn a_broken_line_fails_the_merge_instead_of_dropping_rows() {
        let err = merge_state_file(StateFile::Stamped, None, "{not json}", "").unwrap_err();
        assert!(matches!(err, Error::State(_)));
    }
}
