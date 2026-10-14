//! One full sync pass: take what the other device wrote, merge it into
//! what this one wrote, send the result back, and propagate deletions.
//! docs/android/ROADMAP.md Phase 1/3, REQUIREMENTS.md §3 and §7.
//!
//! `sync_bootstrap.rs` pulls a vault onto a device for the first time and
//! `sync_push.rs` sends changes up; neither of them handles the case both
//! ends moved. That case is this module's whole subject.
//!
//! Three things decide what happens to a file, and all three already
//! exist: the manifest's **revision** (what this device last saw on the
//! server), the manifest's **hash** (what this device last saw on disk),
//! and - for the JSONL state snapshot only - a **base copy** kept under
//! `base/` in the active sync space (`sync_bootstrap::space_dir`).
//! Together they answer "did I change it?" and "did they change it?"
//! separately, which is what makes a real merge possible instead of a
//! guess.
//!
//! | changed here | changed there | what happens |
//! | --- | --- | --- |
//! | no | no | nothing; no request is made |
//! | yes | no | uploaded, guarded by the revision it was based on |
//! | no | yes | downloaded over the local copy |
//! | yes | yes | merged - per record for the state snapshot, and as a "conflicted copy" kept beside the file for everything else |
//!
//! The conflicted-copy fallback is deliberate. A note or a journal entry
//! is prose, and merging two people's prose line by line invents a
//! version neither of them wrote. Dropbox's own convention - keep both,
//! name the loser after the device that made it - is the one users
//! already recognize, and it is what `tasks_mirror.rs` treats as a hard
//! signal elsewhere in this app.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::sync_bootstrap::{load_manifest, save_manifest, FileState, VaultRoot};
use crate::sync_conflicts::{self, ConflictEntry};
use crate::sync_merge::FieldConflict;
use crate::sync_paths;
use crate::sync_provider::{ChangeMarker, SyncCursor, SyncProvider};
use crate::sync_push::{self, content_hash};
use crate::sync_state;
use crate::vault;

/// Where the last agreed copy of a mergeable file is kept. Only the JSONL
/// snapshot needs one - it is the only content this app merges record by
/// record, and keeping a shadow copy of every note would double the
/// vault on disk for no gain.
/// Under the active sync space (`sync_bootstrap::space_dir`), so a base
/// agreed with one remote is never read as another's.
const BASE_DIR: &str = "base";

/// What a sync pass did, in the terms the screen that triggered it shows.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SyncReport {
    pub downloaded: usize,
    /// Files both ends had changed, which this pass reconciled.
    pub merged: usize,
    pub uploaded: usize,
    pub removed_locally: usize,
    pub removed_remotely: usize,
    /// Entries added to the conflict log.
    pub conflicts: usize,
    /// Files kept aside because merging them would have invented text
    /// neither device wrote.
    pub conflicted_copies: Vec<String>,
    /// True when the JSONL snapshot changed, so the caller must rebuild
    /// app.db from it before the app reads stale rows out of the cache.
    pub state_changed: bool,
    pub failed: Vec<String>,
}

/// Where the outcome of the last pass is recorded, so a screen can say
/// when this device was last in step without running a pass to find out.
const LAST_PASS_FILE: &str = ".hypomnema/sync/last-pass.json";

/// The answer to "am I up to date?", available with no network at all.
///
/// This is what makes offline editing legible rather than merely
/// possible (REQUIREMENTS.md §7): every edit already applies locally the
/// moment it is made, and the queue of things waiting to go up is just
/// the set of files whose content no longer matches what the manifest
/// recorded. Counting them costs a directory walk, not a request, so a
/// phone with no signal can still say exactly what it is holding.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SyncStanding {
    /// Files changed here since the last pass, waiting for the next one.
    #[ts(type = "number")]
    pub pending: usize,
    /// RFC3339 of the last pass that completed, successful or not.
    pub last_pass_at: Option<String>,
    /// Empty when the last pass went through; otherwise why it did not.
    pub last_error: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct LastPass {
    at: String,
    error: Option<String>,
}

/// Records that a pass happened, and how it went. Best effort: a pass
/// that worked must not be reported as failed because its note could not
/// be written.
pub fn record_pass(local_root: &Path, now: &str, error: Option<String>) {
    let path = local_root.join(LAST_PASS_FILE);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string(&LastPass {
        at: now.to_string(),
        error,
    }) {
        let _ = fs::write(path, text);
    }
}

