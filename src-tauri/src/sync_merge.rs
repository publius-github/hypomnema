//! Generalizes `tasks_mirror.rs`'s proven three-way merge (a field applies
//! only if it differs from the last-common base) from "one app catching up
//! with a human's text-editor edits" to "two independent app instances
//! both writing the same record" - `docs/android/REQUIREMENTS.md` §3.
//!
//! Deliberately dumb regardless of record shape: every task/list/config/
//! note/journal record synced between desktop and mobile is treated as a
//! flat top-level field map (a changed nested value is compared and
//! replaced wholesale, not merged field-by-field inside it). A same-field
//! collision (both sides changed it since the base, to different values)
//! resolves by whichever record is newer per its own `updated_at`, and the
//! losing value is never silently dropped - it comes back in the conflict
//! list for a caller to surface (Phase 3's conflict-log UI).
//!
//! Deletion is represented only as "the record is absent", which carries
//! no timestamp of its own - a real tombstone (with its own `updated_at`/
//! `updated_by`, the way `state_export.rs` already tracks archived tasks)
//! is what Phase 1's wiring into `tasks.jsonl` etc. needs to add; until
//! then this module can only tell a caller a deletion was overridden by a
//! concurrent edit, not attribute the deletion to a side or a time.
//!
//! Nothing outside this module's own tests calls into it yet - it's
//! staged ahead of the JSONL schema's `updated_at`/`updated_by` fields and
//! the sync pipeline that will call it, both later Phase 1 work.
#![allow(dead_code)]

use std::cmp::Ordering;
use std::collections::BTreeSet;

use serde_json::{Map, Value};

/// One field where local and remote both changed the same field to
/// different values since `base`. The merge already picked a winner by
/// `updated_at`; this exists purely so nothing is dropped silently.
#[derive(Debug, Clone, PartialEq)]
pub struct FieldConflict {
    pub field: String,
    pub kept: Value,
    pub kept_updated_by: String,
    pub discarded: Value,
    pub discarded_updated_by: String,
}

/// A record either side may have independently edited. `updated_at` must
/// be directly comparable (RFC3339 UTC, so lexicographic order matches
/// chronological order) and `updated_by` is the device id - both stamped
/// by the caller alongside the record's actual data in `fields`.
#[derive(Debug, Clone, PartialEq)]
pub struct Record {
    pub updated_at: String,
    pub updated_by: String,
    pub fields: Map<String, Value>,
}

/// Merges one record present (or not) on both sides against their last
/// common `base`. Returns `None` when the merge result is "the record no
/// longer exists" (both sides deleted it, or one deleted it and the other
/// made no field-level change since the base).
pub fn merge_record(
    base: Option<&Record>,
    local: Option<&Record>,
    remote: Option<&Record>,
    conflicts: &mut Vec<FieldConflict>,
) -> Option<Record> {
    match (local, remote) {
        (None, None) => None,
        (Some(survivor), None) | (None, Some(survivor)) => {
            merge_against_deletion(base, survivor, conflicts)
        }
        (Some(l), Some(r)) => Some(merge_both_present(base, l, r, conflicts)),
    }
}

/// One side kept a record, the other has none (deleted it, or never saw
/// it). A field-level edit on the surviving side since `base` wins over
/// the deletion - a delete never silently discards a change the other
/// side just made (REQUIREMENTS.md §3: "optimize for never silently
/// losing data").
fn merge_against_deletion(
    base: Option<&Record>,
    survivor: &Record,
    conflicts: &mut Vec<FieldConflict>,
) -> Option<Record> {
    let survivor_changed_since_base = match base {
        // No common base: the surviving side's copy predates whatever
        // history the deleting side is working from, so treat it as an
        // edit rather than assume the deletion is authoritative.
        None => true,
        Some(base) => survivor.fields != base.fields,
    };
    if !survivor_changed_since_base {
        return None;
    }
    if base.is_some() {
        conflicts.push(FieldConflict {
            field: "<record>".to_string(),
            kept: Value::String("edited, deletion overridden".to_string()),
            kept_updated_by: survivor.updated_by.clone(),
            discarded: Value::String("deleted".to_string()),
            discarded_updated_by: String::new(),
        });
    }
    Some(survivor.clone())
}

