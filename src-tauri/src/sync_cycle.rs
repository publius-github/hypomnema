//! One full sync pass: take what the other device wrote, merge it into
//! what this one wrote, send the result back, and propagate deletions.
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
/// possible: every edit already applies locally the
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
    let files = local_files(local_root, &sync_paths::read_user_ignore(local_root))?;
    let mut pending = 0;
    for relative in &files {
        let remote = root.absolute(relative);
        let Ok(bytes) = fs::read(local_root.join(relative)) else {
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
    let held: std::collections::BTreeSet<String> = files
        .iter()
        .map(|relative| root.absolute(relative))
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

/// Text the pass merges line by line when both ends changed it, against
/// the last version they agreed on - git's three-way merge. Prose that
/// two devices edited in different places then needs nobody; only an
/// edit of the same lines on both still ends in a conflicted copy.
fn is_mergeable_text(relative: &str) -> bool {
    let name = relative.rsplit('/').next().unwrap_or(relative);
    name == ".hypomnemaignore"
        || name == sync_paths::SYNC_IGNORE_FILE
        || name.rsplit_once('.').is_some_and(|(_, ext)| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "txt" | "yml" | "yaml"
            )
        })
}

/// Whether a file's agreed version is kept as a merge base: the state
/// snapshot (record merge) and mergeable text (line merge).
pub(crate) fn keeps_base(relative: &str) -> bool {
    sync_state::state_file_of(relative).is_some() || is_mergeable_text(relative)
}

/// `conflicted_copy_path`, stepped past a copy that already exists - a
/// second disagreement over one file on one day must not overwrite the
/// first one's copy.
fn unused_copy_path(local_root: &Path, relative: &str, label: &str, day: &str) -> String {
    let mut copy = conflicted_copy_path(relative, label, day);
    let mut n = 2;
    while local_root.join(&copy).exists() {
        copy = conflicted_copy_path(relative, &format!("{label} {n}"), day);
        n += 1;
    }
    copy
}

fn read_base(local_root: &Path, relative: &str) -> Option<String> {
    fs::read_to_string(base_path(local_root, relative)).ok()
}

