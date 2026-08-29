import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store";
import MarkdownEditor from "../components/MarkdownEditor";
import Icon from "../components/icons";
import { ConfirmModal, PromptModal } from "../components/dialogs";

import type { KbNode, KbSearchHit } from "../types";

// Vault config files editable right in the KB editor (validated on save)
const CONFIG_FILES = [
  "recurring.yml",
  "scheduled.yml",
  "birthdays.yml",
  "weekly-focus.yml",
  "day-reminders.yml",
  "day-schedule.yml",
  "templates/journal.md",
];

interface OpenDoc {
  kind: "note" | "config";
  path: string;
  content: string;
}

function flattenFiles(nodes: KbNode[]): KbNode[] {
  return nodes.flatMap((n) => (n.is_dir ? flattenFiles(n.children) : [n]));
}

// .md is the default note type and stays hidden; anything else shows
// its extension so non-standard files are recognizable
function displayName(name: string): string {
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

export default function KnowledgeBase() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const setError = useCallback(
    (e: unknown) => useAppStore.getState().setError(String(e)),
    [],
  );
  const [tree, setTree] = useState<KbNode[]>([]);
  // folders start collapsed on launch; the opened set lives in the
  // store so it survives switching sections during the session
  const expandedPaths = useAppStore((s) => s.kbExpanded);
  const expanded = new Set(expandedPaths);
  const toggleExpanded = (path: string) => {
    const store = useAppStore.getState();
    store.setKbExpanded(
      expanded.has(path)
        ? store.kbExpanded.filter((p) => p !== path)
        : [...store.kbExpanded, path],
    );
  };
  const [treeWidth, setTreeWidth] = useState(() => {
    const stored = Number(localStorage.getItem("kb-tree-width"));
    return stored >= 160 && stored <= 480 ? stored : 240;
  });
  const [search, setSearch] = useState("");
  const [contentHits, setContentHits] = useState<KbSearchHit[]>([]);
  const [current, setCurrent] = useState<OpenDoc | null>(null);
  const [configErrors, setConfigErrors] = useState<
    { line: number | null; message: string }[]
  >([]);
  const [saved, setSaved] = useState(true);
  const savedRef = useRef(true);
  savedRef.current = saved;
  const currentRef = useRef<OpenDoc | null>(null);
  currentRef.current = current;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<OpenDoc | null>(null);

  const kbPath = config?.kb_path?.trim() ?? "";

  const loadTree = useCallback(async () => {
    try {
      setTree(await invoke<KbNode[]>("kb_tree"));
    } catch (e) {
      setError(e);
    }
  }, [setError]);

  useEffect(() => {
    if (kbPath) void loadTree();
  }, [kbPath, loadTree]);

  // external edits: refresh the tree; reload the open file only when
  // there are no unsaved local changes. The open doc is read through a
  // ref so the Tauri subscription is created once, not re-registered on
  // every keystroke (which leaves windows where events are missed).
  useEffect(() => {
    const unlisten = listen("kb-updated", async () => {
      await loadTree();
      const doc = currentRef.current;
      if (doc && doc.kind === "note" && savedRef.current) {
        try {
          const content = await invoke<string>("kb_read", { path: doc.path });
          setCurrent((prev) =>
            prev && prev.path === doc.path ? { ...prev, content } : prev,
          );
        } catch {
          // file may have been deleted externally
          setCurrent(null);
          useAppStore.getState().setKbCurrent(null);
        }
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [loadTree]);

  // saves the debounced edit immediately (file switch, tab switch);
  // awaited before reads so a reopen never sees the pre-save file
  const flushPending = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      await persist(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // rename/delete of the open file: the debounced kb_write would
  // otherwise fire after the operation and resurrect the old path
  const dropPendingFor = (path: string) => {
    if (pendingRef.current?.path !== path) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingRef.current = null;
  };

  useEffect(() => {
    return () => void flushPending();
  }, [flushPending]);

  const openFile = async (path: string) => {
    await flushPending();
    try {
      const content = await invoke<string>("kb_read", { path });
      setCurrent({ kind: "note", path, content });
      useAppStore.getState().setKbCurrent({ kind: "note", path });
      setConfigErrors([]);
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  };

  const openConfig = async (file: string) => {
    await flushPending();
    try {
      const content = await invoke<string>("config_file_get", { file });
      setCurrent({ kind: "config", path: file, content });
      useAppStore.getState().setKbCurrent({ kind: "config", path: file });
      setConfigErrors([]);
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  };

  // returning to Notes reopens the document that was open before the
  // section switch (fresh content is read from disk)
  useEffect(() => {
    const remembered = useAppStore.getState().kbCurrent;
    if (!remembered) return;
    if (remembered.kind === "config") void openConfig(remembered.path);
    else void openFile(remembered.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (doc: OpenDoc) => {
    try {
      if (doc.kind === "config") {
        // invalid YAML is reported and never written (last valid
        // state stays active), same as the Settings editor
        const errors = await invoke<{ line: number | null; message: string }[]>(
          "config_file_set",
          { file: doc.path, content: doc.content },
        );
        setConfigErrors(errors);
        if (errors.length === 0) setSaved(true);
      } else {
        await invoke("kb_write", { path: doc.path, content: doc.content });
        setSaved(true);
      }
    } catch (e) {
      setError(e);
    }
  };

  const scheduleSave = (content: string) => {
    if (!current) return;
    const target: OpenDoc = { kind: current.kind, path: current.path, content };
    setCurrent(target);
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingRef.current = target;
    saveTimer.current = setTimeout(() => {
      pendingRef.current = null;
      void persist(target);
    }, 800);
  };

  type Dialog =
    | { kind: "create" }
    | { kind: "rename"; node: KbNode }
    | { kind: "delete"; node: KbNode };
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const createFile = async (name: string) => {
    setDialog(null);
    try {
      const path = await invoke<string>("kb_create", { path: name });
      await loadTree();
      await openFile(path);
    } catch (e) {
      setError(e);
    }
  };

  const renameFile = async (node: KbNode, to: string) => {
    setDialog(null);
    dropPendingFor(node.path);
    try {
      await invoke("kb_rename", { from: node.path, to });
      await loadTree();
      if (current?.path === node.path) {
        setCurrent(null);
        useAppStore.getState().setKbCurrent(null);
      }
    } catch (e) {
      setError(e);
    }
  };

  const deleteFile = async (node: KbNode) => {
    setDialog(null);
    // a debounced save of a file inside a deleted folder would recreate
    // the path, so drop it too
    const inside = (path: string | undefined) =>
      path === node.path || (node.is_dir && path?.startsWith(`${node.path}/`));
    if (inside(pendingRef.current?.path)) {
      dropPendingFor(pendingRef.current!.path);
    }
    try {
      await invoke("kb_delete", { path: node.path });
      await loadTree();
      if (current?.kind === "note" && inside(current.path)) {
        setCurrent(null);
        useAppStore.getState().setKbCurrent(null);
      }
    } catch (e) {
      setError(e);
    }
  };

  // navigation requests from elsewhere (error banner, focus line,
  // Settings links): open the named config file on arrival
  const kbOpenConfig = useAppStore((s) => s.kbOpenConfig);
  useEffect(() => {
    if (!kbOpenConfig) return;
    useAppStore.setState({ kbOpenConfig: null });
    void openConfig(kbOpenConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbOpenConfig]);

  // same channel for notes (search palette hits)
  const kbOpenNote = useAppStore((s) => s.kbOpenNote);
  useEffect(() => {
    if (!kbOpenNote) return;
    useAppStore.setState({ kbOpenNote: null });
    void openFile(kbOpenNote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbOpenNote]);

  const pickFolder = async () => {
    try {
      const path = await open({ directory: true, title: "Select KB folder" });
      if (typeof path === "string") {
        await updateConfig({ kb_path: path });
      }
    } catch (e) {
      setError(e);
    }
  };

  const query = search.trim().toLowerCase();
  const searchResults = query
    ? flattenFiles(tree).filter((f) => f.name.toLowerCase().includes(query))
    : null;

  // content search runs alongside the filename filter, debounced
  useEffect(() => {
    if (!query || !kbPath) {
      setContentHits([]);
      return;
    }
    const timer = setTimeout(() => {
      invoke<KbSearchHit[]>("kb_search", { query })
        .then(setContentHits)
        .catch(() => setContentHits([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, kbPath]);

  const nameMatchPaths = new Set((searchResults ?? []).map((f) => f.path));
  const extraContentHits = contentHits.filter(
    (h) => !nameMatchPaths.has(h.path),
  );

  const renderNode = (node: KbNode, depth: number) => (
    <div key={node.path}>
      <div
        className={`group flex items-center gap-1 rounded px-2 py-0.5 text-sm ${
          !node.is_dir && current?.path === node.path
            ? "bg-accent/15 text-accent"
            : "text-content-muted hover:bg-line/40 hover:text-content"
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {node.is_dir ? (
          <>
            <button
              className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium"
              onClick={() => toggleExpanded(node.path)}
            >
              <Icon
                name={expanded.has(node.path) ? "chevronDown" : "chevronRight"}
                className="h-3 w-3 shrink-0"
              />
              <span className="truncate">{node.name}</span>
            </button>
            <button
              className="opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              title="Delete folder"
              onClick={() => setDialog({ kind: "delete", node })}
            >
              <Icon name="trash" className="h-3 w-3" />
            </button>
          </>
        ) : (
          <>
            <button
              className="flex-1 truncate text-left"
              onClick={() => void openFile(node.path)}
            >
              {displayName(node.name)}
            </button>
            <button
              className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
              title="Rename"
              onClick={() => setDialog({ kind: "rename", node })}
            >
              <Icon name="pencil" className="h-3 w-3" />
            </button>
            <button
              className="opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              title="Delete"
              onClick={() => setDialog({ kind: "delete", node })}
            >
              <Icon name="trash" className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
      {node.is_dir &&
        expanded.has(node.path) &&
        node.children.map((child) => renderNode(child, depth + 1))}
    </div>
  );

  return (
    <div className="flex h-full">
      <aside
        className="flex shrink-0 flex-col border-r border-line bg-surface-alt/50"
        style={{ width: treeWidth }}
      >
        {kbPath ? (
          <>
            <div className="flex items-center gap-1 p-2">
              <input
                className="input min-w-0 flex-1 py-1 text-xs"
                placeholder="Search notes"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                className="rounded-md border border-line px-2 py-1 text-xs text-content-muted hover:border-accent hover:text-accent"
                title="New note"
                onClick={() => setDialog({ kind: "create" })}
              >
                +
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
              {searchResults
                ? searchResults.map((node) => renderNode(node, 0))
                : tree.map((node) => renderNode(node, 0))}
              {searchResults && extraContentHits.length > 0 && (
                <>
                  <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
                    In content
                  </div>
                  {extraContentHits.map((hit) => (
                    <button
                      key={hit.path}
                      className="block w-full rounded px-2 py-1 text-left hover:bg-line/40"
                      onClick={() => void openFile(hit.path)}
                    >
                      <span className="block truncate text-sm text-content-muted hover:text-content">
                        {displayName(hit.name)}
                      </span>
                      <span className="block truncate text-[11px] text-content-muted/70">
                        {hit.line}: {hit.preview}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-3 text-center">
            <p className="text-xs text-content-muted">
              Connect a folder with Markdown notes. The app only reads the
              tree and edits files you open; it never restructures the
              folder.
            </p>
            <button
              className="btn-primary px-3 text-xs"
              onClick={() => void pickFolder()}
            >
              Select KB folder
            </button>
          </div>
        )}
        <div className="border-t border-line px-1 py-2">
          <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
            Config
          </div>
          {CONFIG_FILES.map((file) => (
            <button
              key={file}
              className={`block w-full truncate rounded px-2 py-0.5 text-left text-sm ${
                current?.kind === "config" && current.path === file
                  ? "bg-accent/15 text-accent"
                  : "text-content-muted hover:bg-line/40 hover:text-content"
              }`}
              onClick={() => void openConfig(file)}
            >
              {file}
            </button>
          ))}
        </div>
        {kbPath && (
          <button
            className="border-t border-line px-3 py-2 text-left text-[11px] text-content-muted hover:text-content"
            title={kbPath}
            onClick={() => void pickFolder()}
          >
            Change folder
          </button>
        )}
      </aside>

      <div
        className="w-1 shrink-0 cursor-col-resize hover:bg-accent/40"
        title="Drag to resize"
        onPointerDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startWidth = treeWidth;
          const clamp = (x: number) => Math.min(480, Math.max(160, x));
          const onMove = (ev: PointerEvent) =>
            setTreeWidth(clamp(startWidth + ev.clientX - startX));
          const onUp = (ev: PointerEvent) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            localStorage.setItem(
              "kb-tree-width",
              String(clamp(startWidth + ev.clientX - startX)),
            );
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {current ? (
          <>
            <div className="flex items-center justify-between border-b border-line px-4 py-2 text-sm">
              <span className="truncate font-medium">
                {current.kind === "config"
                  ? `config/${current.path}`
                  : current.path}
              </span>
              <span
                className={`text-xs ${
                  configErrors.length > 0
                    ? "text-danger"
                    : "text-content-muted"
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
                onChange={scheduleSave}
                mode={
                  current.path.toLowerCase().endsWith(".md")
                    ? "markdown"
                    : /\.ya?ml$/i.test(current.path)
                      ? "yaml"
                      : "plain"
                }
                showLineNumbers={
                  (current.kind === "config" &&
                    !current.path.endsWith(".md")) ||
                  (config?.kb_line_numbers ?? false)
                }
              />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-content-muted">
            Select a note
          </div>
        )}
      </div>
      {dialog?.kind === "create" && (
        <PromptModal
          title="New note"
          placeholder="Path, e.g. ideas/note"
          submitLabel="Create"
          onSubmit={(name) => void createFile(name)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename" && (
        <PromptModal
          title={`Rename ${dialog.node.path}`}
          initial={dialog.node.path.replace(/\.md$/i, "")}
          submitLabel="Rename"
          onSubmit={(to) => void renameFile(dialog.node, to)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmModal
          title={`Delete ${dialog.node.path}?`}
          message={
            dialog.node.is_dir
              ? "The folder and everything inside it is removed. There is no undo."
              : "The file is removed from the folder. There is no undo."
          }
          onConfirm={() => void deleteFile(dialog.node)}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
