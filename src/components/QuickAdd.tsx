import { useState } from "react";
import { useAppStore } from "../store";
import type { NewTask } from "../types";

export default function QuickAdd({ target }: { target: Partial<NewTask> }) {
  const createTask = useAppStore((s) => s.createTask);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  if (!open) {
    return (
      <button
        className="rounded px-1 py-0.5 text-left text-xs text-content-muted opacity-60 hover:opacity-100"
        onClick={() => setOpen(true)}
      >
        + Add task
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) {
          void createTask({ title: title.trim(), ...target });
        }
        setTitle("");
        setOpen(false);
      }}
    >
      <input
        className="input w-full py-1 text-xs"
        // a {Category} prefix is a text label on the card, never a list
        placeholder="Task title, or {Category} title"
        value={title}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          // a click elsewhere mid-typing must not discard the text
          if (title.trim()) {
            void createTask({ title: title.trim(), ...target });
          }
          setTitle("");
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
      />
    </form>
  );
}
