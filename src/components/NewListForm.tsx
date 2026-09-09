import { useState } from "react";
import { useAppStore } from "../store";

/**
 * The panel rail's create affordance: a new list, or a new group.
 * Inside an open group view `groupId` is set: the new list joins that
 * group directly, and the group button hides - groups do not nest.
 */
export default function NewListForm({ groupId }: { groupId?: number }) {
  const createList = useAppStore((s) => s.createList);
  const createGroup = useAppStore((s) => s.createGroup);
  const [open, setOpen] = useState<"list" | "group" | null>(null);
  const [name, setName] = useState("");

  if (!open) {
    return (
      <div className="flex w-40 shrink-0 flex-col gap-1.5">
        <button
          className="h-9 rounded-lg border border-dashed border-line text-xs text-content-muted hover:border-accent hover:text-accent"
          onClick={() => setOpen("list")}
        >
          + New list
        </button>
        {groupId === undefined && (
          <button
            className="h-7 rounded-lg border border-dashed border-line text-xs text-content-muted hover:border-accent hover:text-accent"
            title="A group folds several lists into one panel slot"
            onClick={() => setOpen("group")}
          >
            + New group
          </button>
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
