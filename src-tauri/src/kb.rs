use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use crate::error::{Error, IoContext, Result};

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct KbNode {
    pub name: String,
    /// Path relative to the KB root, with '/' separators.
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<KbNode>,
}

/// Where `delete` puts things, at the KB root.
const TRASH_DIR: &str = crate::sync_paths::TRASH_DIR;

/// Refuses to delete, move or rename the app's working folder or what it
/// owns inside it: with the Notes tree rooted at the vault, one stray
/// Delete would otherwise send the open database to the trash. The
/// user-authored `config/` stays fully editable.
fn guard_work_dir(rel: &str) -> Result<()> {
    let parts: Vec<&str> = rel.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    if let Some(i) = parts.iter().position(|p| *p == crate::vault::WORK_DIR) {
        if parts.get(i + 1) != Some(&"config") || parts.len() == i + 2 {
            return Err(Error::State(format!(
                "{rel} belongs to the app and cannot be moved or deleted here"
            )));
        }
    }
    Ok(())
}

/// Rejects absolute paths and traversal; the app must never touch
/// anything outside the user-chosen KB folder.
pub(crate) fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute()
        || rel_path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(Error::State(format!("invalid KB path: {rel}")));
    }
    Ok(root.join(rel_path))
}

/// Name of the gitignore-like file at the KB root listing files and
/// folders to hide from the Notes tree (and thus from search).
pub const IGNORE_FILE: &str = ".hypomnemaignore";

/// Loads the ignore patterns: one per line, `#` comments and blank
/// lines skipped.
fn load_ignore(root: &Path) -> Vec<String> {
    load_patterns(&root.join(IGNORE_FILE))
}

