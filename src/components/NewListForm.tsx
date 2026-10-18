import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../store";

/**
 * The panel rail's create affordance: a new list, or a new group.
 * Inside an open group view `groupId` is set: the new list joins that
 * group directly, the group button hides - groups do not nest - and a
 * third button moves a list that already exists into the group, so
 * filling a group does not mean leaving it first.
 */
export default function NewListForm({ groupId }: { groupId?: number }) {
  const createList = useAppStore((s) => s.createList);
  const createGroup = useAppStore((s) => s.createGroup);
  const setListGroup = useAppStore((s) => s.setListGroup);
  const [open, setOpen] = useState<"list" | "group" | "existing" | null>(null);
  const [name, setName] = useState("");
  // alphabetical: a picker over every list in the vault is read by
  // looking for a name, not by the panel's ordering
  const outsiders = useAppStore(
    useShallow((s) =>
      s.lists
        .filter((l) => !l.auto && l.group_id !== groupId)
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, {
            sensitivity: "base",
            numeric: true,
          }),
        ),
    ),
  );

  if (open === "existing") {
    return (
      <select
        className="input w-40 shrink-0 text-xs"
        autoFocus
        defaultValue=""
        onBlur={() => setOpen(null)}
        onChange={(e) => {
          const id = Number(e.target.value);
          setOpen(null);
          if (id && groupId !== undefined) void setListGroup(id, groupId);
        }}
      >
        <option value="">Move a list in…</option>
        {outsiders.map((list) => (
          <option key={list.id} value={list.id}>
            {list.name}
            {list.group_id !== null ? " (in another group)" : ""}
          </option>
        ))}
      </select>
    );
  }

  if (!open) {
    return (
      <div className="flex w-40 shrink-0 flex-col gap-1.5">
        <button
          className="h-8 rounded-lg border border-dashed border-line text-xs text-content-muted hover:border-accent hover:text-accent"
          onClick={() => setOpen("list")}
        >
          + New list
        </button>
        {groupId === undefined ? (
          <button
            className="h-8 rounded-lg border border-dashed border-line text-xs text-content-muted hover:border-accent hover:text-accent"
            title="A group folds several lists into one panel slot"
            onClick={() => setOpen("group")}
          >
            + New group
          </button>
        ) : (
          outsiders.length > 0 && (
            <button
              className="h-8 rounded-lg border border-dashed border-line text-xs text-content-muted hover:border-accent hover:text-accent"
              title="Move a list that already exists into this group"
              onClick={() => setOpen("existing")}
            >
              + Existing list
            </button>
          )
        )}
      </div>
    );
  }

  return (
    <form
      className="w-40 shrink-0"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) {
          if (open === "list") void createList(name.trim(), groupId);
          else void createGroup(name.trim());
        }
        setName("");
        setOpen(null);
      }}
    >
      <input
        className="input w-full text-xs"
        placeholder={open === "list" ? "List name" : "Group name"}
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          setName("");
          setOpen(null);
        }}
      />
    </form>
  );
}
