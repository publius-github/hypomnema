//! Line-by-line three-way merge of prose (git's merge, via diffy), shared
//! by the sync pass and by the editors' saves: both meet the same case -
//! two versions of one note that moved apart from a common base.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use crate::error::Result;

/// Held across a read-merge-write of a user file - an editor's save
/// (`journal::save_entry_from`, `kb::write_from`) and a sync pass
/// applying a download (`sync_cycle`) - so neither writes over a change
/// the other made between its read and its write. Local file IO only:
/// nothing that waits on the network or on the vault lock runs under it.
static USER_FILE: Mutex<()> = Mutex::new(());

pub fn user_file_lock() -> MutexGuard<'static, ()> {
    USER_FILE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Text compared the way the merge compares it: CRLF and LF alike.
fn same_text(a: &str, b: &str) -> bool {
    a == b || a.replace("\r\n", "\n") == b.replace("\r\n", "\n")
}

/// What an editor's save turned into.
pub struct Reconciled {
    /// The text to put on disk - the editor's, or the editor's merged
    /// with what changed on disk under it.
    pub text: String,
    /// Where the disk's version went when it could not be merged.
    pub kept_aside: Option<PathBuf>,
}

/// An editor saves the whole text it shows, read some time ago. When the
/// file moved on in between - a sync pass merged the other device's edit
/// in, another program wrote it - writing that text as-is would silently
/// undo the change, and the next pass would carry the undo to the other
/// device too. So the save is a three-way merge: `base` is what the
/// editor's text started from, `on_disk` what is there now. Same lines
/// changed on both sides: the editor's text wins (it is what the user is
/// looking at) and the disk's version is kept beside the file as a
/// conflicted copy, the way a sync conflict is. No `base` (an older
/// caller) or no file: the text is written as given.
pub fn reconcile_save(
    path: &Path,
    on_disk: Option<&str>,
    base: Option<&str>,
    ours: &str,
    day: &str,
) -> Result<Reconciled> {
    let plain = |text: &str| Reconciled {
        text: text.to_string(),
        kept_aside: None,
    };
    let (Some(base), Some(disk)) = (base, on_disk) else {
        return Ok(plain(ours));
    };
    if same_text(disk, base) || same_text(disk, ours) {
        return Ok(plain(ours));
    }
    if let Some(merged) = merge_file(&path.to_string_lossy(), base, ours, disk) {
        return Ok(plain(&merged));
    }
    let copy = unused_copy(path, day);
    crate::vault::write_atomic(&copy, disk)?;
    Ok(Reconciled {
        text: ours.to_string(),
        kept_aside: Some(copy),
    })
}

/// Label of the copy a save keeps aside: the version it could not merge
/// came from somewhere other than this editor.
pub const ELSEWHERE_LABEL: &str = "edited elsewhere";

fn unused_copy(path: &Path, day: &str) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let dir = path.parent().unwrap_or(Path::new(""));
    let mut label = ELSEWHERE_LABEL.to_string();
    let mut n = 2;
    loop {
        let candidate = dir.join(crate::sync_cycle::conflicted_copy_path(&name, &label, day));
        if !candidate.exists() {
            return candidate;
        }
        label = format!("{ELSEWHERE_LABEL} {n}");
        n += 1;
    }
}

/// `merge3` for a file at `path`: a Markdown note's Created / Last
/// edited header (`kb::split_stamps`) is taken off all three versions
/// and merged on its own - the earliest Created, the latest Last edited -
/// because every save through the app rewrites the Last edited line, so
/// two devices editing different paragraphs of one note would otherwise
/// always "both change" that line and never merge.
pub fn merge_file(path: &str, base: &str, ours: &str, theirs: &str) -> Option<String> {
    let markdown = path
        .rsplit_once('.')
        .is_some_and(|(_, ext)| matches!(ext.to_ascii_lowercase().as_str(), "md" | "markdown"));
    if !markdown {
        return merge3(base, ours, theirs);
    }
    let [b, o, t] = [base, ours, theirs].map(crate::kb::split_stamps);
    let created = [&o.0, &t.0, &b.0].into_iter().flatten().min().cloned();
    let edited = [&o.1, &t.1, &b.1].into_iter().flatten().max().cloned();
    if o.0.is_none() && o.1.is_none() && t.0.is_none() && t.1.is_none() {
        return merge3(base, ours, theirs);
    }
    let body = merge3(&b.2, &o.2, &t.2)?;
    let (created, edited) = match (created, edited) {
        (Some(c), Some(e)) => (c, e),
        (Some(c), None) => (c.clone(), c),
        (None, Some(e)) => (e.clone(), e),
        (None, None) => return Some(body),
    };
    Some(crate::kb::with_stamps(&body, &created, &edited))
}

