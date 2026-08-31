import { useState } from "react";
import { useAppStore } from "../store";

export default function NewListForm({ fluid = false }: { fluid?: boolean }) {
  const createList = useAppStore((s) => s.createList);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // fluid: fill the parent (the All-lists index); otherwise the fixed
  // width the dashboard header slot expects
  const width = fluid ? "w-full" : "w-40";

  if (!open) {
    return (
      <button
        className={`h-9 ${width} shrink-0 rounded-lg border border-dashed border-line text-xs text-content-muted hover:border-accent hover:text-accent`}
        onClick={() => setOpen(true)}
      >
        + New list
      </button>
    );
  }

  return (
    <form
      className={`${width} shrink-0`}
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) void createList(name.trim());
        setName("");
        setOpen(false);
      }}
    >
      <input
        className="input w-full text-xs"
        placeholder="List name"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          setName("");
          setOpen(false);
        }}
      />
    </form>
  );
}
