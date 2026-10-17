import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store";
import Icon from "../components/icons";
import { ConfirmModal, PromptModal } from "../components/dialogs";
import TreeMenu from "./kb/TreeMenu";
import CreateNoteModal from "./kb/CreateNoteModal";
import NoteRow, { type TreeCtx } from "./kb/NoteRow";
import EditorPane from "./kb/EditorPane";
import {
  CONFIG_FILES,
  type OpenDoc,
  basenameOf,
  flattenAll,
  flattenFiles,
  parentDirOf,
  settleSave,
} from "./kb/util";
import { AUTOSAVE_DELAY_MS, useAutosave } from "../hooks/useAutosave";

import type { KbNode, KbSearchHit } from "../types";

/**
 * Where `kb_rename` puts `node` given `to`: a file whose new name has no
 * extension keeps its old one (the backend's rule), a folder takes the
 * name as typed.
 */
function renamedPath(node: KbNode, to: string): string {
  if (node.is_dir || /\.[^/.]+$/.test(basenameOf(to))) return to;
  const ext = /\.[^/.]+$/.exec(basenameOf(node.path));
  return ext ? to + ext[0] : to;
}

export default function KnowledgeBase() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const setError = useCallback(
    (e: unknown) => useAppStore.getState().setError(errorMessage(e)),
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
  const currentRef = useRef<OpenDoc | null>(null);
  currentRef.current = current;
  // the on-disk text the open note's editor text derives from: each save
  // sends it, so a change that landed under the editor (a sync merging
  // the other device's edit) is merged in rather than overwritten
  const baseRef = useRef<{ path: string; text: string } | null>(null);

  // autosave with debounce: flushed (awaited) before a file switch, a
  // rename or leaving, so a reopen never reads the pre-save file
  const {
    saveState,
    savedRef,
    flush: flushPending,
    drop: dropPending,
    loaded: markLoaded,
    schedule,
  } = useAutosave<OpenDoc>(
    async (doc) => {
      if (doc.kind === "config") {
        // invalid YAML is reported and never written (last valid
        // state stays active), same as the Settings editor
        const errors = await invoke("config_file_set", {
          file: doc.path,
          content: doc.content,
        });
        setConfigErrors(errors);
        return errors.length === 0;
      }
      const base = baseRef.current;
      const written = await invoke("kb_write", {
        path: doc.path,
        content: doc.content,
        base: base?.path === doc.path ? base.text : null,
      });
      // the save stamped the note's Created / Last edited header, or
      // merged in a change made elsewhere: the editor takes it over
      // without losing what was typed meanwhile
      const cur = currentRef.current;
      if (cur && cur.kind === "note" && cur.path === doc.path) {
        const settled = settleSave(doc.content, written, cur.content);
        baseRef.current = { path: doc.path, text: settled.base };
        if (settled.content !== cur.content) {
          setCurrent((prev) =>
            prev && prev.path === doc.path
              ? { ...prev, content: settled.content }
              : prev,
          );
        }
      }
    },
    setError,
    AUTOSAVE_DELAY_MS.desktop,
  );

  const kbPath = config?.kb_path?.trim() ?? "";

  const loadTree = useCallback(async () => {
    try {
      setTree(await invoke("kb_tree"));
    } catch (e) {
      setError(e);
    }
  }, [setError]);

  // with no kb_path the core roots the tree at the vault itself (a vault
  // always holds notes), so there is always a tree to load
  useEffect(() => {
    void loadTree();
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
          const content = await invoke("kb_read", { path: doc.path });
          // typed meanwhile: the next save merges against the old base
          if (!savedRef.current) return;
          baseRef.current = { path: doc.path, text: content };
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
  }, [loadTree, savedRef]);

  // two quick clicks race their reads: only the latest open may land
  const openSeq = useRef(0);

  const openFile = async (path: string) => {
    const seq = ++openSeq.current;
    // an edit whose save failed would be lost to the first keystroke in
    // the next note: stay on it (the error and Retry are showing)
    if (!(await flushPending())) return;
    try {
      const content = await invoke("kb_read", { path });
      if (seq !== openSeq.current) return;
      baseRef.current = { path, text: content };
      setCurrent({ kind: "note", path, content });
      useAppStore.getState().setKbCurrent({ kind: "note", path });
      setConfigErrors([]);
      markLoaded();
    } catch (e) {
      setError(e);
    }
  };

  const openConfig = async (file: string) => {
    const seq = ++openSeq.current;
    if (!(await flushPending())) return;
    try {
      const content = await invoke("config_file_get", { file });
      if (seq !== openSeq.current) return;
      setCurrent({ kind: "config", path: file, content });
      useAppStore.getState().setKbCurrent({ kind: "config", path: file });
      setConfigErrors([]);
      markLoaded();
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

  const scheduleSave = (content: string) => {
    if (!current) return;
    const target = { kind: current.kind, path: current.path, content };
    setCurrent(target);
    schedule(target);
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
      const inside = (p: string) => p === path || p.startsWith(`${path}/`);
      dropPending((doc) => inside(doc.path));
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
        // the edit still in the debounce lands before the move, not
        // after it under the old path
        await flushPending();
        await invoke("kb_rename", { from, to: target });
        const open = currentRef.current;
        if (open?.kind === "note" && open.path === from) {
          reopen = target;
        } else if (open?.kind === "note" && open.path.startsWith(`${from}/`)) {
          // the moved folder holds the open note
          reopen = target + open.path.slice(from.length);
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
      const path = await invoke("kb_create", { path: name });
      await loadTree();
      await openFile(path);
    } catch (e) {
      setError(e);
    }
  };

  const createFolder = async (name: string) => {
    setDialog(null);
    try {
      const path = await invoke("kb_mkdir", { path: name });
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
      const absolute = await invoke("kb_abs_path", { path });
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
    // the edit still in the debounce lands under the old name first; a
    // write after the rename would recreate the old path
    await flushPending();
    try {
      await invoke("kb_rename", { from: node.path, to });
      await loadTree();
      // the open note (or the folder holding it) moved: follow it
      const open = currentRef.current;
      if (open?.kind === "note") {
        const target = renamedPath(node, to);
        if (open.path === node.path) await openFile(target);
        else if (open.path.startsWith(`${node.path}/`)) {
          await openFile(target + open.path.slice(node.path.length));
        }
      }
    } catch (e) {
      setError(e);
    }
  };

  const deleteFile = async (node: KbNode) => {
    setDialog(null);
    // a debounced save of a file inside a deleted folder would recreate
    // the path, so drop it too
    const inside = (path: string) =>
      path === node.path || (node.is_dir && path.startsWith(`${node.path}/`));
    dropPending((doc) => inside(doc.path));
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
    if (!query) {
      setContentHits([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      invoke("kb_search", { query })
        .then((hits) => {
          if (!stale) setContentHits(hits);
        })
        .catch(() => {
          if (!stale) setContentHits([]);
        });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const nameMatchPaths = new Set((searchResults ?? []).map((f) => f.path));
  const extraContentHits = contentHits.filter(
    (h) => !nameMatchPaths.has(h.path),
  );

  // dragging a row that is part of the selection carries the whole
  // selection; dragging any other row carries just that row
  const onDragStart = (node: KbNode) => {
    dragPaths.current = selectedSet.has(node.path) ? [...selected] : [node.path];
  };

  const treeCtx: TreeCtx = {
    expanded,
    toggleExpanded,
    selectedSet,
    selectRow,
    currentPath: current?.kind === "note" ? current.path : null,
    dropTarget,
    setDropTarget,
    clipboard,
    dragPaths,
    onDragStart,
    dropOnto,
    openFile: (path) => void openFile(path),
    openMenu: (x, y, node) => setMenu({ x, y, node }),
    onNewNote: (dir) => setDialog({ kind: "create", dir }),
    onNewFolder: (dir) => setDialog({ kind: "createFolder", dir }),
    onRename: (node) => setDialog({ kind: "rename", node }),
    onDelete: (node) => setDialog({ kind: "delete", node }),
    anchorTo: (path) => {
      anchorRef.current = path;
      setSelected([path]);
    },
  };

  return (
    <div className="flex h-full">
      <aside
        className="flex shrink-0 flex-col border-r border-line bg-surface-alt/50"
        style={{ width: treeWidth }}
      >
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
            aria-label="New note"
            onClick={() => setDialog({ kind: "create" })}
          >
            +
          </button>
          <button
            className="rounded-md border border-line px-1.5 py-1 text-content-muted hover:border-accent hover:text-accent"
            title="New folder"
            aria-label="New folder"
            onClick={() => setDialog({ kind: "createFolder" })}
          >
            <Icon name="folderPlus" className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* focusable so the tree takes IDE keys: F2 rename, Delete,
            Ctrl+C/X/V copy-cut-paste, Ctrl+A select all; its rows
            are buttons of their own */}
        {/* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-static-element-interactions */}
        <div
          aria-label="Notes"
          className={`min-h-0 flex-1 overflow-y-auto px-1 pb-2 outline-hidden ${
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
          {/* eslint-enable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-static-element-interactions */}
          {(searchResults ?? tree).map((node) => (
            <NoteRow key={node.path} node={node} depth={0} ctx={treeCtx} />
          ))}
          {searchResults && extraContentHits.length > 0 && (
            <>
              <div className="px-2 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-content-muted">
                In content
              </div>
              {extraContentHits.map((hit) => (
                <button
                  key={hit.path}
                  className="block w-full rounded-sm px-2 py-1 text-left hover:bg-line/40"
                  onClick={() => void openFile(hit.path)}
                >
                  <span className="block truncate text-sm text-content">
                    {hit.name}
                  </span>
                  <span className="block truncate text-[0.6875rem] text-content-muted">
                    {hit.line}: {hit.preview}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
        <div className="border-t border-line px-1 py-2">
          <div className="px-2 pb-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-content-muted">
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
        <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[0.6875rem] text-content-muted">
          <button
            className="min-w-0 flex-1 truncate text-left hover:text-content"
            title={
            kbPath || "Notes live in the vault folder; pick another folder for them"
          }
            onClick={() => void pickFolder()}
          >
            {kbPath ? "Change folder" : "Use another folder"}
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
          <EditorPane
            current={current}
            saveState={saveState}
            onRetry={() => void flushPending()}
            configErrors={configErrors}
            lineNumbers={config?.kb_line_numbers ?? false}
            onChange={scheduleSave}
          />
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
