import { lazy, Suspense, useEffect, useState } from "react";
import { invoke } from "../../lib/ipc";

// CodeMirror loads on first use, same as in the Journal
const MarkdownEditor = lazy(() => import("../../components/MarkdownEditor"));
import TaskModal from "../../components/TaskModal";
import { useAppStore } from "../../store";
import { splitCategory } from "../../lib/tasks";
import type { BacklinksResult, KbSearchHit, Task } from "../../types";
import {
  configFilePath,
  editorModeFor,
  noteBodyOffset,
  type OpenDoc,
  type SaveState,
} from "./util";
import SaveIndicator from "../../components/SaveIndicator";
import { errorMessage } from "../../lib/ipc";

/**
 * Collapsible backlinks strip under the editor: notes whose [[wiki
 * links]] point at the open note, unlinked plain-text mentions, journal
 * entries and tasks linking to it. A note/journal hit navigates there;
 * a task hit opens the task dialog in place.
 */
function BacklinksPanel({ path }: { path: string }) {
  const [data, setData] = useState<BacklinksResult | null>(null);
  const [open, setOpen] = useState(false);
  const [openTask, setOpenTask] = useState<Task | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    invoke("kb_backlinks", { path })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e) => {
        useAppStore.getState().setError(errorMessage(e));
        setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const total =
    (data?.links.length ?? 0) +
    (data?.mentions.length ?? 0) +
    (data?.journal.length ?? 0) +
    (data?.tasks.length ?? 0);
  if (!data || total === 0) return null;

  const groupHeader = (label: string) => (
    <div className="px-2 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-content-muted">
      {label}
    </div>
  );

  const hitRow = (hit: KbSearchHit) => (
    <button
      key={hit.path}
      className="block w-full rounded-sm px-2 py-1 text-left hover:bg-line/40"
      onClick={() => useAppStore.getState().openKbNote(hit.path)}
    >
      <span className="block truncate text-sm text-content">{hit.name}</span>
      <span className="block truncate text-[0.6875rem] text-content-muted">
        {hit.line}: {hit.preview}
      </span>
    </button>
  );

  const summary = [
    `Backlinks (${data.links.length})`,
    data.mentions.length > 0 && `Mentions (${data.mentions.length})`,
    data.journal.length > 0 && `Journal (${data.journal.length})`,
    data.tasks.length > 0 && `Tasks (${data.tasks.length})`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="shrink-0 border-t border-line">
      <button
        className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-content-muted hover:text-content"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{open ? "▾" : "▸"}</span>
        {summary}
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto px-2 pb-2">
          {data.links.map(hitRow)}
          {data.mentions.length > 0 && (
            <>
              {groupHeader("Unlinked mentions")}
              {data.mentions.map(hitRow)}
            </>
          )}
          {data.journal.length > 0 && (
            <>
              {groupHeader("From journal")}
              {data.journal.map((hit) => (
                <button
                  key={hit.date}
                  className="block w-full rounded-sm px-2 py-1 text-left hover:bg-line/40"
                  onClick={() =>
                    useAppStore.getState().openJournalDate(hit.date)
                  }
                >
                  <span className="block truncate text-sm text-content">
                    {hit.date}
                    {!hit.is_link && (
                      <span className="text-[0.6875rem] text-content-muted">
                        {" "}
                        (mention)
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[0.6875rem] text-content-muted">
                    {hit.line}: {hit.preview}
                  </span>
                </button>
              ))}
            </>
          )}
          {data.tasks.length > 0 && (
            <>
              {groupHeader("From tasks")}
              {data.tasks.map((hit) => (
                <button
                  key={hit.task.id}
                  className="block w-full rounded-sm px-2 py-1 text-left hover:bg-line/40"
                  onClick={() => setOpenTask(hit.task)}
                >
                  <span className="block truncate text-sm text-content">
                    {splitCategory(hit.task.title).text}
                  </span>
                  <span className="block truncate text-[0.6875rem] text-content-muted">
                    {hit.preview}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {openTask && (
        <TaskModal task={openTask} onClose={() => setOpenTask(null)} />
      )}
    </div>
  );
}

/** The right side of the Notes section: open-file header with the save
 *  status, config validation errors, and the CodeMirror editor. */
export default function EditorPane({
  current,
  saveState,
  onRetry,
  configErrors,
  lineNumbers,
  onChange,
}: {
  current: OpenDoc;
  saveState: SaveState;
  onRetry: () => void;
  configErrors: { line: number | null; message: string }[];
  lineNumbers: boolean;
  onChange: (content: string) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 text-sm">
        <span className="truncate text-base font-semibold">
          {current.kind === "config" ? configFilePath(current.path) : current.path}
        </span>
        {configErrors.length > 0 ? (
          <span className="text-xs text-danger">Invalid, not saved</span>
        ) : (
          <SaveIndicator state={saveState} onRetry={onRetry} />
        )}
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
        <Suspense fallback={null}>
          <MarkdownEditor
            docKey={`${current.kind}:${current.path}`}
            label={current.path}
            value={current.content}
            initialAnchor={
              current.kind === "note" ? noteBodyOffset(current.content) : 0
            }
            onChange={onChange}
            mode={editorModeFor(current.path)}
            showLineNumbers={
              (current.kind === "config" && !current.path.endsWith(".md")) ||
              lineNumbers
            }
            onWikiLink={(name) =>
              void useAppStore.getState().openKbNoteByName(name)
            }
          />
        </Suspense>
      </div>
      {current.kind === "note" && current.path.toLowerCase().endsWith(".md") && (
        <BacklinksPanel path={current.path} />
      )}
    </>
  );
}