fn merge_both_present(
    base: Option<&Record>,
    local: &Record,
    remote: &Record,
    conflicts: &mut Vec<FieldConflict>,
) -> Record {
    let empty = Map::new();
    let base_fields = base.map(|b| &b.fields).unwrap_or(&empty);

    let mut keys: BTreeSet<&String> = local.fields.keys().collect();
    keys.extend(remote.fields.keys());
    keys.extend(base_fields.keys());

    let mut merged = Map::new();
    for key in keys {
        let base_v = base_fields.get(key);
        let local_v = local.fields.get(key);
        let remote_v = remote.fields.get(key);
        let local_changed = local_v != base_v;
        let remote_changed = remote_v != base_v;

        let winner = match (local_changed, remote_changed) {
            (false, false) => base_v,
            (true, false) => local_v,
            (false, true) => remote_v,
            (true, true) if local_v == remote_v => local_v,
            (true, true) => {
                let (kept, kept_by, discarded, discarded_by) = if record_is_newer(local, remote) {
                    (local_v, &local.updated_by, remote_v, &remote.updated_by)
                } else {
                    (remote_v, &remote.updated_by, local_v, &local.updated_by)
                };
                conflicts.push(FieldConflict {
                    field: key.clone(),
                    kept: kept.cloned().unwrap_or(Value::Null),
                    kept_updated_by: kept_by.clone(),
                    discarded: discarded.cloned().unwrap_or(Value::Null),
                    discarded_updated_by: discarded_by.clone(),
                });
                kept
            }
        };
        if let Some(v) = winner {
            merged.insert(key.clone(), v.clone());
        }
    }

    let (updated_at, updated_by) = if record_is_newer(local, remote) {
        (local.updated_at.clone(), local.updated_by.clone())
    } else {
        (remote.updated_at.clone(), remote.updated_by.clone())
    };

    Record {
        updated_at,
        updated_by,
        fields: merged,
    }
}

/// A tied timestamp keeps `a` - arbitrary but deterministic. Callers
/// should stamp `updated_at` with enough precision that a real tie
/// between two different devices is rare.
fn record_is_newer(a: &Record, b: &Record) -> bool {
    matches!(
        a.updated_at.cmp(&b.updated_at),
        Ordering::Greater | Ordering::Equal
    )
}

