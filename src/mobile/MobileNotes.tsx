import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { CONFIG_FILES, basenameOf, parentDirOf } from "../sections/kb/util";
import { useBackStep } from "./back";
import type { BacklinksResult, KbNode, KbSearchHit, KbStatus } from "../types";

const SAVE_DEBOUNCE_MS = 1200;

type Open = { kind: "note" | "config"; path: string; content: string };

/**
 * Notes: browse, read, write.
 *
 * Folders open in place rather than as a tree with indentation - on a
 * narrow screen a deep tree spends most of its width on whitespace, so
 * this walks one folder at a time with a path trail back out.
 *
 * The editor is a plain textarea, for the same reason the journal's is:
 * the system keyboard and its autocorrect *are* the editor on a phone,
 * and CodeMirror fights both. What the desktop's editor gives that this
 * cannot - lint gutters, YAML colouring - is worth nothing on a screen
 * this size; what it takes is the keyboard's own behaviour.
 */
export default function MobileNotes() {
  const setError = useAppStore((s) => s.setError);
  const [tree, setTree] = useState<KbNode[]>([]);
  const [trail, setTrail] = useState<KbNode[]>([]);
  const [note, setNote] = useState<Open | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KbSearchHit[] | null>(null);
  const [status, setStatus] = useState<KbStatus | null>(null);
  // inline create form rather than window.prompt: the WebView's prompt is
  // not guaranteed to exist on Android, and a native dialog hides the
  // folder the name is being chosen for
  const [creating, setCreating] = useState<"note" | "folder" | null>(null);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    void invoke<KbStatus>("kb_status")
      .then(setStatus)
      .catch(() => {});
  }, []);

  const loadTree = useCallback(() => {
    void invoke<KbNode[]>("kb_tree")
      .then(setTree)
      .catch((e) => setError(String(e)));
  }, [setError]);
  useEffect(loadTree, [loadTree]);

  // hardware back retraces the browsing steps: the open note closes
  // first, then search results clear, then the trail walks up one
  // folder per press until the root, where MobileApp's tab step is next
  useBackStep(trail.length > 0, () => setTrail((t) => t.slice(0, -1)));
  useBackStep(hits !== null, () => setHits(null));
  useBackStep(note !== null, () => {
    setNote(null);
    loadTree();
  });
  useBackStep(creating !== null, () => setCreating(null));

  const openPath = useCallback(
    (path: string) => {
      void invoke<string>("kb_read", { path })
        .then((content) => setNote({ kind: "note", path, content }))
        .catch((e) => setError(String(e)));
    },
    [setError],
  );

  const openConfig = useCallback(
    (file: string) => {
      void invoke<string>("config_file_get", { file })
        .then((content) => setNote({ kind: "config", path: file, content }))
        .catch((e) => setError(String(e)));
    },
    [setError],
  );

  // a search hit landed here with a note to open
  const kbOpenNote = useAppStore((s) => s.kbOpenNote);
  useEffect(() => {
    if (!kbOpenNote) return;
    openPath(kbOpenNote);
    useAppStore.setState({ kbOpenNote: null });
  }, [kbOpenNote, openPath]);

  if (note) {
    return (
      // keyed by path: following a wiki link swaps the note prop, and an
      // unkeyed editor would keep showing the previous note's content
      <NoteEditor
        key={note.path}
        note={note}
        onClose={() => {
          setNote(null);
          loadTree();
        }}
        onOpen={openPath}
      />
    );
  }

  const here = trail.length > 0 ? trail[trail.length - 1].children : tree;
  const folder = trail.length > 0 ? `${trail[trail.length - 1].path}/` : "";

  const create = () => {
    const trimmed = newName.trim();
    if (!creating || !trimmed) return;
    const kind = creating;
    const path =
      kind === "note" && !trimmed.endsWith(".md")
        ? `${folder}${trimmed}.md`
        : `${folder}${trimmed}`;
    void invoke<string>(kind === "note" ? "kb_create" : "kb_mkdir", { path })
      .then((created) => {
        setCreating(null);
        setNewName("");
        loadTree();
        if (kind === "note") openPath(created);
      })
      .catch((e) => setError(String(e)));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-2 border-b border-line p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (!query.trim()) {
              setHits(null);
              return;
            }
            void invoke<KbSearchHit[]>("kb_search", { query: query.trim() })
              .then(setHits)
              .catch((err) => setError(String(err)));
          }}
          placeholder="Search notes"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-alt px-3 py-2"
        />
        {hits && (
          <button
            onClick={() => {
              setHits(null);
              setQuery("");
            }}
            className="px-2 text-content-muted"
          >
            Clear
          </button>
        )}
      </div>

      {/* A vault copied from a desktop brings its app.yml along, and the
          notes folder it names is a path on that machine. Saying so beats
          showing the vault root as if it were what was asked for - and
          since settings never sync, clearing the path here is local: it
          adopts the vault for good on this device and retires the banner
          without touching the desktop's setting. */}
      {status?.unreachable && (
        <div className="flex items-center gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2 text-xs text-warn">
          <span className="min-w-0 flex-1">
            Notes are being read from the vault: the configured folder (
            {status.configured}) does not exist on this device.
          </span>
          <button
            className="shrink-0 rounded border border-warn/50 px-2 py-1 font-medium"
            onClick={() => {
              void useAppStore
                .getState()
                .updateConfig({ kb_path: "" })
                .then(() =>
                  invoke<KbStatus>("kb_status").then(setStatus),
                );
            }}
          >
            Use the vault
          </button>
        </div>
      )}

      {hits ? (
        <ul className="min-h-0 flex-1 overflow-auto">
          {hits.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-content-muted">
              Nothing matches.
            </li>
          )}
          {hits.map((hit, index) => (
            <li
              key={`${hit.path}-${hit.line}-${index}`}
              className="border-b border-line/60"
            >
              <button
                onClick={() => openPath(hit.path)}
                className="w-full px-4 py-3 text-left"
              >
                <span className="block break-words">{hit.name}</span>
                <span className="block break-words text-xs text-content-muted">
                  {hit.preview}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          {trail.length > 0 && (
            <header className="flex items-center gap-2 border-b border-line px-2 py-3">
              <button
                onClick={() => setTrail((t) => t.slice(0, -1))}
                className="px-2 py-1 text-content-muted"
              >
                ‹ Back
              </button>
              <span className="min-w-0 truncate font-semibold">
                {trail.map((node) => node.name).join(" / ")}
              </span>
            </header>
          )}
          <ul className="min-h-0 flex-1 overflow-auto">
            {here.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-content-muted">
                Nothing here.
              </li>
            )}
            {here.map((node) => (
              <li key={node.path} className="border-b border-line/60">
                <button
                  onClick={() =>
                    node.is_dir
                      ? setTrail((t) => [...t, node])
                      : openPath(node.path)
                  }
                  className="flex w-full items-center gap-3 px-4 py-4 text-left"
                >
                  <span aria-hidden className="text-content-muted">
                    {node.is_dir ? "▸" : "·"}
                  </span>
                  <span className="min-w-0 break-words">{node.name}</span>
                </button>
              </li>
            ))}
            {/* the desktop's Config group: the six rule/reminder files
                and the journal template, validated on save */}
            {trail.length === 0 && (
              <>
                <li className="bg-surface-alt px-4 py-2 text-xs uppercase tracking-wide text-content-muted">
                  Config
                </li>
                {CONFIG_FILES.map((file) => (
                  <li key={file} className="border-b border-line/60">
                    <button
                      onClick={() => openConfig(file)}
                      className="flex w-full items-center gap-3 px-4 py-4 text-left"
                    >
                      <span aria-hidden className="text-content-muted">
                        ·
                      </span>
                      <span className="min-w-0 break-words">{file}</span>
                    </button>
                  </li>
                ))}
              </>
            )}
          </ul>
          {/* A create bar, not a pair of slabs: the two buttons used to
              split the full width in a solid accent block, which read as
              the loudest thing on a screen whose actual subject is the
              list of notes above it. They are text buttons now, sized to
              a thumb and no larger. */}
          <div className="flex items-center gap-2 border-t border-line px-3 py-2">
            {creating === null ? (
              <>
                <button
                  onClick={() => {
                    setNewName("");
                    setCreating("note");
                  }}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm text-accent"
                >
                  + Note
                </button>
                <button
                  onClick={() => {
                    setNewName("");
                    setCreating("folder");
                  }}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm text-content-muted"
                >
                  + Folder
                </button>
                {trail.length > 0 && (
                  <span className="ml-auto min-w-0 truncate text-xs text-content-muted">
                    in {trail[trail.length - 1].name}
                  </span>
                )}
              </>
            ) : (
              <>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && create()}
                  placeholder={
                    creating === "note" ? "Note name" : "Folder name"
                  }
                  className="min-w-0 flex-1 rounded-lg border border-line bg-surface-alt px-3 py-2"
                />
                <button
                  onClick={create}
                  className="rounded-lg bg-accent px-4 py-2 font-medium text-white"
                >
                  Create
                </button>
                <button
                  onClick={() => setCreating(null)}
                  className="rounded-lg border border-line px-3 py-2"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NoteEditor({
  note,
  onClose,
  onOpen,
}: {
  note: Open;
  onClose: () => void;
  onOpen: (path: string) => void;
}) {
  const setError = useAppStore((s) => s.setError);
  const [content, setContent] = useState(note.content);
  const [saved, setSaved] = useState(true);
  // a config file opens straight into the editor: its reading view is
  // YAML, which there is nothing to "read" - only to change
  const [editing, setEditing] = useState(note.kind === "config");
  const [backlinks, setBacklinks] = useState<BacklinksResult | null>(null);
  const [showBacklinks, setShowBacklinks] = useState(false);
  const [configErrors, setConfigErrors] = useState<
    { line: number | null; message: string }[]
  >([]);
  // rename/move ask for their text inline, for the same reason the
  // browser has an inline create form: window.prompt is unreliable in
  // the Android WebView and hides the note it is asking about
  const [action, setAction] = useState<"rename" | "move" | null>(null);
  const [actionValue, setActionValue] = useState("");
  useBackStep(action !== null, () => setAction(null));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

  // Same contract as the journal's: the tail of what was typed must
  // survive backgrounding, which is how a phone screen is usually left.
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const outstanding = pending.current;
    if (outstanding === null) return;
    pending.current = null;
    try {
      if (note.kind === "config") {
        // invalid YAML is reported and never written (last valid state
        // stays active), same as the desktop's Config editor
        const errors = await invoke<{ line: number | null; message: string }[]>(
          "config_file_set",
          { file: note.path, content: outstanding },
        );
        setConfigErrors(errors);
        if (errors.length === 0) setSaved(true);
      } else {
        await invoke("kb_write", { path: note.path, content: outstanding });
        setSaved(true);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [note.path, note.kind, setError]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);

  const edit = (text: string) => {
    setContent(text);
    setSaved(false);
    pending.current = text;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  };

  const applyAction = () => {
    if (!action) return;
    const value = actionValue.trim();
    let target: string | null = null;
    if (action === "rename") {
      if (value && value !== basenameOf(note.path)) {
        const dir = parentDirOf(note.path);
        target = `${dir ? `${dir}/` : ""}${
          value.endsWith(".md") ? value : `${value}.md`
        }`;
      }
    } else {
      const folder = value.replace(/\/+$/, "");
      if (folder !== parentDirOf(note.path)) {
        target = `${folder ? `${folder}/` : ""}${basenameOf(note.path)}`;
      }
    }
    setAction(null);
    if (!target) return;
    const to = target;
    void flush()
      .then(() => invoke("kb_rename", { from: note.path, to }))
      .then(() => onOpen(to))
      .catch((e) => setError(String(e)));
  };

  const loadBacklinks = () => {
    setShowBacklinks((v) => !v);
    if (backlinks) return;
    void invoke<BacklinksResult>("kb_backlinks", { path: note.path })
      .then(setBacklinks)
      .catch((e) => setError(String(e)));
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-3">
        <button
          onClick={() => void flush().then(onClose)}
          className="px-2 py-1 text-content-muted"
        >
          ‹ Back
        </button>
        <span className="min-w-0 flex-1 truncate font-semibold">
          {note.path}
        </span>
        <span className="shrink-0 text-xs text-content-muted">
          {saved ? "" : "Saving…"}
        </span>
        <button
          onClick={() => setEditing((v) => !v)}
          className="px-2 text-sm text-accent"
        >
          {editing ? "Read" : "Edit"}
        </button>
      </header>

      {configErrors.length > 0 && (
        <div className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-xs text-warn">
          {configErrors.map((err, i) => (
            <p key={i}>
              {err.line !== null && `line ${err.line}: `}
              {err.message}
            </p>
          ))}
        </div>
      )}

      {editing ? (
        <textarea
          value={content}
          onChange={(e) => edit(e.target.value)}
          spellCheck
          className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-sm leading-relaxed outline-none"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <ReadView content={content} onOpen={(name) => onOpen(name)} />
        </div>
      )}

      {note.kind === "note" && (
      <div className="shrink-0 border-t border-line">
        <div className="flex gap-4 px-4 py-2">
          <button
            onClick={() => {
              setActionValue(basenameOf(note.path));
              setAction(action === "rename" ? null : "rename");
            }}
            className="text-sm text-content-muted"
          >
            Rename
          </button>
          <button
            onClick={() => {
              setActionValue(parentDirOf(note.path));
              setAction(action === "move" ? null : "move");
            }}
            className="text-sm text-content-muted"
          >
            Move
          </button>
        </div>
        {action && (
          <div className="flex gap-2 px-4 pb-2">
            <input
              autoFocus
              value={actionValue}
              onChange={(e) => setActionValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyAction()}
              placeholder={
                action === "rename" ? "New name" : "Folder (empty = root)"
              }
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface-alt px-3 py-2 text-sm"
            />
            <button
              onClick={applyAction}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white"
            >
              {action === "rename" ? "Rename" : "Move"}
            </button>
            <button
              onClick={() => setAction(null)}
              className="rounded-lg border border-line px-3 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        )}
        <button
          onClick={loadBacklinks}
          className="w-full px-4 py-3 text-left text-sm text-content-muted"
        >
          What points here {showBacklinks ? "▾" : "▸"}
        </button>
        {showBacklinks && backlinks && (
          <div className="max-h-56 overflow-auto px-4 pb-3 text-sm">
            {backlinks.links.length +
              backlinks.mentions.length +
              backlinks.journal.length +
              backlinks.tasks.length ===
              0 && <p className="text-content-muted">Nothing yet.</p>}
            {[...backlinks.links, ...backlinks.mentions].map((hit, i) => (
              <button
                key={`${hit.path}-${i}`}
                onClick={() => onOpen(hit.path)}
                className="block w-full border-b border-line/60 py-2 text-left"
              >
                <span className="block break-words">{hit.name}</span>
                <span className="block break-words text-xs text-content-muted">
                  {hit.preview}
                </span>
              </button>
            ))}
            {backlinks.journal.map((hit, i) => (
              <p key={`j-${i}`} className="border-b border-line/60 py-2">
                <span className="block break-words">Journal {hit.date}</span>
                <span className="block break-words text-xs text-content-muted">
                  {hit.preview}
                </span>
              </p>
            ))}
            {backlinks.tasks.map((hit, i) => (
              <p key={`t-${i}`} className="border-b border-line/60 py-2">
                <span className="block break-words">{hit.task.title}</span>
              </p>
            ))}
          </div>
        )}
        <button
          onClick={() => {
            if (!window.confirm(`Move ${note.path} to the trash?`)) return;
            void invoke("kb_delete", { path: note.path })
              .then(onClose)
              .catch((e) => setError(String(e)));
          }}
          className="w-full px-4 pb-3 text-left text-sm text-danger"
        >
          Move to trash
        </button>
      </div>
      )}
    </div>
  );
}

/**
 * Reading view: plain text, with `[[wiki links]]` turned into taps.
 *
 * Not a Markdown renderer - the desktop has one, and on a phone the
 * thing actually worth having is the ability to follow a link, which is
 * the one thing plain text cannot do.
 */
function ReadView({
  content,
  onOpen,
}: {
  content: string;
  onOpen: (path: string) => void;
}) {
  const parts = content.split(/(\[\[[^\]]+\]\])/g);
  return (
    <pre className="whitespace-pre-wrap break-words font-sans leading-relaxed">
      {parts.map((part, index) => {
        const match = /^\[\[([^\]]+)\]\]$/.exec(part);
        if (!match) return <span key={index}>{part}</span>;
        const target = match[1].split("|")[0].trim();
        return (
          <button
            key={index}
            onClick={() =>
              onOpen(target.endsWith(".md") ? target : `${target}.md`)
            }
            className="text-accent underline"
          >
            {target}
          </button>
        );
      })}
    </pre>
  );
}