/// What this device is holding, without asking the network.
pub fn standing(local_root: &Path, root: &VaultRoot) -> Result<SyncStanding> {
    let manifest = load_manifest(local_root);
    let mut pending = 0;
    for relative in local_files(local_root)? {
        let remote = root.absolute(&relative);
        let Ok(bytes) = fs::read(local_root.join(&relative)) else {
            continue;
        };
        let known = manifest
            .get(&remote)
            .and_then(|state| state.hash.as_deref());
        if known != Some(content_hash(&bytes).as_str()) {
            pending += 1;
        }
    }
    // A file this device pulled and then deleted is also waiting to go
    // up, and not counting it would report "nothing to send" while a
    // deletion sat here unsent.
    let held: std::collections::BTreeSet<String> = local_files(local_root)?
        .into_iter()
        .map(|relative| root.absolute(&relative))
        .collect();
    pending += manifest.keys().filter(|key| !held.contains(*key)).count();

    let last: Option<LastPass> = fs::read_to_string(local_root.join(LAST_PASS_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok());
    Ok(SyncStanding {
        pending,
        last_pass_at: last.as_ref().map(|l| l.at.clone()),
        last_error: last.and_then(|l| l.error),
    })
}

fn base_path(local_root: &Path, relative: &str) -> PathBuf {
    crate::sync_bootstrap::space_dir(local_root)
        .join(BASE_DIR)
        .join(relative)
}

fn read_base(local_root: &Path, relative: &str) -> Option<String> {
    fs::read_to_string(base_path(local_root, relative)).ok()
}

pub(crate) fn write_base(local_root: &Path, relative: &str, bytes: &[u8]) -> Result<()> {
    let path = base_path(local_root, relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, bytes)?;
    Ok(())
}

fn forget_base(local_root: &Path, relative: &str) {
    let _ = fs::remove_file(base_path(local_root, relative));
}

/// Below this many synced files a large share vanishing is ordinary
/// housekeeping (three of five notes deleted), not a sign of a wipe.
const GUARD_MIN_FILES: usize = 10;

/// Refuses a pass in which most of what this device had synced is gone
/// from the remote at once. A remote whose data was wiped (the app's
/// hidden Drive folder cleared from the account settings) or a different
/// account behind the link looks, file by file, exactly like the other
/// device deleting everything - and applying it would delete the vault
/// here too. `percent` of the known files is the line (100 turns the
/// guard off). Nothing has been touched when this returns `Err`.
fn guard_mass_deletion(
    manifest: &BTreeMap<String, FileState>,
    remote_live: &BTreeMap<String, String>,
    percent: u32,
) -> Result<()> {
    let known = manifest.len();
    if known < GUARD_MIN_FILES {
        return Ok(());
    }
    let gone = manifest
        .keys()
        .filter(|path| !remote_live.contains_key(*path))
        .count();
    if gone * 100 > known * percent.min(100) as usize {
        return Err(Error::RemoteWiped { known, gone });
    }
    Ok(())
}

/// `journal/2026-09-08.md` -> `journal/2026-09-08 (conflicted copy phone
/// 2026-09-08).md`. Named after the device and the day rather than a
/// counter so two of them from different devices never collide, and so
/// the file says on its face where it came from.
pub fn conflicted_copy_path(relative: &str, device: &str, day: &str) -> String {
    let (dir, name) = match relative.rsplit_once('/') {
        Some((dir, name)) => (format!("{dir}/"), name),
        None => (String::new(), relative),
    };
    let (stem, extension) = match name.rsplit_once('.') {
        // A dotfile (".hypomnemaignore") is all extension and no stem.
        Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
        _ => (name, String::new()),
    };
    format!("{dir}{stem} (conflicted copy {device} {day}){extension}")
}

/// Everything this device holds that belongs to the shared vault.
fn local_files(local_root: &Path) -> Result<Vec<String>> {
    let mut found = Vec::new();
    walk(local_root, local_root, &mut found)?;
    found.sort();
    Ok(found)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            walk(root, &path, out)?;
            continue;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let relative = relative.to_string_lossy().replace('\\', "/");
        if sync_paths::is_synced(&relative) {
            out.push(relative);
        }
    }
    Ok(())
}

/// What one incoming file turned into.
enum Incoming {
    /// The local copy was replaced by the remote one.
    Downloaded,
    /// Both ends had changed it and this pass reconciled them.
    Merged,
    /// Nothing to do.
    Unchanged,
}

struct Context<'a> {
    local_root: &'a Path,
    device: &'a str,
    /// RFC3339 UTC; the day half names conflicted copies.
    now: &'a str,
}

impl Context<'_> {
    fn day(&self) -> &str {
        self.now.split('T').next().unwrap_or(self.now)
    }
}