pub(crate) fn write_base(local_root: &Path, relative: &str, bytes: &[u8]) -> Result<()> {
    write_local(&base_path(local_root, relative), bytes)
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

/// Everything this device holds that belongs to the shared vault, sorted,
/// under the given `SYNC_IGNORE_FILE` patterns (the pass's own and the
/// push both walk the vault through this).
pub(crate) fn local_files(local_root: &Path, user_ignore: &[String]) -> Result<Vec<String>> {
    let mut found = Vec::new();
    walk(local_root, local_root, user_ignore, &mut found)?;
    found.sort();
    Ok(found)
}

fn walk(root: &Path, dir: &Path, user_ignore: &[String], out: &mut Vec<String>) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            walk(root, &path, user_ignore, out)?;
            continue;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let relative = relative.to_string_lossy().replace('\\', "/");
        if sync_paths::is_synced_with(&relative, user_ignore) {
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

/// A conflict about a whole file rather than one field of a record: which
/// version stayed, which went, and which device each came from ("" when
/// it was not this one).
fn file_conflict(
    kept: impl Into<String>,
    kept_updated_by: &str,
    discarded: impl Into<String>,
    discarded_updated_by: &str,
) -> FieldConflict {
    FieldConflict {
        field: "<file>".into(),
        kept: serde_json::Value::String(kept.into()),
        kept_updated_by: kept_updated_by.to_string(),
        discarded: serde_json::Value::String(discarded.into()),
        discarded_updated_by: discarded_updated_by.to_string(),
    }
}

struct Context<'a> {
    local_root: &'a Path,
    device: &'a str,
    /// What a conflicted copy is named after: "phone" / "desktop" reads
    /// on a file name, a device id does not.
    device_label: &'a str,
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
    // Only a file that is really not there may be replaced outright: one
    // that exists but cannot be read right now (locked by another app,
    // a cloud placeholder offline) may hold edits: the file is reported
    // as failed and the next pass tries again.
    let local_bytes = match fs::read(&target) {
        Ok(bytes) => Some(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(Error::io_at(&target, e)),
    };

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
        if keeps_base(relative) {
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
        if keeps_base(relative) {
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
        write_local(&target, merged.text.as_bytes())?;
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

    // Text with a base: merge the two sets of changes line by line. The
    // base becomes what the other side had, as for the snapshot above;
    // the merged file goes up with this pass.
    if is_mergeable_text(relative) {
        if let (Some(base), Ok(local_text), Ok(remote_text)) = (
            read_base(ctx.local_root, relative),
            std::str::from_utf8(&local_bytes),
            std::str::from_utf8(remote_bytes),
        ) {
            if let Some(merged) =
                crate::text_merge::merge_file(relative, &base, local_text, remote_text)
            {
                write_local(&target, merged.as_bytes())?;
                write_base(ctx.local_root, relative, remote_bytes)?;
                return Ok(Incoming::Merged);
            }
        }
    }

    // Prose the lines of which both sides changed (or no base to tell).
    // Keep both, name the loser after this device.
    let copy = unused_copy_path(ctx.local_root, relative, ctx.device_label, ctx.day());
    write_local(&ctx.local_root.join(&copy), &local_bytes)?;
    write_local(&target, remote_bytes)?;
    conflicted_copies.push(copy.clone());
    out.extend(sync_conflicts::with_copy(
        sync_conflicts::entries_from(
            relative,
            ctx.now,
            [file_conflict(
                format!("the other device's version, now at {relative}"),
                "",
                format!("this device's version, kept as {copy}"),
                ctx.device,
            )],
        ),
        &copy,
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
        write_local(&target, merged.text.as_bytes())?;
        out.extend(sync_conflicts::entries_from(
            relative,
            ctx.now,
            merged.conflicts,
        ));
        return Ok(Some(true));
    }
    let copy = unused_copy_path(ctx.local_root, relative, "duplicate", ctx.day());
    write_local(&ctx.local_root.join(&copy), bytes)?;
    conflicted_copies.push(copy.clone());
    out.extend(sync_conflicts::with_copy(
        sync_conflicts::entries_from(
            relative,
            ctx.now,
            [file_conflict(
                format!("one device's version, at {relative}"),
                "",
                format!("the other device's version, created at the same time, kept as {copy}"),
                "",
            )],
        ),
        &copy,
    ));
    Ok(Some(true))
}

/// Atomic, like every other write of user content: a pass cut short
/// mid-write (a crash, a phone's battery) must not leave a note
/// truncated.
fn write_local(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    vault::write_atomic_bytes(path, bytes)
}

/// The device running a pass: its id stamps the conflict log, its label
/// ("phone" / "desktop") names the conflicted copies it keeps aside.
#[derive(Clone, Copy)]
pub struct DeviceTag<'a> {
    pub id: &'a str,
    pub label: &'a str,
}

/// Copies two devices created under one path at once: merged into the
/// local file (or kept beside it), then discarded on the server - only
/// once their content is safely here.
fn apply_duplicates<P: SyncProvider>(
    provider: &P,
    ctx: &Context<'_>,
    root: &VaultRoot,
    conflicts: &mut Vec<ConflictEntry>,
    report: &mut SyncReport,
) -> Result<()> {
    for duplicate in provider.take_duplicates()? {
        let remote = duplicate.path.trim_start_matches('/');
        let Some(relative) = root.relative(remote) else {
            continue;
        };
        if !sync_paths::is_synced(relative) {
            continue;
        }
        let applied = {
            let _files = crate::text_merge::user_file_lock();
            apply_duplicate(
                ctx,
                relative,
                &duplicate.bytes,
                conflicts,
                &mut report.conflicted_copies,
            )
        };
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
    Ok(())
}

/// Files the other device deleted: gone here too when untouched since
/// they arrived; an edit made here outranks the deletion and goes back
/// up with this pass's push.
fn apply_remote_deletions(
    ctx: &Context<'_>,
    root: &VaultRoot,
    remote_gone: &[String],
    manifest: &mut BTreeMap<String, FileState>,
    conflicts: &mut Vec<ConflictEntry>,
    report: &mut SyncReport,
) -> Result<()> {
    let (local_root, device, now) = (ctx.local_root, ctx.device, ctx.now);
    for remote in remote_gone {
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
                [file_conflict(
                    "edited here, deletion overridden",
                    device,
                    "deleted on the other device",
                    "",
                )],
            ));
        } else {
            manifest.remove(remote);
        }
    }
    Ok(())
}

/// Files deleted here: deleted on the server too, guarded by the revision
/// this device last saw, so an edit made there since is not lost.
fn push_local_deletions<P: SyncProvider>(
    provider: &P,
    ctx: &Context<'_>,
    root: &VaultRoot,
    remote_live: &BTreeMap<String, String>,
    manifest: &mut BTreeMap<String, FileState>,
    conflicts: &mut Vec<ConflictEntry>,
    report: &mut SyncReport,
) -> Result<()> {
    let (local_root, device, now) = (ctx.local_root, ctx.device, ctx.now);
    let held: std::collections::BTreeSet<String> =
        local_files(local_root, &sync_paths::loaded_user_ignore())?
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
        // edited the file after that, the provider refuses and the next pass
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
                        [file_conflict(
                            "edited on the other device, deletion not applied",
                            "",
                            "deleted here",
                            device,
                        )],
                    ));
                }
            }
            Err(_) => report.failed.push(remote.clone()),
        }
    }
    Ok(())
}

