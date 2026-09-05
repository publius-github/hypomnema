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

function flattenAll(nodes: KbNode[]): KbNode[] {
  return nodes.flatMap((n) => [n, ...(n.is_dir ? flattenAll(n.children) : [])]);
}

const parentDirOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const basenameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

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
    | { kind: "create"; dir?: string }
    | { kind: "createFolder"; dir?: string }
    | { kind: "rename"; node: KbNode }
    | { kind: "delete"; node: KbNode }
    | { kind: "deleteMany"; paths: string[] };
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // right-click menu over the tree; `node` null = the root row/space
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    node: KbNode | null;
  } | null>(null);
  // drop target highlight: a folder path, or "" for the tree root
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // what a drag carries (same window, so a ref beats dataTransfer)
  const dragPaths = useRef<string[]>([]);

  // IDE-style tree selection: click selects (and opens a file),
  // Ctrl/Cmd+click toggles, Shift+click ranges over the visible rows
  const [selected, setSelected] = useState<string[]>([]);
  const selectedSet = new Set(selected);
  const anchorRef = useRef<string | null>(null);
  // internal file clipboard for Ctrl+C / Ctrl+X / Ctrl+V in the tree
  const [clipboard, setClipboard] = useState<{
    paths: string[];
    cut: boolean;
  } | null>(null);

  const visibleOrder = (nodes: KbNode[]): string[] =>
    nodes.flatMap((n) => [
      n.path,
      ...(n.is_dir && expanded.has(n.path) ? visibleOrder(n.children) : []),
    ]);

  const selectRow = (node: KbNode, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      anchorRef.current = node.path;
      setSelected((prev) =>
        prev.includes(node.path)
          ? prev.filter((p) => p !== node.path)
          : [...prev, node.path],
      );
      return true; // handled: no open/expand on ctrl-click
    }
    if (e.shiftKey && anchorRef.current) {
      const order = visibleOrder(tree);
      const a = order.indexOf(anchorRef.current);
      const b = order.indexOf(node.path);
      if (a >= 0 && b >= 0) {
        setSelected(order.slice(Math.min(a, b), Math.max(a, b) + 1));
        return true;
      }
    }
    anchorRef.current = node.path;
    setSelected([node.path]);
    return false;
  };

  const deleteMany = async (paths: string[]) => {
    setDialog(null);
    for (const path of paths) {
      const inside = (p: string | undefined) =>
        p === path || p?.startsWith(`${path}/`);
      if (inside(pendingRef.current?.path)) {
        dropPendingFor(pendingRef.current!.path);
      }
      try {
        await invoke("kb_delete", { path });
      } catch (e) {
        setError(e);
      }
      if (current?.kind === "note" && inside(current.path)) {
        setCurrent(null);
        useAppStore.getState().setKbCurrent(null);
      }
    }
    setSelected([]);
    await loadTree();
  };

  /**
   * Moves files and folders into `toDir` ("" = the KB root), keeping
   * their names. Backs both the tree's drag-and-drop and Ctrl+X/Ctrl+V.
   * A note open in the editor follows the move instead of closing.
   */
  const moveInto = async (paths: string[], toDir: string) => {
    let reopen: string | null = null;
    for (const from of paths) {
      const target = toDir ? `${toDir}/${basenameOf(from)}` : basenameOf(from);
      if (target === from) continue;
      if (toDir === from || toDir.startsWith(`${from}/`)) {
        setError(`cannot move "${from}" into itself`);
        continue;
      }
      try {
        dropPendingFor(from);
        await invoke("kb_rename", { from, to: target });
        if (current?.kind === "note" && current.path === from) {
          reopen = target;
        }
      } catch (e) {
        setError(e);
      }
    }
    setSelected([]);
    await loadTree();
    if (reopen) await openFile(reopen);
  };

  const pasteClipboard = async () => {
    if (!clipboard) return;
    // paste target: the selected folder, a selected file's folder, or
    // the root when the selection is empty/mixed
    const nodes = flattenAll(tree);
    let toDir = "";
    if (selected.length === 1) {
      const node = nodes.find((n) => n.path === selected[0]);
      if (node) toDir = node.is_dir ? node.path : parentDirOf(node.path);
    }
    if (clipboard.cut) {
      await moveInto(clipboard.paths, toDir);
      setClipboard(null);
      return;
    }
    for (const from of clipboard.paths) {
      try {
        await invoke("kb_copy", { from, toDir });
      } catch (e) {
        setError(e);
      }
    }
    setSelected([]);
    await loadTree();
  };

  /** Drop handler shared by the folder rows and the root area. */
  const dropOnto = (toDir: string) => {
    const paths = dragPaths.current;
    dragPaths.current = [];
    setDropTarget(null);
    if (paths.length === 0) return;
    void moveInto(paths, toDir);
  };

  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const nodes = flattenAll(tree);
    if (e.key === "F2" && selected.length === 1) {
      const node = nodes.find((n) => n.path === selected[0]);
      if (node) {
        e.preventDefault();
        setDialog({ kind: "rename", node });
      }
    } else if ((e.key === "Delete" || (e.key === "Backspace" && mod)) && selected.length > 0) {
      e.preventDefault();
      setDialog({ kind: "deleteMany", paths: [...selected] });
      // letter shortcuts match on e.code (the physical key), so they
      // keep working on non-Latin keyboard layouts where e.key differs
    } else if (mod && e.code === "KeyC" && selected.length > 0) {
      e.preventDefault();
      setClipboard({ paths: [...selected], cut: false });
    } else if (mod && e.code === "KeyX" && selected.length > 0) {
      e.preventDefault();
      setClipboard({ paths: [...selected], cut: true });
    } else if (mod && e.code === "KeyV" && clipboard) {
      e.preventDefault();
      void pasteClipboard();
    } else if (mod && e.code === "KeyA") {
      e.preventDefault();
      setSelected(visibleOrder(tree));
    } else if (e.key === "Escape") {
      setSelected([]);
      setClipboard(null);
    }
  };

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

  const createFolder = async (name: string) => {
    setDialog(null);
    try {
      const path = await invoke<string>("kb_mkdir", { path: name });
      await loadTree();
      // a folder created invisibly (collapsed parents) reads as
      // "nothing happened": open the path down to it
      const store = useAppStore.getState();
      const parents = path
        .split("/")
        .slice(0, -1)
        .map((_, i, all) => all.slice(0, i + 1).join("/"));
      store.setKbExpanded([
        ...new Set([...store.kbExpanded, ...parents, path]),
      ]);
      setSelected([path]);
    } catch (e) {
      setError(e);
    }
  };

  const copyPath = async (path: string) => {
    try {
      const absolute = await invoke<string>("kb_abs_path", { path });
      await navigator.clipboard.writeText(absolute);
    } catch (e) {
      setError(e);
    }
  };

  const revealPath = async (path: string) => {
    try {
      await invoke("kb_reveal", { path });
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

  // dragging a row that is part of the selection carries the whole
  // selection; dragging any other row carries just that row
  const onDragStart = (node: KbNode) => {
    dragPaths.current = selectedSet.has(node.path) ? [...selected] : [node.path];
  };

  const renderNode = (node: KbNode, depth: number) => (
    <div key={node.path}>
      <div
        draggable
        onDragStart={() => onDragStart(node)}
        onDragEnd={() => {
          dragPaths.current = [];
          setDropTarget(null);
        }}
        // dropping on a file means dropping into its folder, so the
        // highlight lands on that folder's row (or the root area)
        onDragOver={(e) => {
          if (dragPaths.current.length === 0) return;
          e.preventDefault();
          e.stopPropagation();
          setDropTarget(node.is_dir ? node.path : parentDirOf(node.path));
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dropOnto(node.is_dir ? node.path : parentDirOf(node.path));
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!selectedSet.has(node.path)) {
            anchorRef.current = node.path;
            setSelected([node.path]);
          }
          setMenu({ x: e.clientX, y: e.clientY, node });
        }}
        className={`group flex items-center gap-1 rounded px-2 py-0.5 text-sm ${
          dropTarget === node.path
            ? "bg-accent/25 text-content ring-1 ring-accent"
            : selectedSet.has(node.path)
              ? "bg-accent/20 text-content"
              : !node.is_dir && current?.path === node.path
                ? "bg-accent/15 text-accent"
                : "text-content hover:bg-line/40"
        } ${clipboard?.cut && clipboard.paths.includes(node.path) ? "opacity-50" : ""}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {node.is_dir ? (
          <>
            <button
              className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium"
              onClick={(e) => {
                if (!selectRow(node, e)) toggleExpanded(node.path);
              }}
            >
              <Icon
                name={expanded.has(node.path) ? "chevronDown" : "chevronRight"}
                className="h-3 w-3 shrink-0"
              />
              <span className="truncate">{node.name}</span>
            </button>
            <button
              className="px-0.5 opacity-0 hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
              title="New note in this folder"
              onClick={() => setDialog({ kind: "create", dir: node.path })}
            >
              +
            </button>
            <button
              className="px-0.5 opacity-0 hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
              title="New folder inside this one"
              onClick={() => setDialog({ kind: "createFolder", dir: node.path })}
            >
              <Icon name="folderPlus" className="h-3.5 w-3.5" />
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
              onClick={(e) => {
                if (!selectRow(node, e)) void openFile(node.path);
              }}
            >
              {node.name}
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
              <button
                className="rounded-md border border-line px-1.5 py-1 text-content-muted hover:border-accent hover:text-accent"
                title="New folder"
                onClick={() => setDialog({ kind: "createFolder" })}
              >
                <Icon name="folderPlus" className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* focusable so the tree takes IDE keys: F2 rename, Delete,
                Ctrl+C/X/V copy-cut-paste, Ctrl+A select all */}
            <div
              className={`min-h-0 flex-1 overflow-y-auto px-1 pb-2 outline-none ${
                dropTarget === "" ? "bg-accent/10" : ""
              }`}
              tabIndex={0}
              onKeyDown={onTreeKeyDown}
              // the free space around the rows is the KB root as a drop
              // target, the way an IDE's tree background is
              onDragOver={(e) => {
                if (dragPaths.current.length === 0) return;
                e.preventDefault();
                setDropTarget("");
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDropTarget(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropOnto("");
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, node: null });
              }}
            >
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
                      <span className="block truncate text-sm text-content">
                        {hit.name}
                      </span>
                      <span className="block truncate text-[11px] text-content-muted">
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
                  : "text-content hover:bg-line/40"
              }`}
              onClick={() => void openConfig(file)}
            >
              {file}
            </button>
          ))}
        </div>
        {kbPath && (
          <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[11px] text-content-muted">
            <button
              className="min-w-0 flex-1 truncate text-left hover:text-content"
              title={kbPath}
              onClick={() => void pickFolder()}
            >
              Change folder
            </button>
            <button
              className="shrink-0 hover:text-content"
              title="Show the notes folder in the file manager"
              onClick={() => void revealPath("")}
            >
              Open
            </button>
            <button
              className="shrink-0 hover:text-content"
              title="Copy the absolute path of the notes folder"
              onClick={() => void copyPath("")}
            >
              Copy path
            </button>
          </div>
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
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 text-sm">
              <span className="truncate text-base font-semibold">
                {current.kind === "config"
                  ? `config/${current.path}`
                  : current.path}
              </span>
              {/* the gesture is not guessable, and a link that looks
                  dead is the same as no link */}
              <span className="ml-auto shrink-0 text-xs text-content-muted">
                Ctrl/Cmd+click a link to open it
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
                onWikiLink={(name) =>
                  void useAppStore.getState().openKbNoteByName(name)
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
      {menu && (
        <TreeMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={(() => {
            const node = menu.node;
            const dir = node ? (node.is_dir ? node.path : parentDirOf(node.path)) : "";
            const many = selected.length > 1 && node !== null;
            return [
              { label: "New note", onClick: () => setDialog({ kind: "create", dir }) },
              {
                label: "New folder",
                onClick: () => setDialog({ kind: "createFolder", dir }),
              },
              ...(node
                ? [
                    { separator: true as const },
                    {
                      label: "Rename",
                      hint: "F2",
                      disabled: many,
                      onClick: () => setDialog({ kind: "rename", node }),
                    },
                    {
                      label: "Copy",
                      hint: "Ctrl+C",
                      onClick: () =>
                        setClipboard({ paths: [...selected], cut: false }),
                    },
                    {
                      label: "Cut",
                      hint: "Ctrl+X",
                      onClick: () =>
                        setClipboard({ paths: [...selected], cut: true }),
                    },
                  ]
                : []),
              ...(clipboard
                ? [
                    {
                      label: `Paste into ${dir || "the notes root"}`,
                      hint: "Ctrl+V",
                      onClick: () => void pasteClipboard(),
                    },
                  ]
                : []),
              { separator: true as const },
              {
                label: "Show in file manager",
                onClick: () => void revealPath(node ? node.path : ""),
              },
              {
                label: "Copy absolute path",
                onClick: () => void copyPath(node ? node.path : ""),
              },
              ...(node
                ? [
                    { separator: true as const },
                    {
                      label: many ? `Delete ${selected.length} items` : "Delete",
                      hint: "Del",
                      danger: true,
                      onClick: () =>
                        setDialog(
                          many
                            ? { kind: "deleteMany", paths: [...selected] }
                            : { kind: "delete", node },
                        ),
                    },
                  ]
                : []),
            ];
          })()}
        />
      )}
      {dialog?.kind === "create" && (
        <CreateNoteModal
          initialDir={dialog.dir}
          onSubmit={(name) => void createFile(name)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "createFolder" && (
        <PromptModal
          title="New folder"
          initial={dialog.dir ? `${dialog.dir}/` : ""}
          placeholder="Path, e.g. projects/2026"
          submitLabel="Create"
          onSubmit={(name) => void createFolder(name)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "deleteMany" && (
        <ConfirmModal
          title={`Delete ${dialog.paths.length} selected item${
            dialog.paths.length > 1 ? "s" : ""
          }?`}
          message="Everything moves to .trash inside the notes folder (kept for 30 days)."
          onConfirm={() => void deleteMany(dialog.paths)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename" && (
        <PromptModal
          title={`Rename ${dialog.node.path}`}
          initial={dialog.node.path}
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
              ? "The folder and everything inside it moves to .trash inside the notes folder (kept for 30 days)."
              : "The file moves to .trash inside the notes folder (kept for 30 days)."
          }
          onConfirm={() => void deleteFile(dialog.node)}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}

type MenuItem =
  | { separator: true }
  | {
      label: string;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      onClick: () => void;
    };

/**
 * IDE-style context menu for the file tree. Positioned at the cursor
 * and flipped back inside the window when it would overflow; any click
 * or Escape closes it, and picking an item runs its action first.
 */
function TreeMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onMouseDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        className="fixed z-50 min-w-[190px] rounded-md border border-line bg-surface py-1 shadow-xl"
        style={{ left: pos.left, top: pos.top }}
      >
        {items.map((item, i) =>
          "separator" in item ? (
            <div key={i} className="my-1 h-px bg-line" />
          ) : (
            <button
              key={i}
              disabled={item.disabled}
              className={`flex w-full items-center gap-4 px-3 py-1 text-left text-sm disabled:opacity-40 ${
                item.danger
                  ? "text-danger hover:bg-danger/10"
                  : "text-content hover:bg-line/40"
              }`}
              onClick={() => {
                onClose();
                item.onClick();
              }}
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && (
                <span className="shrink-0 text-[11px] text-content-muted">
                  {item.hint}
                </span>
              )}
            </button>
          ),
        )}
      </div>
    </>
  );
}

/**
 * New-note dialog with an explicit extension completion: a name typed
 * without an extension shows the ".md" completion the user accepts with
 * Tab (or a click) instead of the extension being appended silently.
 */
function CreateNoteModal({
  initialDir,
  onSubmit,
  onCancel,
}: {
  /** Folder the note starts in (the + on a folder row); editable text. */
  initialDir?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialDir ? `${initialDir}/` : "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // caret after the prefilled folder path, ready for the note name
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const trimmed = value.trim();
  const hasExtension = /\.[^./\\]+$/.test(trimmed);
  const suggestion = trimmed && !hasExtension ? `${trimmed}.md` : null;
  const submit = () => {
    if (!trimmed) return;
    onSubmit(suggestion ?? trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex w-[400px] flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-xl"
      >
        <span className="text-sm font-semibold">New note</span>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            className="input w-full"
            placeholder="Path, e.g. ideas/note"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
              if (e.key === "Tab" && suggestion) {
                e.preventDefault();
                setValue(suggestion);
              }
            }}
          />
        </form>
        {suggestion ? (
          <button
            className="self-start rounded bg-accent/15 px-2 py-0.5 text-xs text-accent hover:bg-accent/25"
            title="Tab or click to accept"
            onClick={() => setValue(suggestion)}
          >
            {suggestion}
          </button>
        ) : (
          <span className="text-xs text-content-muted">
            {hasExtension
              ? `Creates ${trimmed}`
              : "Type a name; Tab completes the .md extension"}
          </span>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-content-muted"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button className="btn-primary px-3" onClick={submit}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