/// Applies one remote file over the local vault, merging when both ends
/// moved. Returns what it did plus anything the merge had to choose
/// between.
fn apply_incoming(
    ctx: &Context<'_>,
    relative: &str,
    remote_bytes: &[u8],
    known: Option<&FileState>,
    out: &mut Vec<ConflictEntry>,
    conflicted_copies: &mut Vec<String>,
) -> Result<Incoming> {
    let target = ctx.local_root.join(relative);
    let local_bytes = fs::read(&target).ok();

    let changed_here = match (&local_bytes, known.and_then(|s| s.hash.as_deref())) {
        // Never seen here before: nothing local to lose.
        (Some(_), None) => true,
        (Some(bytes), Some(hash)) => content_hash(bytes) != hash,
        // Gone locally. A file this device pulled and then deleted is a
        // deletion, handled by `push_deletions`, not here; one it never
        // pulled is simply new.
        (None, _) => false,
    };

    let Some(local_bytes) = local_bytes else {
        write_local(&target, remote_bytes)?;
        if sync_state::state_file_of(relative).is_some() {
            write_base(ctx.local_root, relative, remote_bytes)?;
        }
        return Ok(Incoming::Downloaded);
    };

    if local_bytes == remote_bytes {
        return Ok(Incoming::Unchanged);
    }

    // A config file this device only ever held as the seeded sample - a
    // vault started here before it first synced - carries nothing to
    // keep: the other device's real rules simply replace it.
    if !changed_here || vault::is_untouched_sample(relative, &local_bytes) {
        // Only they moved: take theirs, and it becomes the agreed base.
        write_local(&target, remote_bytes)?;
        if sync_state::state_file_of(relative).is_some() {
            write_base(ctx.local_root, relative, remote_bytes)?;
        }
        return Ok(Incoming::Downloaded);
    }

    // Both moved.
    if let Some(kind) = sync_state::state_file_of(relative) {
        let base = read_base(ctx.local_root, relative);
        let local_text = String::from_utf8_lossy(&local_bytes).into_owned();
        let remote_text = String::from_utf8_lossy(remote_bytes).into_owned();
        let merged =
            sync_state::merge_state_file(kind, base.as_deref(), &local_text, &remote_text)?;
        fs::write(&target, merged.text.as_bytes())?;
        // The base for the *next* merge is what the other side had: the
        // merged content has not been agreed on until it is uploaded, and
        // the upload records it (see `adopt_pushed_base`).
        write_base(ctx.local_root, relative, remote_bytes)?;
        out.extend(sync_conflicts::entries_from(
            relative,
            ctx.now,
            merged.conflicts,
        ));
        return Ok(Incoming::Merged);
    }

    // Prose. Keep both, name the loser after this device.
    let copy = conflicted_copy_path(relative, ctx.device, ctx.day());
    write_local(&ctx.local_root.join(&copy), &local_bytes)?;
    write_local(&target, remote_bytes)?;
    conflicted_copies.push(copy.clone());
    out.extend(sync_conflicts::entries_from(
        relative,
        ctx.now,
        [FieldConflict {
            field: "<file>".into(),
            kept: serde_json::Value::String(format!(
                "the other device's version, now at {relative}"
            )),
            kept_updated_by: String::new(),
            discarded: serde_json::Value::String(format!("this device's version, kept as {copy}")),
            discarded_updated_by: ctx.device.to_string(),
        }],
    ));
    Ok(Incoming::Merged)
}

/// Folds an extra copy of a path (`SyncProvider::take_duplicates`) into
/// the local file, which by now holds the canonical copy. There is no
/// agreed base between the two - each was created without knowing the
/// other - so state files are merged as a union, and differing prose is
/// kept beside the file as a conflicted copy. The merged result goes up
/// with this pass's push. `Some(changed)` once the copy's content is safe
/// locally; `None` when there is nothing local to merge it into yet (the
/// canonical copy failed to come down), so it must not be discarded.
fn apply_duplicate(
    ctx: &Context<'_>,
    relative: &str,
    bytes: &[u8],
    out: &mut Vec<ConflictEntry>,
    conflicted_copies: &mut Vec<String>,
) -> Result<Option<bool>> {
    let target = ctx.local_root.join(relative);
    let Ok(local_bytes) = fs::read(&target) else {
        return Ok(None);
    };
    if local_bytes == bytes {
        return Ok(Some(false));
    }
    if let Some(kind) = sync_state::state_file_of(relative) {
        let local_text = String::from_utf8_lossy(&local_bytes).into_owned();
        let other_text = String::from_utf8_lossy(bytes).into_owned();
        let merged = sync_state::merge_state_file(kind, None, &local_text, &other_text)?;
        fs::write(&target, merged.text.as_bytes())?;
        out.extend(sync_conflicts::entries_from(
            relative,
            ctx.now,
            merged.conflicts,
        ));
        return Ok(Some(true));
    }
    let copy = conflicted_copy_path(relative, "duplicate", ctx.day());
    write_local(&ctx.local_root.join(&copy), bytes)?;
    conflicted_copies.push(copy.clone());
    out.extend(sync_conflicts::entries_from(
        relative,
        ctx.now,
        [FieldConflict {
            field: "<file>".into(),
            kept: serde_json::Value::String(format!("one device's version, at {relative}")),
            kept_updated_by: String::new(),
            discarded: serde_json::Value::String(format!(
                "the other device's version, created at the same time, kept as {copy}"
            )),
            discarded_updated_by: String::new(),
        }],
    ));
    Ok(Some(true))
}

fn write_local(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, bytes)?;
    Ok(())
}