/// Reads a gitignore-like pattern file (`.hypomnemaignore`,
/// `.hypomnemasyncignore`); a missing file is no patterns.
pub(crate) fn load_patterns(path: &Path) -> Vec<String> {
    fs::read_to_string(path)
        .map(|content| {
            content
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty() && !l.starts_with('#'))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Simple wildcard match: `*` spans any run of characters, `?` exactly
/// one. Enough for `*.db`-style rules without pulling in a glob crate.
fn glob_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    // iterative matcher with backtracking over the last `*`
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut star, mut mark) = (usize::MAX, 0usize);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = pi;
            mark = ti;
            pi += 1;
        } else if star != usize::MAX {
            pi = star + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

/// Gitignore-flavored subset: a pattern with `/` matches the path
/// relative to the KB root, one without matches the file or folder
/// name anywhere; a trailing `/` restricts the rule to folders.
pub(crate) fn is_ignored(patterns: &[String], name: &str, rel: &str, is_dir: bool) -> bool {
    patterns.iter().any(|raw| {
        let (pattern, dir_only) = match raw.strip_suffix('/') {
            Some(p) => (p, true),
            None => (raw.as_str(), false),
        };
        if dir_only && !is_dir {
            return false;
        }
        if pattern.contains('/') {
            glob_match(pattern.trim_start_matches('/'), rel)
        } else {
            glob_match(pattern, name)
        }
    })
}

fn read_dir_sorted(dir: &Path) -> Result<Vec<fs::DirEntry>> {
    let mut entries: Vec<fs::DirEntry> = fs::read_dir(dir)?.collect::<std::io::Result<_>>()?;
    entries.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
    Ok(entries)
}

fn build_tree(root: &Path, dir: &Path, ignore: &[String]) -> Result<Vec<KbNode>> {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    for entry in read_dir_sorted(dir)? {
        let name = entry.file_name().to_string_lossy().into_owned();
        // the tree shows everything (dotfiles and .hypomnema included);
        // hiding is the user's call via .hypomnemaignore. Only our own
        // write_atomic staging files stay out - they exist for
        // milliseconds and would make the tree flicker.
        if crate::vault::is_staging_file(&name) {
            continue;
        }
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .map_err(|_| Error::State("path outside KB root".into()))?
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        let is_dir = entry.file_type()?.is_dir();
        if is_ignored(ignore, &name, &rel, is_dir) {
            continue;
        }
        if is_dir {
            dirs.push(KbNode {
                name,
                path: rel,
                is_dir: true,
                children: build_tree(root, &path, ignore)?,
            });
        } else {
            files.push(KbNode {
                name,
                path: rel,
                is_dir: false,
                children: vec![],
            });
        }
    }
    dirs.extend(files);
    Ok(dirs)
}

/// The KB folder is never restructured by the app: the tree is read
/// as-is and shows every file and folder (dotfiles and .hypomnema
/// included) minus whatever .hypomnemaignore at the KB root filters
/// out - hiding is entirely the user's call.
pub fn tree(root: &Path) -> Result<Vec<KbNode>> {
    if !root.is_dir() {
        return Err(Error::State(format!(
            "KB folder does not exist: {}",
            root.display()
        )));
    }
    let ignore = load_ignore(root);
    build_tree(root, root, &ignore)
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct KbSearchHit {
    pub path: String,
    pub name: String,
    #[ts(type = "number")]
    pub line: usize,
    pub preview: String,
}

pub(crate) const SEARCH_MAX_HITS: usize = 100;
pub(crate) const SEARCH_MAX_FILE_BYTES: u64 = 2_000_000;

fn collect_files(nodes: &[KbNode], out: &mut Vec<(String, String)>) {
    for node in nodes {
        if node.is_dir {
            collect_files(&node.children, out);
        } else {
            out.push((node.path.clone(), node.name.clone()));
        }
    }
}

/// Case-insensitive substring search over note contents (one hit per
/// file, first matching line as preview). Plain scan - at personal
/// scale an index is not worth its invalidation bugs.
pub fn search_content(root: &Path, query: &str) -> Result<Vec<KbSearchHit>> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(vec![]);
    }
    let mut files = Vec::new();
    collect_files(&tree(root)?, &mut files);
    let mut hits = Vec::new();
    for (path, name) in files {
        let abs = resolve(root, &path)?;
        if fs::metadata(&abs).map(|m| m.len()).unwrap_or(u64::MAX) > SEARCH_MAX_FILE_BYTES {
            continue;
        }
        // read_to_string also skips binary files (invalid UTF-8)
        let Ok(content) = fs::read_to_string(&abs) else {
            continue;
        };
        for (i, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&query) {
                hits.push(KbSearchHit {
                    path,
                    name,
                    line: i + 1,
                    preview: line.trim().chars().take(120).collect(),
                });
                break;
            }
        }
        if hits.len() >= SEARCH_MAX_HITS {
            break;
        }
    }
    Ok(hits)
}

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct KbBacklinks {
    /// Files whose [[wiki links]] point at the note.
    pub links: Vec<KbSearchHit>,
    /// Files mentioning the note's name outside a wiki link.
    pub mentions: Vec<KbSearchHit>,
}

/// The `[[target]]` spans of a line, lowercased and trimmed.
pub(crate) fn wiki_targets(line: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        targets.push(after[..end].trim().to_lowercase());
        rest = &after[end + 2..];
    }
    targets
}

/// Minimum name length for unlinked mentions: a one- or two-letter note
/// name as a plain substring would match half the vault.
pub(crate) const MENTION_MIN_CHARS: usize = 3;

