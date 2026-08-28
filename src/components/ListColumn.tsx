import { useDroppable } from "@dnd-kit/core";
import { useState } from "react";
import { useAppStore } from "../store";
import { compareTasks, splitDone } from "../lib/tasks";
import TaskCard from "./TaskCard";
import QuickAdd from "./QuickAdd";
import type { List } from "../types";

export default function ListColumn({
  list,
  onOpenTask,
}: {
  list: List;
  onOpenTask: (id: number) => void;
}) {
  const { config, tasks, renameList, archiveList } = useAppStore();
  const { setNodeRef, isOver } = useDroppable({ id: `list:${list.id}` });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);

  const listTasks = tasks
    .filter(
      (t) =>
        t.list_id === list.id &&
        t.scheduled_date === null &&
        t.parent_task_id === null,
    )
    .sort(compareTasks);
  const { active, done } = splitDone(
    listTasks,
    config?.done_display ?? "inline",
  );

  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col rounded-lg border ${
        isOver ? "border-accent" : "border-line"
      } bg-surface-alt/50`}
    >
      <div className="group flex items-center gap-1 px-2.5 py-2">
        {editing ? (
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void renameList(list.id, name);
              setEditing(false);
            }}
          >
            <input
              className="input w-full py-0.5 text-xs"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setEditing(false)}
            />
          </form>
        ) : (
          <button
            className="flex-1 truncate text-left text-xs font-semibold uppercase tracking-wide text-content-muted hover:text-content"
            onDoubleClick={() => {
              setName(list.name);
              setEditing(true);
            }}
            title="Double-click to rename"
          >
            {list.name}
          </button>
        )}
        <button
          className="hidden text-xs text-content-muted hover:text-red-500 group-hover:block"
          title="Archive list"
          onClick={() => void archiveList(list.id)}
        >
          ×
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
        {active.map((task) => (
          <TaskCard key={task.id} task={task} onOpen={onOpenTask} />
        ))}
        {done.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-line pt-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-content-muted">
              Done
            </div>
            {done.map((task) => (
              <TaskCard key={task.id} task={task} onOpen={onOpenTask} />
            ))}
          </div>
        )}
        <QuickAdd target={{ list_id: list.id }} />
      </div>
    </div>
  );
}
