import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import type { KbNode } from "../types";

/**
 * Notes: browse and read (ROADMAP.md Phase 2 scopes editing to later).
 *
 * Folders open in place rather than as a tree with indentation - on a
 * narrow screen a deep tree spends most of its width on whitespace, so
 * this walks one folder at a time with a path trail back out.
 */
export default function MobileNotes() {
  const setError = useAppStore((s) => s.setError);
  const [tree, setTree] = useState<KbNode[]>([]);
  const [trail, setTrail] = useState<KbNode[]>([]);
  const [note, setNote] = useState<{ path: string; content: string } | null>(
    null,
  );

  useEffect(() => {
    void invoke<KbNode[]>("kb_tree")
      .then(setTree)
      .catch((e) => setError(String(e)));
  }, [setError]);

  const open = (node: KbNode) => {
    if (node.is_dir) {
      setTrail((t) => [...t, node]);
      return;
    }
    void invoke<string>("kb_read", { path: node.path })
      .then((content) => setNote({ path: node.path, content }))
      .catch((e) => setError(String(e)));
  };

  if (note) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-3">
          <button
            onClick={() => setNote(null)}
            className="px-2 py-1 text-content-muted"
          >
            ‹ Back
          </button>
          <span className="min-w-0 truncate font-semibold">{note.path}</span>
        </header>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-sans leading-relaxed">
          {note.content}
        </pre>
      </div>
    );
  }

  const here = trail.length > 0 ? trail[trail.length - 1].children : tree;

  return (
    <div className="flex h-full flex-col">
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
              onClick={() => open(node)}
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
    </div>
  );
}