/// Backlinks of a note: files whose `[[wiki links]]` point at it (the
/// target is the note's file name, extension optional, case-insensitive),
/// plus unlinked mentions - lines containing the note's name as plain
/// text. One hit per file per group, first matching line as the preview;
/// a file with a real link never doubles as a mention, and the note
/// itself is skipped. Plain scan, same trade-off as `search_content`.
pub fn backlinks(root: &Path, rel: &str) -> Result<KbBacklinks> {
    let stem = Path::new(rel)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let full_name = Path::new(rel)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let mut result = KbBacklinks {
        links: Vec::new(),
        mentions: Vec::new(),
    };
    if stem.is_empty() {
        return Ok(result);
    }
    let mut files = Vec::new();
    collect_files(&tree(root)?, &mut files);
    for (path, name) in files {
        if path == rel {
            continue;
        }
        let abs = resolve(root, &path)?;
        if fs::metadata(&abs).map(|m| m.len()).unwrap_or(u64::MAX) > SEARCH_MAX_FILE_BYTES {
            continue;
        }
        let Ok(content) = fs::read_to_string(&abs) else {
            continue;
        };
        let mut link_hit: Option<KbSearchHit> = None;
        let mut mention_hit: Option<KbSearchHit> = None;
        for (i, line) in content.lines().enumerate() {
            let hit = |line: &str| KbSearchHit {
                path: path.clone(),
                name: name.clone(),
                line: i + 1,
                preview: line.trim().chars().take(120).collect(),
            };
            if link_hit.is_none()
                && wiki_targets(line)
                    .iter()
                    .any(|t| *t == stem || *t == full_name)
            {
                link_hit = Some(hit(line));
                break; // a link wins over any mention in this file
            }
            if mention_hit.is_none()
                && stem.chars().count() >= MENTION_MIN_CHARS
                && line.to_lowercase().contains(&stem)
            {
                mention_hit = Some(hit(line));
            }
        }
        if let Some(hit) = link_hit {
            result.links.push(hit);
        } else if let Some(hit) = mention_hit {
            result.mentions.push(hit);
        }
        if result.links.len() >= SEARCH_MAX_HITS && result.mentions.len() >= SEARCH_MAX_HITS {
            break;
        }
    }
    result.links.truncate(SEARCH_MAX_HITS);
    result.mentions.truncate(SEARCH_MAX_HITS);
    Ok(result)
}

pub fn read(root: &Path, rel: &str) -> Result<String> {
    let path = resolve(root, rel)?;
    fs::read_to_string(&path).at(&path)
}

/// Writes a note. With `stamp` (a Markdown note, timestamps on) the
/// Created / Last edited header is put on first. Returns the text that
/// is now on disk, so the editor can take the header over; a save that
/// changes nothing is not rewritten.
#[cfg(test)]
pub fn write(root: &Path, rel: &str, content: &str, stamp: bool) -> Result<String> {
    write_from(root, rel, content, None, stamp).map(|(text, _)| text)
}

/// `write` for an editor whose text started out as `base`: what changed
/// on disk since then is merged in rather than overwritten
/// (`text_merge::reconcile_save`); the second half is where the disk's
/// version went when it could not be merged.
pub fn write_from(
    root: &Path,
    rel: &str,
    content: &str,
    base: Option<&str>,
    stamp: bool,
) -> Result<(String, Option<PathBuf>)> {
    let path = resolve(root, rel)?;
    let _files = crate::text_merge::user_file_lock();
    let on_disk = fs::read_to_string(&path).ok();
    let day = chrono::Local::now().format("%Y-%m-%d").to_string();
    let saved = crate::text_merge::reconcile_save(&path, on_disk.as_deref(), base, content, &day)?;
    let kept_aside = saved.kept_aside;
    let content = if stamp {
        let now = chrono::Local::now().format(STAMP_FORMAT).to_string();
        let (created, modified) = file_times(&path).unwrap_or_else(|| (now.clone(), now.clone()));
        stamp_note(&saved.text, on_disk.as_deref(), &created, &modified, &now)
    } else {
        saved.text
    };
    if on_disk.as_deref() == Some(content.as_str()) {
        return Ok((content, kept_aside));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).at(parent)?;
    }
    // Notes are primary user data: a crash mid-autosave must not
    // truncate the file, same guarantee the YAML configs already have.
    crate::vault::write_atomic(&path, &content)?;
    Ok((content, kept_aside))
}

/// The two ownership lines the app keeps at the top of a Markdown note:
/// when it was created, and when its text last changed through the app.
/// Plain `Label: value` lines, so they read as-is in any editor; they
/// double as YAML keys, and a note with a frontmatter block keeps them
/// inside it, where other tools look for metadata.
pub const CREATED_LABEL: &str = "Created:";
pub const EDITED_LABEL: &str = "Last edited:";
/// Local time, minute resolution.
pub const STAMP_FORMAT: &str = "%Y-%m-%d %H:%M";
/// How many lines (past the frontmatter, if any) are searched for the
/// header: a line typed above it must not make the app lose the header
/// and write a second one.
const HEADER_SCAN_LINES: usize = 8;