/// Runs a full pass. `now` is RFC3339 UTC, injected so the tests are not
/// at the mercy of the clock.
pub fn sync_vault<P: SyncProvider>(
    provider: &P,
    local_root: &Path,
    root: &VaultRoot,
    device: DeviceTag<'_>,
    now: &str,
    guard_percent: u32,
    mut on_progress: impl FnMut(usize, usize),
) -> Result<SyncReport> {
    let DeviceTag {
        id: device,
        label: device_label,
    } = device;
    let ctx = Context {
        local_root,
        device,
        device_label,
        now,
    };
    sync_paths::load_user_ignore(local_root);
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

    // Text synced before bases were kept for it has none yet. A file that
    // still matches what both ends last agreed on is that base, so record
    // it now - else its first edit on both sides could not be merged.
    for (remote, state) in &manifest {
        let (Some(relative), Some(hash)) = (root.relative(remote), state.hash.as_deref()) else {
            continue;
        };
        if !is_mergeable_text(relative) || base_path(local_root, relative).exists() {
            continue;
        }
        if let Ok(bytes) = fs::read(local_root.join(relative)) {
            if content_hash(&bytes) == hash {
                write_base(local_root, relative, &bytes)?;
            }
        }
    }

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
        let outcome = {
            let _files = crate::text_merge::user_file_lock();
            apply_incoming(
                &ctx,
                &relative,
                &bytes,
                known.as_ref(),
                &mut conflicts,
                &mut report.conflicted_copies,
            )
        };
        let applied = match outcome {
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

    apply_duplicates(provider, &ctx, root, &mut conflicts, &mut report)?;
    apply_remote_deletions(
        &ctx,
        root,
        &remote_gone,
        &mut manifest,
        &mut conflicts,
        &mut report,
    )?;
    push_local_deletions(
        provider,
        &ctx,
        root,
        &remote_live,
        &mut manifest,
        &mut conflicts,
        &mut report,
    )?;
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
        .filter(|relative| keeps_base(relative))
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
                [file_conflict(
                    "the other device's version; run sync again to merge it",
                    "",
                    "not uploaded this pass",
                    device,
                )],
            ));
        }
    }

    report.conflicts = conflicts.len();
    sync_conflicts::append(local_root, conflicts)?;
    Ok(report)
}

#[cfg(test)]
mod tests;