/// `rule_runs`' dedup ledger merges as a plain set union of
/// `(rule_key, period_key)` pairs (REQUIREMENTS.md §3) - it's inherently
/// conflict-free, since both sides regenerating the same period
/// independently must collapse to one row.
pub fn merge_rule_runs(
    local: impl IntoIterator<Item = (String, String)>,
    remote: impl IntoIterator<Item = (String, String)>,
) -> BTreeSet<(String, String)> {
    let mut merged: BTreeSet<(String, String)> = local.into_iter().collect();
    merged.extend(remote);
    merged
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn record(updated_at: &str, updated_by: &str, fields: Map<String, Value>) -> Record {
        Record {
            updated_at: updated_at.to_string(),
            updated_by: updated_by.to_string(),
            fields,
        }
    }

    fn fields(pairs: &[(&str, Value)]) -> Map<String, Value> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    #[test]
    fn only_local_changed_wins_with_no_conflict() {
        let base = record("t0", "desktop", fields(&[("title", json!("Buy milk"))]));
        let local = record("t1", "desktop", fields(&[("title", json!("Buy oat milk"))]));
        let remote = record("t0", "phone", fields(&[("title", json!("Buy milk"))]));

        let mut conflicts = vec![];
        let merged = merge_record(Some(&base), Some(&local), Some(&remote), &mut conflicts)
            .expect("record survives");

        assert!(conflicts.is_empty());
        assert_eq!(merged.fields["title"], json!("Buy oat milk"));
    }

    #[test]
    fn same_field_collision_resolves_by_newer_updated_at_and_logs_the_loser() {
        let base = record("t0", "desktop", fields(&[("title", json!("Buy milk"))]));
        let local = record("t1", "desktop", fields(&[("title", json!("Buy oat milk"))]));
        let remote = record("t2", "phone", fields(&[("title", json!("Buy soy milk"))]));

        let mut conflicts = vec![];
        let merged = merge_record(Some(&base), Some(&local), Some(&remote), &mut conflicts)
            .expect("record survives");

        // remote (t2) is newer than local (t1) - it wins the collision.
        assert_eq!(merged.fields["title"], json!("Buy soy milk"));
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].field, "title");
        assert_eq!(conflicts[0].kept, json!("Buy soy milk"));
        assert_eq!(conflicts[0].discarded, json!("Buy oat milk"));
        assert_eq!(conflicts[0].discarded_updated_by, "desktop");
    }

    #[test]
    fn identical_edit_on_both_sides_is_not_a_conflict() {
        let base = record("t0", "desktop", fields(&[("status", json!("todo"))]));
        let local = record("t1", "desktop", fields(&[("status", json!("done"))]));
        let remote = record("t1", "phone", fields(&[("status", json!("done"))]));

        let mut conflicts = vec![];
        let merged = merge_record(Some(&base), Some(&local), Some(&remote), &mut conflicts)
            .expect("record survives");

        assert!(conflicts.is_empty());
        assert_eq!(merged.fields["status"], json!("done"));
    }

    #[test]
    fn field_removed_on_one_side_and_untouched_on_the_other_is_removed() {
        let base = record(
            "t0",
            "desktop",
            fields(&[("title", json!("Buy milk")), ("note", json!("2%"))]),
        );
        let local = record("t1", "desktop", fields(&[("title", json!("Buy milk"))]));
        let remote = record(
            "t0",
            "phone",
            fields(&[("title", json!("Buy milk")), ("note", json!("2%"))]),
        );

        let mut conflicts = vec![];
        let merged = merge_record(Some(&base), Some(&local), Some(&remote), &mut conflicts)
            .expect("record survives");

        assert!(conflicts.is_empty());
        assert!(!merged.fields.contains_key("note"));
    }

    #[test]
    fn deletion_unchanged_since_base_is_accepted() {
        let base = record("t0", "desktop", fields(&[("title", json!("Buy milk"))]));
        let remote = record("t0", "phone", fields(&[("title", json!("Buy milk"))]));

        let mut conflicts = vec![];
        let merged = merge_record(Some(&base), None, Some(&remote), &mut conflicts);

        assert!(conflicts.is_empty());
        assert!(merged.is_none());
    }

    #[test]
    fn deletion_overridden_by_a_concurrent_edit_keeps_the_edit_and_logs_it() {
        let base = record("t0", "desktop", fields(&[("title", json!("Buy milk"))]));
        // local deleted the task; remote edited it after the same base.
        let remote = record("t1", "phone", fields(&[("title", json!("Buy oat milk"))]));

        let mut conflicts = vec![];
        let merged = merge_record(Some(&base), None, Some(&remote), &mut conflicts)
            .expect("the edit survives the deletion");

        assert_eq!(merged.fields["title"], json!("Buy oat milk"));
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].field, "<record>");
    }

    #[test]
    fn both_sides_deleting_is_not_a_conflict() {
        let mut conflicts = vec![];
        let merged = merge_record(None, None, None, &mut conflicts);
        assert!(conflicts.is_empty());
        assert!(merged.is_none());
    }

    #[test]
    fn rule_runs_merge_as_a_set_union() {
        let local = vec![
            ("daily-standup".to_string(), "2026-09-08".to_string()),
            ("weekly-review".to_string(), "2026-W36".to_string()),
        ];
        let remote = vec![
            ("daily-standup".to_string(), "2026-09-08".to_string()),
            ("daily-standup".to_string(), "2026-09-09".to_string()),
        ];

        let merged = merge_rule_runs(local, remote);

        assert_eq!(merged.len(), 3);
        assert!(merged.contains(&("daily-standup".to_string(), "2026-09-09".to_string())));
        assert!(merged.contains(&("weekly-review".to_string(), "2026-W36".to_string())));
    }
}
