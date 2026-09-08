import { useMemo, useState } from "react";
import { useAppStore } from "../store";
import { compareTasks } from "../lib/tasks";
import TaskRow from "./TaskRow";

/**
 * Lists, one at a time. The desktop shows them side by side in a paged
 * column zone; a phone has room for one, so this picks one and shows it
 * whole rather than showing five in slivers.
 */
export default function MobileLists() {
  const lists = useAppStore((s) => s.lists);
  const tasks = useAppStore((s) => s.tasks);
  const createTask = useAppStore((s) => s.createTask);
  const [openId, setOpenId] = useState<number | null>(null);
  const [title, setTitle] = useState("");

  const active = useMemo(
    () => lists.filter((list) => !list.archived),
    [lists],
  );
  const current = active.find((list) => list.id === openId) ?? null;
  const listTasks = useMemo(
    () =>
      current
        ? tasks
            .filter((t) => t.list_id === current.id && !t.parent_task_id)
            .sort(compareTasks)
        : [],
    [tasks, current],
  );

  if (!current) {
    return (
      <ul>
        {active.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-content-muted">
            No lists yet.
          </li>
        )}
        {active.map((list) => {
          const open = tasks.filter(
            (t) => t.list_id === list.id && t.status === "todo",
          ).length;
          return (
            <li key={list.id} className="border-b border-line/60">
              <button
                onClick={() => setOpenId(list.id)}
                className="flex w-full items-center justify-between px-4 py-4 text-left"
              >
                <span className="min-w-0 break-words">
                  {list.favorite && <span className="text-accent">★ </span>}
                  {list.name}
                </span>
                <span className="ml-3 shrink-0 text-sm text-content-muted">
                  {open}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    void createTask({ title: trimmed, list_id: current.id });
    setTitle("");
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-2 py-3">
        <button
          onClick={() => setOpenId(null)}
          className="px-2 py-1 text-content-muted"
        >
          ‹ Lists
        </button>
        <span className="min-w-0 truncate font-semibold">{current.name}</span>
      </header>
      {listTasks.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-content-muted">
          This list is empty.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto">
          {listTasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      )}
      <div className="flex gap-2 border-t border-line p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={`New task in ${current.name}`}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-alt px-3 py-2"
        />
        <button
          onClick={submit}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-white"
        >
          Add
        </button>
      </div>
    </div>
  );
}
