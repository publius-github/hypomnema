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

fn read_dir_sorted(dir: &Path) -> Result<Vec<fs::DirEntry>> {
    let mut entries: Vec<fs::DirEntry> = fs::read_dir(dir)?.collect::<std::io::Result<_>>()?;
    entries.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
    Ok(entries)
}

fn build_tree(root: &Path, dir: &Path, depth: usize) -> Result<Vec<KbNode>> {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    for entry in read_dir_sorted(dir)? {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
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
        if entry.file_type()?.is_dir() {
            dirs.push(KbNode {
                name,
                path: rel,
                is_dir: true,
                children: build_tree(root, &path, depth + 1)?,
            });
        } else {
            // The KB root often doubles as the vault root, so service
            // files there (app.db and friends) stay hidden: only .md
            // notes surface at the top level, everything inside
            // subfolders is shown
            if depth == 0 && !name.to_lowercase().ends_with(".md") {
                continue;
            }
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
/// as-is; all non-hidden files are shown (root level: .md only).
pub fn tree(root: &Path) -> Result<Vec<KbNode>> {
    if !root.is_dir() {
        return Err(Error::State(format!(
            "KB folder does not exist: {}",
            root.display()
        )));
    }
    build_tree(root, root, 0)
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
    fn tree_hides_non_md_at_root_but_shows_them_in_subfolders() {
        let root = root("tree");
        fs::create_dir_all(root.join("b-notes")).unwrap();
        fs::write(root.join("b-notes").join("inner.md"), "x").unwrap();
        fs::write(root.join("b-notes").join("data.txt"), "x").unwrap();
        fs::write(root.join("a.md"), "x").unwrap();
        fs::write(root.join("app.db"), "x").unwrap();
        fs::write(root.join(".hidden.md"), "x").unwrap();

        let nodes = tree(&root).unwrap();
        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].name, "b-notes");
        assert!(nodes[0].is_dir);
        let children: Vec<&str> = nodes[0].children.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(children, vec!["data.txt", "inner.md"]);
        assert_eq!(nodes[1].name, "a.md");
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
        assert!(tree(&root).unwrap().is_empty());
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
