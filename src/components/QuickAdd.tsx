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
        className="rounded-sm px-1 py-0.5 text-left text-xs text-content-muted hover:text-content"
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
        // Enter submits and keeps the input focused for the next task;
        // Escape or clicking elsewhere ends the streak
        const text = title.trim();
        if (text) {
          // a refused add gives the text back unless something new was typed
          void createTask({ title: text, ...target }).then((ok) => {
            if (!ok) setTitle((now) => now || text);
          });
          setTitle("");
        } else {
          setTitle("");
          setOpen(false);
        }
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
          // a click elsewhere mid-typing must not discard the text -
          // nor may a refused add: the field reopens holding it
          const text = title.trim();
          if (text) {
            void createTask({ title: text, ...target }).then((ok) => {
              if (ok) return;
              setTitle(text);
              setOpen(true);
            });
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
