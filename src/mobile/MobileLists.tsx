import { useMemo, useState } from "react";
import { useAppStore } from "../store";
import { compareTasks } from "../lib/tasks";
import TaskRow from "./TaskRow";
import type { List } from "../types";

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];

/**
 * Lists, one at a time. The desktop shows them side by side in a paged
 * column zone; a phone has room for one, so this picks one and shows it
 * whole rather than showing five in slivers.
 */
export default function MobileLists() {
  const lists = useAppStore((s) => s.lists);
  const groups = useAppStore((s) => s.groups);
  const tasks = useAppStore((s) => s.tasks);
  const createTask = useAppStore((s) => s.createTask);
  const createList = useAppStore((s) => s.createList);
  const renameList = useAppStore((s) => s.renameList);
  const archiveList = useAppStore((s) => s.archiveList);
  const toggleListFavorite = useAppStore((s) => s.toggleListFavorite);
  const updateListMeta = useAppStore((s) => s.updateListMeta);
  const setListStatuses = useAppStore((s) => s.setListStatuses);
  const setListGroup = useAppStore((s) => s.setListGroup);
  const [openId, setOpenId] = useState<number | null>(null);
  // the open group's id: the index shows groups instead of their member
  // lists, a tapped group shows its members on a screen of their own
  const [groupId, setGroupId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [newList, setNewList] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const active = useMemo(() => lists.filter((list) => !list.archived), [lists]);
  const current = active.find((list) => list.id === openId) ?? null;
  const currentGroup = groups.find((g) => g.id === groupId) ?? null;
  const listTasks = useMemo(
    () =>
      current
        ? tasks
            .filter((t) => t.list_id === current.id && !t.parent_task_id)
            .sort(compareTasks)
        : [],
    [tasks, current],
  );

  const listRow = (list: List) => {
    const open = tasks.filter(
      (t) => t.list_id === list.id && t.status === "todo",
    ).length;
    return (
      <li key={list.id} className="border-b border-line/60">
        <button
          onClick={() => setOpenId(list.id)}
          className="flex w-full items-center justify-between px-4 py-4 text-left"
        >
          <span className="flex min-w-0 items-center gap-2">
            {list.color && (
              <span
                aria-hidden
                style={{ background: list.color }}
                className="h-3 w-3 shrink-0 rounded-full"
              />
            )}
            <span className="min-w-0 break-words">
              {list.favorite && <span className="text-accent">★ </span>}
              {list.name}
            </span>
          </span>
          <span className="ml-3 shrink-0 text-sm text-content-muted">
            {open}
          </span>
        </button>
      </li>
    );
  };

  // a tapped group gets a screen of its own: its member lists stay off
  // the index, same as the desktop panel
  if (!current && currentGroup) {
    const members = active.filter((l) => l.group_id === currentGroup.id);
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-3">
          <button
            onClick={() => setGroupId(null)}
            className="px-2 py-1 text-content-muted"
          >
            ‹ Lists
          </button>
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate font-semibold">
            {currentGroup.color && (
              <span
                aria-hidden
                style={{ background: currentGroup.color }}
                className="h-3 w-3 shrink-0 rounded-full"
              />
            )}
            {currentGroup.name}
          </span>
        </header>
        <ul className="min-h-0 flex-1 overflow-auto">
          {members.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-content-muted">
              No lists in this group yet - assign one via its list
              settings.
            </li>
          )}
          {members.map(listRow)}
        </ul>
      </div>
    );
  }

  if (!current) {
    const ungrouped = active.filter((l) => l.group_id === null);
    return (
      <div className="flex h-full flex-col">
        <ul className="min-h-0 flex-1 overflow-auto">
          {groups.length === 0 && ungrouped.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-content-muted">
              No lists yet.
            </li>
          )}
          {groups.map((group) => {
            const count = active.filter(
              (l) => l.group_id === group.id,
            ).length;
            return (
              <li key={`g${group.id}`} className="border-b border-line/60">
                <button
                  onClick={() => setGroupId(group.id)}
                  className="flex w-full items-center justify-between px-4 py-4 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {group.color && (
                      <span
                        aria-hidden
                        style={{ background: group.color }}
                        className="h-3 w-3 shrink-0 rounded-full"
                      />
                    )}
                    <span className="min-w-0 break-words font-medium">
                      ▸ {group.name}
                    </span>
                  </span>
                  <span className="ml-3 shrink-0 text-sm text-content-muted">
                    {count} {count === 1 ? "list" : "lists"}
                  </span>
                </button>
              </li>
            );
          })}
          {ungrouped.map(listRow)}
        </ul>
        <div className="flex gap-2 border-t border-line p-3">
          <input
            value={newList}
            onChange={(e) => setNewList(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const trimmed = newList.trim();
              if (!trimmed) return;
              void createList(trimmed);
              setNewList("");
            }}
            placeholder="New list"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface-alt px-3 py-2"
          />
          <button
            onClick={() => {
              const trimmed = newList.trim();
              if (!trimmed) return;
              void createList(trimmed);
              setNewList("");
            }}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-white"
          >
            Add
          </button>
        </div>
      </div>
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
          onClick={() => {
            setOpenId(null);
            setSettingsOpen(false);
          }}
          className="px-2 py-1 text-content-muted"
        >
          ‹ {currentGroup ? currentGroup.name : "Lists"}
        </button>
        <span className="min-w-0 flex-1 truncate font-semibold">
          {current.name}
        </span>
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          aria-label="List settings"
          className="px-3 text-content-muted"
        >
          ⋯
        </button>
      </header>

      {settingsOpen && (
        // Inline rather than a modal: on a phone a dialog would cover
        // the very list its settings describe.
        <div className="flex flex-col gap-3 border-b border-line bg-surface-alt px-4 py-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-content-muted">
              Name
            </span>
            <input
              defaultValue={current.name}
              onBlur={(e) => {
                const trimmed = e.target.value.trim();
                if (trimmed && trimmed !== current.name) {
                  void renameList(current.id, trimmed);
                }
              }}
              className="rounded-lg border border-line bg-surface px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-content-muted">
              Description
            </span>
            <textarea
              defaultValue={current.description}
              rows={2}
              onBlur={(e) => {
                if (e.target.value !== current.description) {
                  void updateListMeta(current.id, {
                    color: current.color,
                    description: e.target.value,
                  });
                }
              }}
              className="resize-none rounded-lg border border-line bg-surface px-3 py-2"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() =>
                void updateListMeta(current.id, {
                  color: null,
                  description: current.description,
                })
              }
              className={`h-8 w-8 rounded-full border ${
                current.color ? "border-line" : "border-2 border-accent"
              }`}
              aria-label="No colour"
            />
            {COLORS.map((color) => (
              <button
                key={color}
                onClick={() =>
                  void updateListMeta(current.id, {
                    color,
                    description: current.description,
                  })
                }
                style={{ background: color }}
                className={`h-8 w-8 rounded-full ${
                  current.color === color
                    ? "ring-2 ring-accent ring-offset-2"
                    : ""
                }`}
                aria-label={`Colour ${color}`}
              />
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-content-muted">
              Type
            </span>
            <select
              value={current.kind}
              onChange={(e) =>
                void updateListMeta(current.id, {
                  color: current.color,
                  description: current.description,
                  kind: e.target.value as List["kind"],
                })
              }
              className="rounded-lg border border-line bg-surface px-3 py-2"
            >
              <option value="todo">Todo (done clears overnight)</option>
              <option value="checklist">Checklist (checked items stay)</option>
            </select>
          </label>
          {current.kind === "checklist" && (
            <div className="flex gap-2">
              <button
                onClick={() => void setListStatuses(current.id, true)}
                className="flex-1 rounded-lg border border-line px-4 py-2"
              >
                Check all
              </button>
              <button
                onClick={() => void setListStatuses(current.id, false)}
                className="flex-1 rounded-lg border border-line px-4 py-2"
              >
                Uncheck all
              </button>
            </div>
          )}
          {groups.length > 0 && (
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-content-muted">
                Group
              </span>
              <select
                value={current.group_id ?? ""}
                onChange={(e) =>
                  void setListGroup(
                    current.id,
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
                className="rounded-lg border border-line bg-surface px-3 py-2"
              >
                <option value="">No group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Favourite</span>
            <input
              type="checkbox"
              checked={current.favorite}
              onChange={() => void toggleListFavorite(current.id)}
              className="h-6 w-6"
            />
          </label>
          <button
            onClick={() => {
              void archiveList(current.id);
              setOpenId(null);
              setSettingsOpen(false);
            }}
            className="rounded-lg border border-danger/50 px-4 py-2 text-danger"
          >
            Archive list
          </button>
        </div>
      )}

      {listTasks.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-content-muted">
          This list is empty.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto">
          {listTasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              showList={false}
              neighbours={{
                previous: index > 0 ? listTasks[index - 1].id : undefined,
                next:
                  index < listTasks.length - 1
                    ? listTasks[index + 1].id
                    : undefined,
              }}
            />
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
