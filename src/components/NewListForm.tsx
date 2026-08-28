import { useState } from "react";
import { useAppStore } from "../store";

export default function NewListForm() {
  const { createList } = useAppStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  if (!open) {
    return (
      <button
        className="h-9 w-40 shrink-0 rounded-lg border border-dashed border-line text-xs text-content-muted hover:border-accent hover:text-accent"
        onClick={() => setOpen(true)}
      >
        + New list
      </button>
    );
  }

  return (
    <form
      className="w-40 shrink-0"
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