/// `YYYY-MM-DD`, optionally followed by ` HH:MM`: a date corrected by
/// hand without a time is still the user's own statement and is kept.
fn is_stamp(value: &str) -> bool {
    let b = value.as_bytes();
    let date = b.len() >= 10
        && b[..10].iter().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        });
    date && match &b[10..] {
        [] => true,
        [b' ', h1, h2, b':', m1, m2] => [h1, h2, m1, m2].iter().all(|c| c.is_ascii_digit()),
        _ => false,
    }
}

fn line_text(line: &str) -> &str {
    line.trim_end_matches(['\n', '\r'])
}

fn stamp_of(line: &str, label: &str) -> Option<String> {
    let value = line_text(line).strip_prefix(label)?.trim();
    is_stamp(value).then(|| value.to_string())
}

/// Index of the closing fence when the text opens with a `---`
/// frontmatter block.
fn frontmatter_end(lines: &[&str]) -> Option<usize> {
    if lines.first().map(|l| line_text(l)) != Some("---") {
        return None;
    }
    lines
        .iter()
        .skip(1)
        .position(|l| matches!(line_text(l), "---" | "..."))
        .map(|i| i + 1)
}

struct NoteHeader {
    created: Option<String>,
    edited: Option<String>,
    /// The note with the header lines (and the plain layout's blank
    /// separator) taken out.
    body: String,
}

fn split_header(content: &str) -> NoteHeader {
    let lines: Vec<&str> = content.split_inclusive('\n').collect();
    let fm_end = frontmatter_end(&lines);
    let scan_from = usize::from(fm_end.is_some());
    let scan_to = fm_end.map_or(0, |end| end + 1) + HEADER_SCAN_LINES;
    let mut dropped = vec![false; lines.len()];
    let (mut created, mut edited) = (None, None);
    for (i, line) in lines.iter().enumerate().take(scan_to).skip(scan_from) {
        if Some(i) == fm_end {
            continue;
        }
        if created.is_none() {
            if let Some(value) = stamp_of(line, CREATED_LABEL) {
                created = Some(value);
                dropped[i] = true;
                continue;
            }
        }
        if edited.is_none() {
            if let Some(value) = stamp_of(line, EDITED_LABEL) {
                edited = Some(value);
                dropped[i] = true;
            }
        }
    }
    // the blank line the plain layout puts under the header goes with it
    if let Some(last) = dropped.iter().rposition(|d| *d) {
        let in_frontmatter = fm_end.is_some_and(|end| last < end);
        if !in_frontmatter
            && lines
                .get(last + 1)
                .is_some_and(|l| line_text(l).trim().is_empty())
        {
            dropped[last + 1] = true;
        }
    }
    let body = lines
        .iter()
        .zip(&dropped)
        .filter(|(_, gone)| !**gone)
        .map(|(line, _)| *line)
        .collect();
    NoteHeader {
        created,
        edited,
        body,
    }
}

fn render_header(body: &str, created: &str, edited: &str) -> String {
    let eol = if body.contains("\r\n") { "\r\n" } else { "\n" };
    let header = format!("{CREATED_LABEL} {created}{eol}{EDITED_LABEL} {edited}{eol}");
    let lines: Vec<&str> = body.split_inclusive('\n').collect();
    if frontmatter_end(&lines).is_some() {
        // inside the frontmatter, right under its opening fence
        let open = lines[0];
        format!("{open}{header}{}", &body[open.len()..])
    } else {
        format!("{header}{eol}{body}")
    }
}

/// The note split into its Created / Last edited stamps and the text
/// under them, for a merge that must not read two devices' different
/// "Last edited" minutes as both sides changing the same line.
pub(crate) fn split_stamps(content: &str) -> (Option<String>, Option<String>, String) {
    let h = split_header(content);
    (h.created, h.edited, h.body)
}

/// `render_header` for the merge: puts the stamps back over a body.
pub(crate) fn with_stamps(body: &str, created: &str, edited: &str) -> String {
    render_header(body, created, edited)
}

