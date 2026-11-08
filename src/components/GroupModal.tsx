import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { OptionalColorField } from "./form";
import { ConfirmModal } from "./dialogs";
import type { List, ListGroup } from "../types";
import { useDialogFocus } from "../hooks/useDialogFocus";

/**
 * Group dialog: rename, color (a dot on the group tile), membership -
 * every active manual list with a checkbox - and delete, which releases
 * the member lists back to the panel. Membership toggles apply
 * immediately; name and color on Save, like the list dialog.
 *
 * Membership is edited per kind: opened from Lists (or the dashboard)
 * the dialog offers the todo lists, from Checklists the checklists. A
 * list joins a group of the other page only after its kind is switched
 * in its own dialog; members of the other kind are counted, not listed.
 */
export default function GroupModal({
  group,
  kind = "todo",
  onClose,
}: {
  group: ListGroup;
  /** the page's kind of list: the only kind offered as members */
  kind?: List["kind"];
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus();
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
    .filter((l) => !l.auto && l.kind === kind)
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    );

  const noun = kind === "checklist" ? "checklist" : "list";
  const otherNoun = kind === "checklist" ? "list" : "checklist";
  const otherMembers = lists.filter(
    (l) => l.group_id === group.id && l.kind !== kind,
  ).length;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="List group"
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
        <OptionalColorField value={color} onChange={setColor} />

        <div className="flex flex-col gap-1">
          <span className="text-xs text-content-muted">
            {kind === "checklist" ? "Checklists" : "Lists"} in this group
          </span>
          {candidates.length === 0 && (
            <span className="text-xs text-content-muted">No {noun}s yet.</span>
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
                  className="h-3 w-1 shrink-0 rounded-sm"
                  style={{ backgroundColor: list.color }}
                />
              )}
              <span className="min-w-0 flex-1 truncate">{list.name}</span>
              {list.group_id !== null && list.group_id !== group.id && (
                <span className="shrink-0 text-[0.6875rem] text-content-muted">
                  in another group
                </span>
              )}
            </label>
          ))}
          {otherMembers > 0 && (
            <span className="text-xs text-content-muted">
              Also holds {otherMembers} {otherNoun}
              {otherMembers === 1 ? "" : "s"} - edited on the{" "}
              {kind === "checklist" ? "Lists" : "Checklists"} page.
            </span>
          )}
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
