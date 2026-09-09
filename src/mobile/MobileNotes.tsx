import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import type { BacklinksResult, KbNode, KbSearchHit, KbStatus } from "../types";

const SAVE_DEBOUNCE_MS = 1200;

type Open = { path: string; content: string };

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

  const openPath = useCallback(
    (path: string) => {
      void invoke<string>("kb_read", { path })
        .then((content) => setNote({ path, content }))
        .catch((e) => setError(String(e)));
    },
    [setError],
  );

  if (note) {
    return (
      <NoteEditor
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

  const create = (kind: "note" | "folder") => {
    const name = window.prompt(
      kind === "note" ? "New note name" : "New folder name",
    );
    if (!name?.trim()) return;
    const trimmed = name.trim();
    const path =
      kind === "note" && !trimmed.endsWith(".md")
        ? `${folder}${trimmed}.md`
        : `${folder}${trimmed}`;
    void invoke<string>(kind === "note" ? "kb_create" : "kb_mkdir", { path })
      .then((created) => {
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
          showing the vault root as if it were what was asked for. */}
      {status?.unreachable && (
        <p className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-xs text-warn">
          Notes are being read from the vault: the configured folder (
          {status.configured}) does not exist on this device.
        </p>
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
          </ul>
          <div className="flex gap-2 border-t border-line p-3">
            <button
              onClick={() => create("note")}
              className="flex-1 rounded-lg bg-accent px-4 py-3 font-medium text-white"
            >
              + Note
            </button>
            <button
              onClick={() => create("folder")}
              className="rounded-lg border border-line px-4 py-3"
            >
              + Folder
            </button>
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
  const [editing, setEditing] = useState(false);
  const [backlinks, setBacklinks] = useState<BacklinksResult | null>(null);
  const [showBacklinks, setShowBacklinks] = useState(false);
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
      await invoke("kb_write", { path: note.path, content: outstanding });
      setSaved(true);
    } catch (e) {
      setError(String(e));
    }
  }, [note.path, setError]);
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

      <div className="shrink-0 border-t border-line">
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
