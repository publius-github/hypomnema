import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { ColorPicker } from "./form";
import { ConfirmModal } from "./dialogs";
import type { ListGroup } from "../types";

/**
 * Group dialog: rename, color (a dot on the group tile), membership -
 * every active manual list with a checkbox - and delete, which releases
 * the member lists back to the panel. Membership toggles apply
 * immediately; name and color on Save, like the list dialog.
 */
export default function GroupModal({
  group,
  onClose,
}: {
  group: ListGroup;
  onClose: () => void;
}) {
  const updateGroupMeta = useAppStore((s) => s.updateGroupMeta);
  const deleteGroup = useAppStore((s) => s.deleteGroup);
  const setListGroup = useAppStore((s) => s.setListGroup);
  const lists = useAppStore((s) => s.lists);
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState(group.color);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const save = () => {
    if (
      name.trim() &&
      (name.trim() !== group.name || color !== group.color)
    ) {
      void updateGroupMeta(group.id, { name: name.trim(), color });
    }
    onClose();
  };

  // auto lists mirror the engine's config files and stay day-only;
  // only real user lists are grouping candidates. Alphabetical, not the
  // panel's order: this is a picker over every list in the vault, and a
  // picker is read by looking for a name.
  const candidates = lists
    .filter((l) => !l.auto)
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    );

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-full w-[480px] flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl"
      >
        <span className="text-sm font-semibold">Group</span>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-content-muted">Name</span>
          <input
            className="input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-content-muted">Color</span>
          <ColorPicker
            value={color ?? "#3b82f6"}
            onChange={(c) => setColor(c)}
          />
          {color ? (
            <button
              className="text-xs text-content-muted hover:text-content"
              onClick={() => setColor(null)}
            >
              clear
            </button>
          ) : (
            <span className="text-xs text-content-muted">none</span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-content-muted">Lists in this group</span>
          {candidates.length === 0 && (
            <span className="text-xs text-content-muted">No lists yet.</span>
          )}
          {candidates.map((list) => (
            <label
              key={list.id}
              className="flex items-center gap-2 rounded-md border border-line bg-surface-alt px-2 py-1 text-sm"
            >
              <input
                type="checkbox"
                checked={list.group_id === group.id}
                onChange={(e) =>
                  void setListGroup(
                    list.id,
                    e.target.checked ? group.id : null,
                  )
                }
              />
              {list.color && (
                <span
                  className="h-3 w-1 shrink-0 rounded"
                  style={{ backgroundColor: list.color }}
                />
              )}
              <span className="min-w-0 flex-1 truncate">{list.name}</span>
              {list.group_id !== null && list.group_id !== group.id && (
                <span className="shrink-0 text-[11px] text-content-muted">
                  in another group
                </span>
              )}
            </label>
          ))}
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            className="rounded-md border border-danger/50 px-3 py-1.5 text-sm text-danger hover:border-danger"
            title="Delete the group; its lists return to the panel"
            onClick={() => setConfirmDelete(true)}
          >
            Delete group
          </button>
          <div className="flex gap-2">
            <button
              className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-content-muted"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="btn-primary px-3" onClick={save}>
              Save
            </button>
          </div>
        </div>
      </div>
      {confirmDelete && (
        <ConfirmModal
          title={`Delete group "${group.name}"?`}
          message="Its lists are not deleted - they return to the list panel."
          onConfirm={() => {
            setConfirmDelete(false);
            void deleteGroup(group.id);
            onClose();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
