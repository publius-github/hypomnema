use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use crate::error::{Error, Result};

#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct KbNode {
    pub name: String,
    /// Path relative to the KB root, with '/' separators.
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<KbNode>,
}

/// Rejects absolute paths and traversal; the app must never touch
/// anything outside the user-chosen KB folder.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
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
    fs::read_to_string(root.join(IGNORE_FILE))
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
fn is_ignored(patterns: &[String], name: &str, rel: &str, is_dir: bool) -> bool {
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
        if name.starts_with('.') && name.ends_with(".tmp") {
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

const SEARCH_MAX_HITS: usize = 100;
const SEARCH_MAX_FILE_BYTES: u64 = 2_000_000;

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

pub fn read(root: &Path, rel: &str) -> Result<String> {
    Ok(fs::read_to_string(resolve(root, rel)?)?)
}

pub fn write(root: &Path, rel: &str, content: &str) -> Result<()> {
    let path = resolve(root, rel)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    // Notes are primary user data: a crash mid-autosave must not
    // truncate the file, same guarantee the YAML configs already have.
    crate::vault::write_atomic(&path, content)?;
    Ok(())
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
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, "")?;
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
    fs::create_dir_all(&path)?;
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
    let to = if Path::new(to).extension().is_some() {
        to.to_string()
    } else {
        match Path::new(from).extension() {
            Some(ext) => format!("{to}.{}", ext.to_string_lossy()),
            None => to.to_string(),
        }
    };
    let source = resolve(root, from)?;
    let target = resolve(root, &to)?;
    if target.exists() {
        return Err(Error::State(format!("target already exists: {to}")));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(source, target)?;
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
    let dir_abs = resolve(root, to_dir)?;
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
/// (dot-prefixed, so the tree hides it): notes are primary user data
/// and a mistaken delete must be recoverable in the file manager.
/// Trash entries older than 30 days are pruned on the next delete.
pub fn delete(root: &Path, rel: &str) -> Result<()> {
    let path = resolve(root, rel)?;
    if !path.exists() {
        return Err(Error::State(format!("no such file: {rel}")));
    }
    let trash = root.join(".trash");
    fs::create_dir_all(&trash)?;
    let flat = rel.replace(['/', '\\'], "__");
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let mut target = trash.join(format!("{stamp}-{flat}"));
    let mut n = 1;
    while target.exists() {
        target = trash.join(format!("{stamp}-{n}-{flat}"));
        n += 1;
    }
    fs::rename(&path, &target)?;
    prune_trash(&trash);
    Ok(())
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
mod tests {
    use super::*;

    fn root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("app-pkb-kb-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn ignore_file_hides_patterns_from_the_tree() {
        let root = root("ignore");
        fs::write(root.join("note.md"), "x").unwrap();
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("sub/data.db"), "x").unwrap();
        fs::write(root.join("sub/keep.md"), "x").unwrap();
        fs::write(root.join("sub/draft.md"), "x").unwrap();
        fs::create_dir_all(root.join("secret")).unwrap();
        fs::write(root.join("secret/inside.md"), "x").unwrap();
        fs::write(
            root.join(IGNORE_FILE),
            "# service files\n*.db\nsecret/\nsub/draft.md\n",
        )
        .unwrap();

        let tree = tree(&root).unwrap();
        let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"note.md"));
        // the ignore file itself is editable from the tree
        assert!(names.contains(&IGNORE_FILE));
        assert!(!names.contains(&"secret"));
        let sub = tree.iter().find(|n| n.name == "sub").unwrap();
        let sub_names: Vec<&str> = sub.children.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(sub_names, vec!["keep.md"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn glob_match_covers_stars_and_question_marks() {
        assert!(glob_match("*.db", "app.db"));
        assert!(!glob_match("*.db", "app.dbx"));
        assert!(glob_match("draft-?.md", "draft-1.md"));
        assert!(glob_match("sub/*.md", "sub/x.md"));
        assert!(glob_match("*", "anything"));
        assert!(!glob_match("a*c", "ab"));
    }

    #[test]
    fn tree_shows_everything_except_atomic_tmp_files() {
        let root = root("tree");
        fs::create_dir_all(root.join("b-notes")).unwrap();
        fs::write(root.join("b-notes").join("inner.md"), "x").unwrap();
        fs::write(root.join("b-notes").join("data.txt"), "x").unwrap();
        fs::write(root.join("a.md"), "x").unwrap();
        fs::write(root.join("app.db"), "x").unwrap();
        fs::write(root.join(".hidden.md"), "x").unwrap();
        fs::write(root.join(".a.md.tmp"), "x").unwrap();

        let nodes = tree(&root).unwrap();
        let names: Vec<&str> = nodes.iter().map(|n| n.name.as_str()).collect();
        // dotfiles, .db and everything else show; hiding is done via
        // the ignore file only. Our write_atomic staging never shows.
        assert_eq!(names, vec!["b-notes", ".hidden.md", "a.md", "app.db"]);
        let children: Vec<&str> = nodes[0].children.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(children, vec!["data.txt", "inner.md"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn traversal_and_absolute_paths_rejected() {
        let root = root("traversal");
        assert!(read(&root, "../secret.md").is_err());
        assert!(read(&root, "/etc/passwd").is_err());
        assert!(write(&root, "a/../../x.md", "boom").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn create_rename_delete_round_trip() {
        let root = root("crud");
        let created = create(&root, "notes/idea").unwrap();
        assert_eq!(created, "notes/idea.md");
        assert!(create(&root, "notes/idea.md").is_err());

        write(&root, "notes/idea.md", "content").unwrap();
        assert_eq!(read(&root, "notes/idea.md").unwrap(), "content");

        rename(&root, "notes/idea.md", "notes/renamed").unwrap();
        assert_eq!(read(&root, "notes/renamed.md").unwrap(), "content");

        delete(&root, "notes/renamed.md").unwrap();
        assert!(read(&root, "notes/renamed.md").is_err());

        // folders delete recursively
        create(&root, "notes/deep/inner").unwrap();
        delete(&root, "notes").unwrap();
        assert!(!root.join("notes").exists());

        // deletes land in .trash (recoverable), which the tree hides
        let trashed: Vec<String> = fs::read_dir(root.join(".trash"))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(trashed.iter().any(|n| n.ends_with("notes__renamed.md")));
        assert!(trashed.iter().any(|n| n.ends_with("-notes")));
        // .trash now shows in the tree like everything else; only the
        // ignore file hides it
        let names: Vec<String> = tree(&root).unwrap().into_iter().map(|n| n.name).collect();
        assert_eq!(names, vec![".trash".to_string()]);
        fs::write(root.join(IGNORE_FILE), ".trash/\n").unwrap();
        let names: Vec<String> = tree(&root).unwrap().into_iter().map(|n| n.name).collect();
        assert_eq!(names, vec![IGNORE_FILE.to_string()]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_into_generates_unique_names() {
        let root = root("copy");
        create(&root, "a.md").unwrap();
        write(&root, "a.md", "x").unwrap();
        assert_eq!(copy_into(&root, "a.md", "").unwrap(), "a copy.md");
        assert_eq!(copy_into(&root, "a.md", "").unwrap(), "a copy 2.md");
        assert_eq!(read(&root, "a copy.md").unwrap(), "x");
        fs::create_dir_all(root.join("sub")).unwrap();
        assert_eq!(copy_into(&root, "a.md", "sub").unwrap(), "sub/a.md");
        // folders copy recursively
        create(&root, "dir/inner.md").unwrap();
        assert_eq!(copy_into(&root, "dir", "").unwrap(), "dir copy");
        assert!(read(&root, "dir copy/inner.md").is_ok());
        // traversal stays rejected
        assert!(copy_into(&root, "a.md", "../out").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn non_md_extensions_survive_create_and_rename() {
        let root = root("ext");
        assert_eq!(create(&root, "todo.txt").unwrap(), "todo.txt");

        rename(&root, "todo.txt", "renamed").unwrap();
        assert!(read(&root, "renamed.txt").is_ok());

        rename(&root, "renamed.txt", "explicit.yml").unwrap();
        assert!(read(&root, "explicit.yml").is_ok());
        let _ = fs::remove_dir_all(&root);
    }
}