/// Merges `ours` and `theirs` against `base`. `None` when both changed
/// the same lines - the caller decides what to keep aside.
///
/// Line endings are compared as `\n`: a note saved on Windows with CRLF
/// and edited on a phone with LF otherwise differs on every line, and
/// any edit at all would end in a conflict. The result takes `ours`'
/// line endings.
pub fn merge3(base: &str, ours: &str, theirs: &str) -> Option<String> {
    let crlf = ours.contains("\r\n");
    let lf = |s: &str| s.replace("\r\n", "\n");
    let merged = diffy::merge(&lf(base), &lf(ours), &lf(theirs)).ok()?;
    Some(if crlf {
        merged.replace('\n', "\r\n")
    } else {
        merged
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hypomnema-text-merge-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_save_over_a_moved_file_merges_instead_of_undoing() {
        let path = dir("merge").join("n.md");
        // the editor opened "a b c", typed into the first line; a sync
        // meanwhile changed the last one on disk
        let r = reconcile_save(
            &path,
            Some("a\nb\nC\n"),
            Some("a\nb\nc\n"),
            "A\nb\nc\n",
            "d",
        )
        .unwrap();
        assert_eq!(r.text, "A\nb\nC\n");
        assert!(r.kept_aside.is_none());
    }

    #[test]
    fn an_unmergeable_save_keeps_the_disk_version_aside() {
        let root = dir("aside");
        let path = root.join("n.md");
        let r = reconcile_save(
            &path,
            Some("theirs\n"),
            Some("base\n"),
            "ours\n",
            "2026-10-15",
        )
        .unwrap();
        assert_eq!(r.text, "ours\n");
        let copy = r.kept_aside.unwrap();
        assert_eq!(
            copy.file_name().unwrap().to_string_lossy(),
            "n (conflicted copy edited elsewhere 2026-10-15).md"
        );
        assert_eq!(std::fs::read_to_string(&copy).unwrap(), "theirs\n");
        // a second one the same day does not overwrite the first
        let again =
            reconcile_save(&path, Some("t2\n"), Some("base\n"), "o2\n", "2026-10-15").unwrap();
        assert_ne!(again.kept_aside.unwrap(), copy);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_unmoved_file_or_no_base_writes_the_text_as_given() {
        let path = dir("plain").join("n.md");
        let same = reconcile_save(&path, Some("b"), Some("b"), "o", "d").unwrap();
        assert_eq!(same.text, "o");
        let no_base = reconcile_save(&path, Some("x"), None, "o", "d").unwrap();
        assert_eq!(no_base.text, "o");
        assert!(no_base.kept_aside.is_none());
    }

    #[test]
    fn edits_in_different_places_merge() {
        let base = "a\nb\nc\n";
        assert_eq!(
            merge3(base, "A\nb\nc\n", "a\nb\nC\n").as_deref(),
            Some("A\nb\nC\n")
        );
    }

    #[test]
    fn edits_of_the_same_line_do_not_merge() {
        assert_eq!(merge3("a\n", "x\n", "y\n"), None);
    }

    #[test]
    fn crlf_against_lf_merges_and_keeps_our_endings() {
        let base = "a\r\nb\r\nc\r\n";
        let ours = "A\r\nb\r\nc\r\n";
        let theirs = "a\nb\nC\n";
        assert_eq!(
            merge3(base, ours, theirs).as_deref(),
            Some("A\r\nb\r\nC\r\n")
        );
    }

    #[test]
    fn notes_stamped_on_both_devices_still_merge() {
        let base = "Created: 2026-10-01 09:00\nLast edited: 2026-10-10 10:00\n\na\nb\nc\n";
        let ours = "Created: 2026-10-01 09:00\nLast edited: 2026-10-15 08:01\n\nA\nb\nc\n";
        let theirs = "Created: 2026-10-01 09:00\nLast edited: 2026-10-15 08:30\n\na\nb\nC\n";
        assert_eq!(
            merge_file("notes/n.md", base, ours, theirs).as_deref(),
            Some("Created: 2026-10-01 09:00\nLast edited: 2026-10-15 08:30\n\nA\nb\nC\n")
        );
        // the same lines under the header still conflict
        let clash = "Created: 2026-10-01 09:00\nLast edited: 2026-10-15 08:30\n\nX\nb\nc\n";
        assert_eq!(merge_file("n.md", base, ours, clash), None);
    }

    #[test]
    fn stamp_lines_are_only_special_in_markdown() {
        // a YAML key that looks like a stamp is an ordinary line
        assert_eq!(
            merge_file(
                "c.yml",
                "Last edited: 2026-10-01\n",
                "Last edited: 2026-10-02\n",
                "Last edited: 2026-10-03\n"
            ),
            None
        );
    }
}