/// Puts the Created / Last edited header on a note being saved, always
/// at the top (or at the top of its frontmatter). Created comes from the
/// incoming text when it carries one (a hand correction wins), else from
/// the file on disk, else from the file system. Last edited moves to
/// `now` only when the text under the header changed: re-saving the same
/// text (a flush, the editor adopting the header) must not claim an edit.
pub fn stamp_note(
    incoming: &str,
    on_disk: Option<&str>,
    file_created: &str,
    file_modified: &str,
    now: &str,
) -> String {
    let new = split_header(incoming);
    let old = on_disk.map(split_header);
    let created = new
        .created
        .clone()
        .or_else(|| old.as_ref().and_then(|o| o.created.clone()))
        .unwrap_or_else(|| file_created.to_string());
    let edited = match old {
        Some(old) if old.body == new.body => new
            .edited
            .or(old.edited)
            .unwrap_or_else(|| file_modified.to_string()),
        _ => now.to_string(),
    };
    render_header(&new.body, &created, &edited)
}

/// A file's birth and modification times as stamps; the birth time falls
/// back to the modification time where the file system records none.
fn file_times(path: &Path) -> Option<(String, String)> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    let created = meta.created().unwrap_or(modified);
    let stamp = |t: std::time::SystemTime| {
        chrono::DateTime::<chrono::Local>::from(t)
            .format(STAMP_FORMAT)
            .to_string()
    };
    Some((stamp(created), stamp(modified)))
}

/// New files default to .md; an explicit extension is kept as-is.
pub fn create(root: &Path, rel: &str) -> Result<String> {
    let rel = if Path::new(rel).extension().is_some() {
        rel.to_string()
    } else {
        format!("{rel}.md")
    };
    let path = resolve(root, &rel)?;
    if path.exists() {
        return Err(Error::State(format!("file already exists: {rel}")));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).at(parent)?;
    }
    fs::write(&path, "").at(&path)?;
    Ok(rel)
}

/// Creates a folder (and any missing parents) under the KB root. An
/// existing folder is fine - the tree just gains nothing; an existing
/// FILE at the path is an error, since creating the folder would mean
/// destroying it.
pub fn create_dir(root: &Path, rel: &str) -> Result<String> {
    let rel = rel.trim().trim_matches('/').to_string();
    if rel.is_empty() {
        return Err(Error::State("folder name is empty".into()));
    }
    let path = resolve(root, &rel)?;
    if path.is_file() {
        return Err(Error::State(format!("a file already exists at {rel}")));
    }
    fs::create_dir_all(&path).at(&path)?;
    Ok(rel)
}

/// Absolute on-disk path of a note or folder ("" = the KB root itself),
/// for "copy path" and "show in the file manager".
pub fn abs_path(root: &Path, rel: &str) -> Result<PathBuf> {
    let path = if rel.trim().is_empty() {
        root.to_path_buf()
    } else {
        resolve(root, rel)?
    };
    if !path.exists() {
        return Err(Error::State(format!("no such file: {rel}")));
    }
    Ok(path)
}

/// A target without an extension inherits the source's extension, so
/// renaming never silently changes a file's type.
pub fn rename(root: &Path, from: &str, to: &str) -> Result<()> {
    guard_work_dir(from)?;
    guard_work_dir(to)?;
    // a folder has no type to keep: "proj.old" -> "proj" is just "proj"
    let to = if Path::new(to).extension().is_some() || resolve(root, from)?.is_dir() {
        to.to_string()
    } else {
        match Path::new(from).extension() {
            Some(ext) => format!("{to}.{}", ext.to_string_lossy()),
            None => to.to_string(),
        }
    };
    let source = resolve(root, from)?;
    let target = resolve(root, &to)?;
    // on a case-insensitive filesystem `note.md` -> `Note.md` finds the
    // target "existing" - it is the source itself, and the rename is fine
    let same_file = source != target
        && matches!(
            (fs::canonicalize(&source), fs::canonicalize(&target)),
            (Ok(a), Ok(b)) if a == b
        );
    if target.exists() && !same_file {
        return Err(Error::State(format!("target already exists: {to}")));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).at(parent)?;
    }
    fs::rename(&source, &target).at(&source)?;
    Ok(())
}

fn copy_recursive(src: &Path, dst: &Path) -> Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
    } else {
        fs::copy(src, dst)?;
    }
    Ok(())
}

