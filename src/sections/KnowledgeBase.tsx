import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store";
import MarkdownEditor from "../components/MarkdownEditor";

interface KbNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: KbNode[];
}

function flattenFiles(nodes: KbNode[]): KbNode[] {
  return nodes.flatMap((n) => (n.is_dir ? flattenFiles(n.children) : [n]));
}

export default function KnowledgeBase() {
  const { config, updateConfig } = useAppStore();
  const setError = useCallback(
    (e: unknown) => useAppStore.setState({ error: String(e) }),
    [],
  );
  const [tree, setTree] = useState<KbNode[]>([]);
  const [search, setSearch] = useState("");
  const [current, setCurrent] = useState<{ path: string; content: string } | null>(null);
  const [saved, setSaved] = useState(true);
  const savedRef = useRef(true);
  savedRef.current = saved;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  // there are no unsaved local changes
  useEffect(() => {
    const unlisten = listen("kb-updated", async () => {
      await loadTree();
      const doc = current;
      if (doc && savedRef.current) {
        try {
          const content = await invoke<string>("kb_read", { path: doc.path });
          setCurrent((prev) =>
            prev && prev.path === doc.path ? { ...prev, content } : prev,
          );
        } catch {
          // file may have been deleted externally
          setCurrent(null);
        }
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [current, loadTree]);

  const openFile = async (path: string) => {
    try {
      const content = await invoke<string>("kb_read", { path });
      setCurrent({ path, content });
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  };

  const scheduleSave = (content: string) => {
    if (!current) return;
    const path = current.path;
    setCurrent({ path, content });
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await invoke("kb_write", { path, content });
        setSaved(true);
      } catch (e) {
        setError(e);
      }
    }, 800);
  };

  const createFile = async () => {
    const name = prompt("New note path (e.g. ideas/note):");
    if (!name?.trim()) return;
    try {
      const path = await invoke<string>("kb_create", { path: name.trim() });
      await loadTree();
      await openFile(path);
    } catch (e) {
      setError(e);
    }
  };

  const renameFile = async (node: KbNode) => {
    const to = prompt("Rename to:", node.path.replace(/\.md$/i, ""));
    if (!to?.trim()) return;
    try {
      await invoke("kb_rename", { from: node.path, to: to.trim() });
      await loadTree();
      if (current?.path === node.path) setCurrent(null);
    } catch (e) {
      setError(e);
    }
  };

  const deleteFile = async (node: KbNode) => {
    if (!confirm(`Delete ${node.path}?`)) return;
    try {
      await invoke("kb_delete", { path: node.path });
      await loadTree();
      if (current?.path === node.path) setCurrent(null);
    } catch (e) {
      setError(e);
    }
  };

  const pickFolder = async () => {
    const path = await open({ directory: true, title: "Select KB folder" });
    if (typeof path === "string") {
      await updateConfig({ kb_path: path });
    }
  };

  if (!kbPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="max-w-md text-content-muted">
          Connect a folder with Markdown notes. The app only reads the tree
          and edits files you open; it never restructures the folder.
        </p>
        <button
          className="rounded-lg bg-accent px-5 py-2.5 font-medium text-white hover:opacity-90"
          onClick={() => void pickFolder()}
        >
          Select KB folder
        </button>
      </div>
    );
  }

  const query = search.trim().toLowerCase();
  const searchResults = query
    ? flattenFiles(tree).filter((f) => f.name.toLowerCase().includes(query))
    : null;

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
          <span className="truncate font-medium">{node.name}</span>
        ) : (
          <>
            <button
              className="flex-1 truncate text-left"
              onClick={() => void openFile(node.path)}
            >
              {node.name.replace(/\.md$/i, "")}
            </button>
            <button
              className="hidden text-xs group-hover:block"
              title="Rename"
              onClick={() => void renameFile(node)}
            >
              ✎
            </button>
            <button
              className="hidden text-xs hover:text-red-500 group-hover:block"
              title="Delete"
              onClick={() => void deleteFile(node)}
            >
              ×
            </button>
          </>
        )}
      </div>
      {node.is_dir && node.children.map((child) => renderNode(child, depth + 1))}
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface-alt/50">
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
            onClick={() => void createFile()}
          >
            +
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {searchResults
            ? searchResults.map((node) => renderNode(node, 0))
            : tree.map((node) => renderNode(node, 0))}
        </div>
        <button
          className="border-t border-line px-3 py-2 text-left text-[11px] text-content-muted hover:text-content"
          title={kbPath}
          onClick={() => void pickFolder()}
        >
          Change folder
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {current ? (
          <>
            <div className="flex items-center justify-between border-b border-line px-4 py-2 text-sm">
              <span className="truncate font-medium">{current.path}</span>
              <span className="text-xs text-content-muted">
                {saved ? "Saved" : "Saving..."}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <MarkdownEditor
                docKey={`kb:${current.path}`}
                value={current.content}
                onChange={scheduleSave}
              />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-content-muted">
            Select a note
          </div>
        )}
      </div>
    </div>
  );
}