/// Runs a full pass. `now` is RFC3339 UTC, injected so the tests are not
/// at the mercy of the clock.
pub fn sync_vault<P: SyncProvider>(
    provider: &P,
    local_root: &Path,
    root: &VaultRoot,
    device: &str,
    now: &str,
    guard_percent: u32,
    mut on_progress: impl FnMut(usize, usize),
) -> Result<SyncReport> {
    let ctx = Context {
        local_root,
        device,
        now,
    };
    let mut report = SyncReport::default();
    let mut manifest = load_manifest(local_root);
    let mut conflicts: Vec<ConflictEntry> = Vec::new();

    let (changes, _cursor) = provider.list_changes(&SyncCursor::default())?;
    let mut remote_live: BTreeMap<String, String> = BTreeMap::new();
    let mut remote_gone: Vec<String> = Vec::new();
    for change in changes {
        let path = change.path.trim_start_matches('/').to_string();
        let Some(relative) = root.relative(&path) else {
            continue;
        };
        if !sync_paths::is_synced(relative) {
            continue;
        }
        if change.deleted {
            remote_gone.push(path);
        } else if let ChangeMarker::Rev(rev) = change.marker {
            remote_live.insert(path, rev);
        }
    }

    guard_mass_deletion(&manifest, &remote_live, guard_percent)?;

    // The listing is always full, so a file this device has synced that
    // is no longer in it was deleted over there - whether or not the
    // backend reports tombstones (Google Drive does not).
    for remote in manifest.keys() {
        let synced = root.relative(remote).is_some_and(sync_paths::is_synced);
        if synced && !remote_live.contains_key(remote) && !remote_gone.contains(remote) {
            remote_gone.push(remote.clone());
        }
    }

    // --- Incoming ------------------------------------------------------
    let total = remote_live.len();
    for (done, (remote, rev)) in remote_live.iter().enumerate() {
        on_progress(done + 1, total);
        let relative = match root.relative(remote) {
            Some(relative) => relative.to_string(),
            None => continue,
        };
        let known = manifest.get(remote).cloned();
        let seen_this_revision = known.as_ref().is_some_and(|state| &state.rev == rev);
        // Same revision as last time and the file is where it was left:
        // there is nothing on the server to bring down, and whether this
        // device changed it is the push's business.
        if seen_this_revision && local_root.join(&relative).exists() {
            continue;
        }
        // A revision this device already recorded but whose file is gone
        // locally is a deletion made here, not something to re-download.
        if seen_this_revision {
            continue;
        }
        let bytes = match provider.read_file(remote) {
            Ok((bytes, _)) => bytes,
            Err(_) => {
                report.failed.push(remote.clone());
                continue;
            }
        };
        // S8-style resilience: one file that cannot be applied (a merge
        // parse error, a name the local filesystem rejects) is reported,
        // not allowed to abort the pass with the manifest unsaved.
        let applied = match apply_incoming(
            &ctx,
            &relative,
            &bytes,
            known.as_ref(),
            &mut conflicts,
            &mut report.conflicted_copies,
        ) {
            Ok(applied) => applied,
            Err(_) => {
                report.failed.push(remote.clone());
                continue;
            }
        };
        match applied {
            Incoming::Downloaded => report.downloaded += 1,
            Incoming::Merged => report.merged += 1,
            Incoming::Unchanged => {}
        }
        if !matches!(applied, Incoming::Unchanged) && sync_state::state_file_of(&relative).is_some()
        {
            report.state_changed = true;
        }
        manifest.insert(
            remote.clone(),
            FileState {
                rev: rev.clone(),
                // The hash of what *they* have. A merged local file now
                // differs from it, which is exactly how the push below
                // knows to send the merge up.
                hash: Some(content_hash(&bytes)),
            },
        );
    }

    // --- Copies two devices created under one path --------------------
    for duplicate in provider.take_duplicates()? {
        let remote = duplicate.path.trim_start_matches('/');
        let Some(relative) = root.relative(remote) else {
            continue;
        };
        if !sync_paths::is_synced(relative) {
            continue;
        }
        let applied = apply_duplicate(
            &ctx,
            relative,
            &duplicate.bytes,
            &mut conflicts,
            &mut report.conflicted_copies,
        );
        // Only a copy whose content is safely in the local file may go;
        // one that could not be applied is still there next pass.
        match applied {
            Ok(Some(merged)) => {
                if provider.discard_duplicate(&duplicate).is_err() {
                    report.failed.push(remote.to_string());
                }
                if merged {
                    report.merged += 1;
                    if sync_state::state_file_of(relative).is_some() {
                        report.state_changed = true;
                    }
                }
            }
            Ok(None) => {}
            Err(_) => report.failed.push(remote.to_string()),
        }
    }

    // --- Deletions made on the other device ----------------------------
    for remote in &remote_gone {
        let Some(relative) = root.relative(remote) else {
            continue;
        };
        let target = local_root.join(relative);
        let Ok(local_bytes) = fs::read(&target) else {
            manifest.remove(remote);
            continue;
        };
        let known_hash = manifest.get(remote).and_then(|s| s.hash.clone());
        if known_hash.as_deref() == Some(content_hash(&local_bytes).as_str()) {
            // Untouched here since it arrived: the deletion stands.
            fs::remove_file(&target)?;
            forget_base(local_root, relative);
            manifest.remove(remote);
            report.removed_locally += 1;
            if sync_state::state_file_of(relative).is_some() {
                report.state_changed = true;
            }
        } else if known_hash.is_some() {
            // Edited here after it arrived. An edit outranks a deletion -
            // the file stays and the push below puts it back, which is
            // the same call `sync_merge::merge_record` makes for a row.
            manifest.remove(remote);
            conflicts.extend(sync_conflicts::entries_from(
                relative,
                now,
                [FieldConflict {
                    field: "<file>".into(),
                    kept: serde_json::Value::String("edited here, deletion overridden".into()),
                    kept_updated_by: device.to_string(),
                    discarded: serde_json::Value::String("deleted on the other device".into()),
                    discarded_updated_by: String::new(),
                }],
            ));
        } else {
            manifest.remove(remote);
        }
    }

    // --- Deletions made here -------------------------------------------
    let held: std::collections::BTreeSet<String> = local_files(local_root)?
        .into_iter()
        .map(|relative| root.absolute(&relative))
        .collect();
    let vanished: Vec<String> = manifest
        .keys()
        .filter(|remote| !held.contains(*remote) && remote_live.contains_key(*remote))
        .cloned()
        .collect();
    for remote in vanished {
        let Some(state) = manifest.get(&remote).cloned() else {
            continue;
        };
        // Guarded by the revision this device last saw: if the other end
        // edited the file after that, Dropbox refuses and the next pass
        // brings their edit down instead of losing it.
        match provider.delete_file(&remote, Some(&ChangeMarker::Rev(state.rev.clone()))) {
            Ok(()) => {
                manifest.remove(&remote);
                if let Some(relative) = root.relative(&remote) {
                    forget_base(local_root, relative);
                }
                report.removed_remotely += 1;
            }
            Err(Error::SyncConflict { .. }) => {
                // Their edit wins over this deletion; drop the manifest
                // entry so the next pass downloads it as new.
                manifest.remove(&remote);
                if let Some(relative) = root.relative(&remote) {
                    conflicts.extend(sync_conflicts::entries_from(
                        relative,
                        now,
                        [FieldConflict {
                            field: "<file>".into(),
                            kept: serde_json::Value::String(
                                "edited on the other device, deletion not applied".into(),
                            ),
                            kept_updated_by: String::new(),
                            discarded: serde_json::Value::String("deleted here".into()),
                            discarded_updated_by: device.to_string(),
                        }],
                    ));
                }
            }
            Err(_) => report.failed.push(remote.clone()),
        }
    }
    save_manifest(local_root, &manifest)?;

    // --- Outgoing ------------------------------------------------------
    let push = sync_push::push_vault(provider, local_root, root, |_, _| {})?;
    report.uploaded = push.uploaded;
    report.failed.extend(push.failed);
    // Whatever went up is now what both devices agree on.
    for relative in push
        .sent
        .iter()
        .filter_map(|remote| root.relative(remote))
        .filter(|relative| sync_state::state_file_of(relative).is_some())
    {
        if let Ok(bytes) = fs::read(local_root.join(relative)) {
            write_base(local_root, relative, &bytes)?;
        }
    }
    // A file the server moved on between the listing and the upload. Rare,
    // and the next pass merges it - saying so beats claiming a clean sync.
    for remote in push.conflicts {
        if let Some(relative) = root.relative(&remote) {
            conflicts.extend(sync_conflicts::entries_from(
                relative,
                now,
                [FieldConflict {
                    field: "<file>".into(),
                    kept: serde_json::Value::String(
                        "the other device's version; run sync again to merge it".into(),
                    ),
                    kept_updated_by: String::new(),
                    discarded: serde_json::Value::String("not uploaded this pass".into()),
                    discarded_updated_by: device.to_string(),
                }],
            ));
        }
    }

    report.conflicts = conflicts.len();
    sync_conflicts::append(local_root, conflicts)?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_provider::mock::MockProvider;

    const NOW: &str = "2026-09-08T12:00:00Z";

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hypomnema-cycle-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn root() -> VaultRoot {
        VaultRoot("vault/".into())
    }

    fn write(root_dir: &Path, relative: &str, contents: &str) {
        let path = root_dir.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    fn read(root_dir: &Path, relative: &str) -> String {
        fs::read_to_string(root_dir.join(relative)).unwrap()
    }

    /// A device that has synced once: the file is on disk, on the server,
    /// and recorded in the manifest as agreed.
    fn in_sync(provider: &MockProvider, local: &Path, relative: &str, contents: &str) {
        let remote = root().absolute(relative);
        let marker = provider
            .write_file(&remote, contents.as_bytes(), None)
            .unwrap();
        write(local, relative, contents);
        let ChangeMarker::Rev(rev) = marker else {
            unreachable!()
        };
        let mut manifest = load_manifest(local);
        manifest.insert(
            remote,
            FileState {
                rev,
                hash: Some(content_hash(contents.as_bytes())),
            },
        );
        save_manifest(local, &manifest).unwrap();
        if sync_state::state_file_of(relative).is_some() {
            write_base(local, relative, contents.as_bytes()).unwrap();
        }
    }

    fn sync(provider: &MockProvider, local: &Path) -> SyncReport {
        sync_vault(provider, local, &root(), "phone", NOW, 30, |_, _| {}).unwrap()
    }

    #[test]
    fn a_quiet_vault_makes_no_changes_at_all() {
        let local = temp_dir("quiet");
        let provider = MockProvider::new();
        in_sync(&provider, &local, "journal/a.md", "unchanged");

        let report = sync(&provider, &local);

        assert_eq!(report, SyncReport::default());
    }

    #[test]
    fn a_note_written_on_the_other_device_arrives() {
        let local = temp_dir("incoming");
        let provider = MockProvider::new();
        provider
            .write_file("vault/journal/new.md", b"from the desktop", None)
            .unwrap();

        let report = sync(&provider, &local);

        assert_eq!(report.downloaded, 1);
        assert_eq!(read(&local, "journal/new.md"), "from the desktop");
    }

    #[test]
    fn a_note_edited_only_here_goes_up_untouched() {
        let local = temp_dir("outgoing");
        let provider = MockProvider::new();
        in_sync(&provider, &local, "journal/a.md", "before");
        write(&local, "journal/a.md", "after");

        let report = sync(&provider, &local);

        assert_eq!(report.uploaded, 1);
        assert_eq!(report.merged, 0);
        assert_eq!(
            provider.read_file("vault/journal/a.md").unwrap().0,
            b"after"
        );
    }

    #[test]
    fn a_note_edited_only_there_comes_down_over_the_local_copy() {
        let local = temp_dir("incoming-edit");
        let provider = MockProvider::new();
        in_sync(&provider, &local, "journal/a.md", "before");
        let (_, marker) = provider.read_file("vault/journal/a.md").unwrap();
        provider
            .write_file("vault/journal/a.md", b"their edit", Some(&marker))
            .unwrap();

        let report = sync(&provider, &local);

        assert_eq!(report.downloaded, 1);
        assert_eq!(report.uploaded, 0);
        assert_eq!(read(&local, "journal/a.md"), "their edit");
    }

    #[test]
    fn a_journal_entry_written_on_both_devices_keeps_both_versions() {
        let local = temp_dir("prose-conflict");
        let provider = MockProvider::new();
        in_sync(&provider, &local, "journal/a.md", "shared start");
        let (_, marker) = provider.read_file("vault/journal/a.md").unwrap();
        provider
            .write_file("vault/journal/a.md", b"their afternoon", Some(&marker))
            .unwrap();
        write(&local, "journal/a.md", "my afternoon");

        let report = sync(&provider, &local);

        assert_eq!(report.merged, 1);
        // Theirs is at the real path; mine is beside it, named after this
        // device - nothing was overwritten and nothing was invented.
        assert_eq!(read(&local, "journal/a.md"), "their afternoon");
        let copy = "journal/a (conflicted copy phone 2026-09-08).md";
        assert_eq!(read(&local, copy), "my afternoon");
        assert_eq!(report.conflicted_copies, vec![copy.to_string()]);
        // And the kept-aside copy travels, so the other device sees it too.
        assert_eq!(
            provider.read_file(&root().absolute(copy)).unwrap().0,
            b"my afternoon"
        );
        assert_eq!(sync_conflicts::load(&local).len(), 1);
    }

    #[test]
    fn a_seeded_sample_config_gives_way_to_the_other_devices_rules() {
        let local = temp_dir("sample-config");
        let provider = MockProvider::new();
        let path = ".hypomnema/config/birthdays.yml";
        let (_, sample) = vault::CONFIG_SAMPLES
            .iter()
            .find(|(name, _)| *name == "birthdays.yml")
            .unwrap();
        write(&local, path, sample);
        let real = "birthdays:\n  - name: Ann\n    date: \"03-14\"\n";
        provider
            .write_file(&root().absolute(path), real.as_bytes(), None)
            .unwrap();

        let report = sync(&provider, &local);

        assert_eq!(read(&local, path), real);
        assert!(report.conflicted_copies.is_empty());
        assert!(sync_conflicts::load(&local).is_empty());
    }

    #[test]
    fn a_task_added_on_each_device_survives_the_pass() {
        let local = temp_dir("state-merge");
        let provider = MockProvider::new();
        let path = ".hypomnema/state/tasks.jsonl";
        let base = "{\"id\":1,\"title\":\"shared\",\"updated_at\":\"t0\",\"updated_by\":\"d\"}\n";
        in_sync(&provider, &local, path, base);

        let mine = format!(
            "{base}{{\"id\":2,\"title\":\"mine\",\"updated_at\":\"t1\",\"updated_by\":\"phone\"}}\n"
        );
        write(&local, path, &mine);
        let theirs = format!(
            "{base}{{\"id\":3,\"title\":\"theirs\",\"updated_at\":\"t1\",\"updated_by\":\"desk\"}}\n"
        );
        let (_, marker) = provider.read_file(&root().absolute(path)).unwrap();
        provider
            .write_file(&root().absolute(path), theirs.as_bytes(), Some(&marker))
            .unwrap();

        let report = sync(&provider, &local);

        assert_eq!(report.merged, 1);
        assert!(report.state_changed);
        let merged = read(&local, path);
        assert!(merged.contains("\"mine\""));
        assert!(merged.contains("\"theirs\""));
        assert!(merged.contains("\"shared\""));
        // The merge went up in the same pass, so the other device sees it
        // on its next one rather than a pass later.
        assert_eq!(report.uploaded, 1);
        let uploaded = provider.read_file(&root().absolute(path)).unwrap().0;
        assert_eq!(String::from_utf8(uploaded).unwrap(), merged);
        // And the agreed base moved with it, so the next merge compares
        // against what was actually shared.
        assert_eq!(read_base(&local, path).unwrap(), merged);
    }

    #[test]
    fn a_note_deleted_here_is_deleted_on_the_other_device_too() {
        let local = temp_dir("delete-here");
        let provider = MockProvider::new();
        in_sync(&provider, &local, "journal/gone.md", "text");
        fs::remove_file(local.join("journal/gone.md")).unwrap();

        let report = sync(&provider, &local);

        assert_eq!(report.removed_remotely, 1);
        assert!(provider.read_file("vault/journal/gone.md").is_err());
    }

    #[test]
    fn a_note_this_device_never_pulled_is_not_treated_as_a_deletion() {
        // The case that kept deletion propagation out of the push until
        // now: a file absent locally because a pull failed halfway must
        // not be read as "the user deleted this".
        let local = temp_dir("never-pulled");
        let provider = MockProvider::new();
        provider
            .write_file("vault/journal/theirs.md", b"never fetched here", None)
            .unwrap();
        // Simulate an interrupted pull: nothing local, nothing recorded.
        let report = sync(&provider, &local);

        assert_eq!(report.removed_remotely, 0);
        assert_eq!(report.downloaded, 1);
    }

    #[test]
    fn a_note_deleted_here_but_edited_there_is_kept() {
        let local = temp_dir("delete-vs-edit");
        let provider = MockProvider::new();
        in_sync(&provider, &local, "journal/a.md", "before");
        let (_, marker) = provider.read_file("vault/journal/a.md").unwrap();
        provider
            .write_file("vault/journal/a.md", b"their edit", Some(&marker))
            .unwrap();
        fs::remove_file(local.join("journal/a.md")).unwrap();

        let report = sync(&provider, &local);

        assert_eq!(report.removed_remotely, 0);
        // Their edit is on the server and now on this device as well: an
        // edit outranks a deletion, same call the record merge makes.
        assert_eq!(
            provider.read_file("vault/journal/a.md").unwrap().0,
            b"their edit"
        );
        assert_eq!(read(&local, "journal/a.md"), "their edit");
    }

    #[test]
    fn a_note_deleted_there_and_untouched_here_goes_away_locally() {
        let local = temp_dir("delete-there");
        let provider = MockProvider::new();
        in_sync(&provider, &local, "journal/a.md", "text");
        let (_, marker) = provider.read_file("vault/journal/a.md").unwrap();
        provider
            .delete_file("vault/journal/a.md", Some(&marker))
            .unwrap();

        let report = sync(&provider, &local);

        assert_eq!(report.removed_locally, 1);
        assert!(!local.join("journal/a.md").exists());
    }

    #[test]
    fn a_note_that_simply_stops_being_listed_counts_as_deleted_there() {
        let local = temp_dir("delete-no-tombstone");
        let provider = MockProvider::new();
        in_sync(&provider, &local, "journal/a.md", "text");
        provider.vanish("vault/journal/a.md");

        let report = sync(&provider, &local);

        assert_eq!(report.removed_locally, 1);
        assert!(!local.join("journal/a.md").exists());
        assert_eq!(report.uploaded, 0);
    }

    #[test]
    fn a_task_file_created_twice_at_once_is_merged_and_the_copy_discarded() {
        let local = temp_dir("duplicate-state");
        let provider = MockProvider::new();
        let path = ".hypomnema/state/tasks.jsonl";
        let one = "{\"id\":1,\"title\":\"one\",\"updated_at\":\"t1\",\"updated_by\":\"desk\"}\n";
        let two = "{\"id\":2,\"title\":\"two\",\"updated_at\":\"t1\",\"updated_by\":\"phone\"}\n";
        provider
            .write_file(&root().absolute(path), one.as_bytes(), None)
            .unwrap();
        provider.add_duplicate(&root().absolute(path), two.as_bytes());

        let report = sync(&provider, &local);

        let merged = read(&local, path);
        assert!(merged.contains("\"one\""));
        assert!(merged.contains("\"two\""));
        assert!(report.state_changed);
        assert_eq!(report.uploaded, 1);
        let uploaded = provider.read_file(&root().absolute(path)).unwrap().0;
        assert_eq!(String::from_utf8(uploaded).unwrap(), merged);
        assert_eq!(provider.discarded.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_note_created_twice_at_once_keeps_the_other_as_a_conflicted_copy() {
        let local = temp_dir("duplicate-prose");
        let provider = MockProvider::new();
        provider
            .write_file("vault/journal/a.md", b"first", None)
            .unwrap();
        provider.add_duplicate("vault/journal/a.md", b"second");

        let report = sync(&provider, &local);

        assert_eq!(read(&local, "journal/a.md"), "first");
        let copy = "journal/a (conflicted copy duplicate 2026-09-08).md";
        assert_eq!(read(&local, copy), "second");
        assert_eq!(report.conflicted_copies, vec![copy.to_string()]);
        assert_eq!(provider.discarded.lock().unwrap().len(), 1);
        // The copy goes up as a file of its own.
        assert_eq!(
            provider.read_file(&root().absolute(copy)).unwrap().0,
            b"second"
        );
    }

    #[test]
    fn an_identical_duplicate_is_just_discarded() {
        let local = temp_dir("duplicate-same");
        let provider = MockProvider::new();
        provider
            .write_file("vault/journal/a.md", b"same", None)
            .unwrap();
        provider.add_duplicate("vault/journal/a.md", b"same");

        let report = sync(&provider, &local);

        assert!(report.conflicted_copies.is_empty());
        assert_eq!(report.merged, 0);
        assert_eq!(provider.discarded.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_duplicate_with_nothing_local_to_merge_into_is_kept_for_later() {
        let local = temp_dir("duplicate-unreadable");
        let provider = MockProvider::new();
        provider
            .write_file("vault/journal/a.md", b"first", None)
            .unwrap();
        provider.make_unreadable("vault/journal/a.md");
        provider.add_duplicate("vault/journal/a.md", b"second");

        let report = sync(&provider, &local);

        assert_eq!(report.failed, vec!["vault/journal/a.md".to_string()]);
        assert!(provider.discarded.lock().unwrap().is_empty());
    }

    #[test]
    fn a_note_deleted_there_but_edited_here_survives_and_is_re_uploaded() {
        let local = temp_dir("delete-there-edit-here");
        let provider = MockProvider::new();
        in_sync(&provider, &local, "journal/a.md", "text");
        let (_, marker) = provider.read_file("vault/journal/a.md").unwrap();
        provider
            .delete_file("vault/journal/a.md", Some(&marker))
            .unwrap();
        write(&local, "journal/a.md", "my edit after their delete");

        let report = sync(&provider, &local);

        assert_eq!(report.removed_locally, 0);
        assert_eq!(report.uploaded, 1);
        assert_eq!(
            provider.read_file("vault/journal/a.md").unwrap().0,
            b"my edit after their delete"
        );
        assert_eq!(sync_conflicts::load(&local).len(), 1);
    }

    #[test]
    fn the_database_is_never_uploaded_or_downloaded() {
        let local = temp_dir("no-db");
        let provider = MockProvider::new();
        write(&local, ".hypomnema/app.db", "sqlite");
        provider
            .write_file("vault/.hypomnema/app.db", b"theirs", None)
            .unwrap();

        let report = sync(&provider, &local);

        assert_eq!(report.uploaded, 0);
        assert_eq!(report.downloaded, 0);
        assert_eq!(
            fs::read_to_string(local.join(".hypomnema/app.db")).unwrap(),
            "sqlite"
        );
    }

    #[test]
    fn what_is_waiting_to_go_up_is_answerable_with_no_network() {
        let local = temp_dir("standing");
        let provider = MockProvider::new();
        in_sync(&provider, &local, "journal/a.md", "sent");
        in_sync(&provider, &local, "journal/b.md", "sent");
        assert_eq!(standing(&local, &root()).unwrap().pending, 0);

        // Three kinds of pending change, none of which needs a request
        // to notice: an edit, a new file, and a deletion.
        write(&local, "journal/a.md", "edited offline");
        write(&local, "journal/c.md", "written offline");
        fs::remove_file(local.join("journal/b.md")).unwrap();

        assert_eq!(standing(&local, &root()).unwrap().pending, 3);

        sync(&provider, &local);
        assert_eq!(standing(&local, &root()).unwrap().pending, 0);
    }

    #[test]
    fn a_failed_pass_is_remembered_so_the_screen_can_say_so() {
        let local = temp_dir("last-pass");
        fs::create_dir_all(local.join(".hypomnema/sync")).unwrap();
        record_pass(&local, NOW, Some("no network".into()));

        let standing = standing(&local, &root()).unwrap();

        assert_eq!(standing.last_pass_at.as_deref(), Some(NOW));
        assert_eq!(standing.last_error.as_deref(), Some("no network"));
    }

    #[test]
    fn conflicted_copies_are_named_after_the_device_and_the_day() {
        assert_eq!(
            conflicted_copy_path("journal/2026-09-08.md", "phone", "2026-09-08"),
            "journal/2026-09-08 (conflicted copy phone 2026-09-08).md"
        );
        assert_eq!(
            conflicted_copy_path("Inbox", "phone", "2026-09-08"),
            "Inbox (conflicted copy phone 2026-09-08)"
        );
        // A dotfile is all extension: it must not become
        // " (conflicted copy ...).hypomnemaignore" with an empty name.
        assert_eq!(
            conflicted_copy_path(".hypomnemaignore", "phone", "2026-09-08"),
            ".hypomnemaignore (conflicted copy phone 2026-09-08)"
        );
    }

    #[test]
    fn a_wiped_remote_stops_the_pass_before_anything_is_deleted_here() {
        let local = temp_dir("guard-wiped");
        let provider = MockProvider::new();
        for i in 0..12 {
            in_sync(&provider, &local, &format!("journal/{i}.md"), "text");
        }
        for i in 0..12 {
            let path = format!("vault/journal/{i}.md");
            let (_, marker) = provider.read_file(&path).unwrap();
            provider.delete_file(&path, Some(&marker)).unwrap();
        }

        let err = sync_vault(&provider, &local, &root(), "phone", NOW, 30, |_, _| {}).unwrap_err();

        assert!(matches!(
            err,
            Error::RemoteWiped {
                known: 12,
                gone: 12
            }
        ));
        for i in 0..12 {
            assert!(local.join(format!("journal/{i}.md")).exists());
        }
        assert_eq!(load_manifest(&local).len(), 12);
    }

    #[test]
    fn deleting_a_few_files_out_of_many_passes_the_guard() {
        let local = temp_dir("guard-few");
        let provider = MockProvider::new();
        for i in 0..12 {
            in_sync(&provider, &local, &format!("journal/{i}.md"), "text");
        }
        for i in 0..3 {
            let path = format!("vault/journal/{i}.md");
            let (_, marker) = provider.read_file(&path).unwrap();
            provider.delete_file(&path, Some(&marker)).unwrap();
        }

        let report = sync(&provider, &local);

        assert_eq!(report.removed_locally, 3);
    }

    #[test]
    fn a_guard_of_100_percent_lets_even_a_full_wipe_through() {
        let local = temp_dir("guard-off");
        let provider = MockProvider::new();
        for i in 0..12 {
            in_sync(&provider, &local, &format!("journal/{i}.md"), "text");
        }
        for i in 0..12 {
            let path = format!("vault/journal/{i}.md");
            let (_, marker) = provider.read_file(&path).unwrap();
            provider.delete_file(&path, Some(&marker)).unwrap();
        }

        let report = sync_vault(&provider, &local, &root(), "phone", NOW, 100, |_, _| {}).unwrap();

        assert_eq!(report.removed_locally, 12);
    }
}
