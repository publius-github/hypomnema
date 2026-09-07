import type { MutableRefObject } from "react";
import Icon from "../../components/icons";
import type { KbNode } from "../../types";
import { parentDirOf } from "./util";

/** Everything a tree row needs from the section, bundled once instead
 *  of threading a dozen props through the recursion. */
export interface TreeCtx {
  expanded: Set<string>;
  toggleExpanded: (path: string) => void;
  selectedSet: Set<string>;
  /** Click selection (plain/ctrl/shift); true = handled, no open. */
  selectRow: (node: KbNode, e: React.MouseEvent) => boolean;
  /** Path of the note open in the editor (config files never match). */
  currentPath: string | null;
  dropTarget: string | null;
  setDropTarget: (target: string | null) => void;
  clipboard: { paths: string[]; cut: boolean } | null;
  dragPaths: MutableRefObject<string[]>;
  onDragStart: (node: KbNode) => void;
  dropOnto: (toDir: string) => void;
  openFile: (path: string) => void;
  openMenu: (x: number, y: number, node: KbNode) => void;
  onNewNote: (dir: string) => void;
  onNewFolder: (dir: string) => void;
  onRename: (node: KbNode) => void;
  onDelete: (node: KbNode) => void;
  /** Sets the selection anchor before a context menu replaces it. */
  anchorTo: (path: string) => void;
}

export default function NoteRow({
  node,
  depth,
  ctx,
}: {
  node: KbNode;
  depth: number;
  ctx: TreeCtx;
}) {
  return (
    <div>
      <div
        draggable
        onDragStart={() => ctx.onDragStart(node)}
        onDragEnd={() => {
          ctx.dragPaths.current = [];
          ctx.setDropTarget(null);
        }}
        // dropping on a file means dropping into its folder, so the
        // highlight lands on that folder's row (or the root area)
        onDragOver={(e) => {
          if (ctx.dragPaths.current.length === 0) return;
          e.preventDefault();
          e.stopPropagation();
          ctx.setDropTarget(node.is_dir ? node.path : parentDirOf(node.path));
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          ctx.dropOnto(node.is_dir ? node.path : parentDirOf(node.path));
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!ctx.selectedSet.has(node.path)) {
            ctx.anchorTo(node.path);
          }
          ctx.openMenu(e.clientX, e.clientY, node);
        }}
        className={`group flex items-center gap-1 rounded px-2 py-0.5 text-sm ${
          ctx.dropTarget === node.path
            ? "bg-accent/25 text-content ring-1 ring-accent"
            : ctx.selectedSet.has(node.path)
              ? "bg-accent/20 text-content"
              : !node.is_dir && ctx.currentPath === node.path
                ? "bg-accent/15 text-accent"
                : "text-content hover:bg-line/40"
        } ${
          ctx.clipboard?.cut && ctx.clipboard.paths.includes(node.path)
            ? "opacity-50"
            : ""
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {node.is_dir ? (
          <>
            <button
              className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium"
              onClick={(e) => {
                if (!ctx.selectRow(node, e)) ctx.toggleExpanded(node.path);
              }}
            >
              <Icon
                name={
                  ctx.expanded.has(node.path) ? "chevronDown" : "chevronRight"
                }
                className="h-3 w-3 shrink-0"
              />
              <span className="truncate">{node.name}</span>
            </button>
            <button
              className="px-0.5 opacity-0 hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
              title="New note in this folder"
              onClick={() => ctx.onNewNote(node.path)}
            >
              +
            </button>
            <button
              className="px-0.5 opacity-0 hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
              title="New folder inside this one"
              onClick={() => ctx.onNewFolder(node.path)}
            >
              <Icon name="folderPlus" className="h-3.5 w-3.5" />
            </button>
            <button
              className="opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              title="Delete folder"
              onClick={() => ctx.onDelete(node)}
            >
              <Icon name="trash" className="h-3 w-3" />
            </button>
          </>
        ) : (
          <>
            <button
              className="flex-1 truncate text-left"
              onClick={(e) => {
                if (!ctx.selectRow(node, e)) ctx.openFile(node.path);
              }}
            >
              {node.name}
            </button>
            <button
              className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
              title="Rename"
              onClick={() => ctx.onRename(node)}
            >
              <Icon name="pencil" className="h-3 w-3" />
            </button>
            <button
              className="opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              title="Delete"
              onClick={() => ctx.onDelete(node)}
            >
              <Icon name="trash" className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
      {node.is_dir &&
        ctx.expanded.has(node.path) &&
        node.children.map((child) => (
          <NoteRow key={child.path} node={child} depth={depth + 1} ctx={ctx} />
        ))}
    </div>
  );
}
