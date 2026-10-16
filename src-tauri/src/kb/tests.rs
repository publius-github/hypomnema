use super::*;

fn root(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("hypomnema-kb-{name}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn backlinks_split_links_from_plain_mentions() {
    let root = root("backlinks");
    fs::write(root.join("Alpha Note.md"), "the note itself").unwrap();
    fs::write(root.join("linked.md"), "see [[Alpha Note]] for details").unwrap();
    fs::write(root.join("linked-ext.md"), "also [[alpha note.md]]").unwrap();
    fs::write(root.join("mention.md"), "alpha note came up today").unwrap();
    fs::write(root.join("unrelated.md"), "nothing here").unwrap();
    // a self-reference must not list the note as its own backlink
    fs::write(root.join("other.md"), "[[Beta]]").unwrap();

    let result = backlinks(&root, "Alpha Note.md").unwrap();
    let link_paths: Vec<&str> = result.links.iter().map(|h| h.path.as_str()).collect();
    assert_eq!(link_paths.len(), 2, "{link_paths:?}");
    assert!(link_paths.contains(&"linked.md"));
    assert!(link_paths.contains(&"linked-ext.md"));
    let mention_paths: Vec<&str> = result.mentions.iter().map(|h| h.path.as_str()).collect();
    assert_eq!(mention_paths, vec!["mention.md"]);
    assert_eq!(result.mentions[0].line, 1);
    assert!(result.mentions[0].preview.contains("alpha note"));
}

#[test]
fn backlinks_link_wins_over_mention_and_short_names_skip_mentions() {
    let root = root("backlinks-precedence");
    fs::write(root.join("Plan.md"), "x").unwrap();
    // the same file both links and mentions: one hit, in links
    fs::write(root.join("both.md"), "plan text\n[[Plan]] linked").unwrap();
    let result = backlinks(&root, "Plan.md").unwrap();
    assert_eq!(result.links.len(), 1);
    assert!(result.mentions.is_empty());

    // names shorter than the mention floor still collect links only
    fs::write(root.join("ab.md"), "x").unwrap();
    fs::write(root.join("uses-ab.md"), "abnormal abbey [[ab]]").unwrap();
    let result = backlinks(&root, "ab.md").unwrap();
    assert_eq!(result.links.len(), 1);
    assert!(result.mentions.is_empty());
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
    assert!(write(&root, "a/../../x.md", "boom", false).is_err());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn create_rename_delete_round_trip() {
    let root = root("crud");
    let created = create(&root, "notes/idea").unwrap();
    assert_eq!(created, "notes/idea.md");
    assert!(create(&root, "notes/idea.md").is_err());

    write(&root, "notes/idea.md", "content", false).unwrap();
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
    write(&root, "a.md", "x", false).unwrap();
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

const NOW: &str = "2026-09-12 11:00";
const THEN: &str = "2026-09-01 09:00";

fn stamped(body: &str, created: &str, edited: &str) -> String {
    format!("Created: {created}\nLast edited: {edited}\n\n{body}")
}

#[test]
fn a_new_note_gets_the_header_on_top() {
    assert_eq!(
        stamp_note("# Idea\n", None, NOW, NOW, NOW),
        stamped("# Idea\n", NOW, NOW)
    );
    assert_eq!(stamp_note("", None, NOW, NOW, NOW), stamped("", NOW, NOW));
}

#[test]
fn last_edited_moves_only_when_the_text_changed() {
    let disk = stamped("body\n", THEN, THEN);
    // a re-save of the same text keeps both stamps
    assert_eq!(stamp_note(&disk, Some(&disk), NOW, NOW, NOW), disk);
    // the editor without the header yet (a phone textarea) too
    assert_eq!(stamp_note("body\n", Some(&disk), NOW, NOW, NOW), disk);
    // an edit moves Last edited and keeps Created
    assert_eq!(
        stamp_note(
            &stamped("body\nmore\n", THEN, THEN),
            Some(&disk),
            NOW,
            NOW,
            NOW
        ),
        stamped("body\nmore\n", THEN, NOW)
    );
}

#[test]
fn an_unstamped_note_takes_its_file_times() {
    let file_created = "2025-01-02 03:04";
    let file_modified = "2025-05-06 07:08";
    assert_eq!(
        stamp_note("old\n", Some("old\n"), file_created, file_modified, NOW),
        stamped("old\n", file_created, file_modified)
    );
    assert_eq!(
        stamp_note(
            "old\nnew\n",
            Some("old\n"),
            file_created,
            file_modified,
            NOW
        ),
        stamped("old\nnew\n", file_created, NOW)
    );
}

#[test]
fn a_hand_corrected_created_date_wins() {
    let disk = stamped("body\n", THEN, THEN);
    let incoming = stamped("body\n", "2020-02-02", THEN);
    assert_eq!(
        stamp_note(&incoming, Some(&disk), NOW, NOW, NOW),
        stamped("body\n", "2020-02-02", THEN)
    );
}

#[test]
fn text_typed_above_the_header_never_duplicates_it() {
    let disk = stamped("body\n", THEN, THEN);
    let incoming = format!("# Title\n{disk}");
    assert_eq!(
        stamp_note(&incoming, Some(&disk), NOW, NOW, NOW),
        stamped("# Title\nbody\n", THEN, NOW)
    );
}

#[test]
fn a_frontmatter_note_keeps_the_header_inside_it() {
    let note = "---\ntags: [a]\n---\nbody\n";
    let out = stamp_note(note, None, NOW, NOW, NOW);
    assert_eq!(
        out,
        format!("---\nCreated: {NOW}\nLast edited: {NOW}\ntags: [a]\n---\nbody\n")
    );
    assert_eq!(stamp_note(&out, Some(&out), THEN, THEN, THEN), out);
}

#[test]
fn prose_that_merely_starts_with_a_label_is_not_a_header() {
    assert_eq!(
        stamp_note("Created: by hand\n", None, NOW, NOW, NOW),
        stamped("Created: by hand\n", NOW, NOW)
    );
}

#[test]
fn crlf_notes_get_crlf_header_lines() {
    assert_eq!(
        stamp_note("a\r\nb\r\n", None, NOW, NOW, NOW),
        format!("Created: {NOW}\r\nLast edited: {NOW}\r\n\r\na\r\nb\r\n")
    );
}

#[test]
fn write_returns_the_stamped_text_and_skips_a_no_op() {
    let root = std::env::temp_dir().join("hypomnema-kb-stamp");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let first = write(&root, "n.md", "hi\n", true).unwrap();
    assert!(first.starts_with("Created: "));
    assert!(first.ends_with("\n\nhi\n"));
    assert_eq!(read(&root, "n.md").unwrap(), first);
    assert_eq!(write(&root, "n.md", &first, true).unwrap(), first);
    // without the stamp flag the text goes to disk as given
    assert_eq!(write(&root, "n.md", "plain", false).unwrap(), "plain");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_folder_is_never_copied_into_itself() {
    let root = root("copy-into-self");
    create_dir(&root, "a/b").unwrap();
    assert!(copy_into(&root, "a", "a").is_err());
    assert!(copy_into(&root, "a", "a/b").is_err());
    // a sibling that merely shares the prefix is fine
    create_dir(&root, "ab").unwrap();
    assert_eq!(copy_into(&root, "a", "ab").unwrap(), "ab/a");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn the_work_dir_cannot_be_deleted_or_moved_but_config_can() {
    let root = root("work-dir-guard");
    create_dir(&root, ".hypomnema/config").unwrap();
    fs::write(root.join(".hypomnema/app.db"), "db").unwrap();
    fs::write(root.join(".hypomnema/config/recurring.yml"), "x").unwrap();
    assert!(delete(&root, ".hypomnema").is_err());
    assert!(delete(&root, ".hypomnema/app.db").is_err());
    assert!(delete(&root, ".hypomnema/config").is_err());
    assert!(rename(&root, ".hypomnema", "elsewhere").is_err());
    assert!(rename(&root, ".hypomnema/app.db", "app.db").is_err());
    assert!(root.join(".hypomnema/app.db").exists());
    rename(
        &root,
        ".hypomnema/config/recurring.yml",
        ".hypomnema/config/old.yml",
    )
    .unwrap();
    delete(&root, ".hypomnema/config/old.yml").unwrap();
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn renaming_a_dotted_folder_does_not_keep_its_suffix() {
    let root = root("rename-dotted-dir");
    create_dir(&root, "proj.old").unwrap();
    rename(&root, "proj.old", "proj").unwrap();
    assert!(root.join("proj").is_dir());
    let _ = fs::remove_dir_all(&root);
}
