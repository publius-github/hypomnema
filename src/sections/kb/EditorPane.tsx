import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import MarkdownEditor from "../../components/MarkdownEditor";
import { useAppStore } from "../../store";
import type { KbBacklinks, KbSearchHit } from "../../types";
import type { OpenDoc } from "./util";

/**
 * Collapsible backlinks strip under the editor: notes whose [[wiki
 * links]] point at the open note, plus unlinked plain-text mentions.
 * Fetched per note; a click opens the referencing note.
 */
function BacklinksPanel({ path }: { path: string }) {
  const [data, setData] = useState<KbBacklinks | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    invoke<KbBacklinks>("kb_backlinks", { path })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => setData(null));
    return () => {
      cancelled = true;
    };
  }, [path]);

  const total = (data?.links.length ?? 0) + (data?.mentions.length ?? 0);
  if (!data || total === 0) return null;

  const hitRow = (hit: KbSearchHit) => (
    <button
      key={hit.path}
      className="block w-full rounded px-2 py-1 text-left hover:bg-line/40"
      onClick={() => useAppStore.getState().openKbNote(hit.path)}
    >
      <span className="block truncate text-sm text-content">{hit.name}</span>
      <span className="block truncate text-[11px] text-content-muted">
        {hit.line}: {hit.preview}
      </span>
    </button>
  );

  return (
    <div className="shrink-0 border-t border-line">
      <button
        className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-content-muted hover:text-content"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{open ? "▾" : "▸"}</span>
        Backlinks ({data.links.length})
        {data.mentions.length > 0 && ` · Mentions (${data.mentions.length})`}
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto px-2 pb-2">
          {data.links.map(hitRow)}
          {data.mentions.length > 0 && (
            <>
              <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
                Unlinked mentions
              </div>
              {data.mentions.map(hitRow)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The right side of the Notes section: open-file header with the save
 *  status, config validation errors, and the CodeMirror editor. */
export default function EditorPane({
  current,
  saved,
  configErrors,
  lineNumbers,
  onChange,
}: {
  current: OpenDoc;
  saved: boolean;
  configErrors: { line: number | null; message: string }[];
  lineNumbers: boolean;
  onChange: (content: string) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 text-sm">
        <span className="truncate text-base font-semibold">
          {current.kind === "config" ? `config/${current.path}` : current.path}
        </span>
        {/* the gesture is not guessable, and a link that looks
            dead is the same as no link */}
        <span className="ml-auto shrink-0 text-xs text-content-muted">
          Ctrl/Cmd+click a link to open it
        </span>
        <span
          className={`text-xs ${
            configErrors.length > 0 ? "text-danger" : "text-content-muted"
          }`}
        >
          {configErrors.length > 0
            ? "Invalid, not saved"
            : saved
              ? "Saved"
              : "Saving..."}
        </span>
      </div>
      {configErrors.length > 0 && (
        <div className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-xs text-danger">
          {configErrors.map((err, i) => (
            <div key={i}>
              {err.line !== null ? `line ${err.line}: ` : ""}
              {err.message}
            </div>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <MarkdownEditor
          docKey={`${current.kind}:${current.path}`}
          value={current.content}
          onChange={onChange}
          mode={
            current.path.toLowerCase().endsWith(".md")
              ? "markdown"
              : /\.ya?ml$/i.test(current.path)
                ? "yaml"
                : "plain"
          }
          showLineNumbers={
            (current.kind === "config" && !current.path.endsWith(".md")) ||
            lineNumbers
          }
          onWikiLink={(name) =>
            void useAppStore.getState().openKbNoteByName(name)
          }
        />
      </div>
      {current.kind === "note" && current.path.toLowerCase().endsWith(".md") && (
        <BacklinksPanel path={current.path} />
      )}
    </>
  );
}