/// Copies a file or folder into `to_dir` ("" = KB root), keeping the
/// basename; a name clash gets " copy" appended before the extension
/// until the name is unique. Returns the new relative path. Backs the
/// tree's Ctrl+C / Ctrl+V.
pub fn copy_into(root: &Path, from: &str, to_dir: &str) -> Result<String> {
    let source = resolve(root, from)?;
    if !source.exists() {
        return Err(Error::State(format!("no such file: {from}")));
    }
    let name = Path::new(from)
        .file_name()
        .ok_or_else(|| Error::State(format!("invalid KB path: {from}")))?
        .to_string_lossy()
        .into_owned();
    // a folder pasted into itself (or below itself) would copy its own
    // growing copy forever
    if source.is_dir() {
        let inside = to_dir
            .strip_prefix(from)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'));
        if inside {
            return Err(Error::State(format!("cannot copy \"{from}\" into itself")));
        }
    }
    let dir_abs = if to_dir.is_empty() {
        root.to_path_buf()
    } else {
        resolve(root, to_dir)?
    };
    fs::create_dir_all(&dir_abs)?;
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && !source.is_dir() => (s.to_string(), format!(".{e}")),
        _ => (name.clone(), String::new()),
    };
    let mut candidate = name.clone();
    let mut n = 0;
    while dir_abs.join(&candidate).exists() {
        n += 1;
        candidate = if n == 1 {
            format!("{stem} copy{ext}")
        } else {
            format!("{stem} copy {n}{ext}")
        };
    }
    let rel = if to_dir.is_empty() {
        candidate.clone()
    } else {
        format!("{to_dir}/{candidate}")
    };
    copy_recursive(&source, &dir_abs.join(&candidate))?;
    Ok(rel)
}

/// Deleting moves the file or folder into .trash/ inside the KB root
/// (shown in the tree like any folder unless .hypomnemaignore hides
/// it, never synced): notes are primary user data
/// and a mistaken delete must be recoverable in the file manager.
/// Trash entries older than 30 days are pruned on the next delete.
pub fn delete(root: &Path, rel: &str) -> Result<()> {
    guard_work_dir(rel)?;
    let path = resolve(root, rel)?;
    if !path.exists() {
        return Err(Error::State(format!("no such file: {rel}")));
    }
    move_to_trash(root, &path, rel)
}

/// Moves `path` (`rel` under `root`) into `root`'s .trash/ under the
/// `YYYYMMDD-HHMMSS-` prefix the 30-day prune recognizes, and prunes.
/// Shared with sync, which trashes a file the other device deleted
/// rather than removing it outright.
pub fn move_to_trash(root: &Path, path: &Path, rel: &str) -> Result<()> {
    let trash = root.join(TRASH_DIR);
    fs::create_dir_all(&trash).at(&trash)?;
    let flat = rel.replace(['/', '\\'], "__");
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let mut target = trash.join(format!("{stamp}-{flat}"));
    let mut n = 1;
    while target.exists() {
        target = trash.join(format!("{stamp}-{n}-{flat}"));
        n += 1;
    }
    fs::rename(path, &target).at(path)?;
    prune_trash(&trash);
    Ok(())
}

/// `YYYYMMDD-HHMMSS-` - the prefix `delete` gives every trash entry.
fn is_trash_stamped(name: &str) -> bool {
    let b = name.as_bytes();
    b.len() > 16
        && b[..16].iter().enumerate().all(|(i, c)| match i {
            8 | 15 => *c == b'-',
            _ => c.is_ascii_digit(),
        })
}

/// Best effort: trash cleanup must never fail the delete itself.
fn prune_trash(trash: &Path) {
    let cutoff = (chrono::Local::now() - chrono::Duration::days(30))
        .format("%Y%m%d-%H%M%S")
        .to_string();
    let Ok(entries) = fs::read_dir(trash) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        // only what `delete` put here: another app sharing the folder
        // (Obsidian's .trash) keeps its own entries, whatever they are named
        if !is_trash_stamped(&name) {
            continue;
        }
        // names start with the timestamp, so a string compare orders them
        if name.as_str() < cutoff.as_str() {
            let path = entry.path();
            let _ = if path.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };
        }
    }
}

#[cfg(test)]
mod tests;
