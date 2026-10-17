import { Fragment, useMemo, useState } from "react";
import { useAppStore } from "../store";
import { orderLists } from "../lib/tasks";
import { useListSections } from "../hooks/useColumnSections";
import Sections from "./Sections";
import { useBackStep } from "./back";
import { Toggle } from "./controls";
import type { List } from "../types";
import { readable } from "../lib/color";

const FOLDED_KEY = "hypomnema.lists.foldedGroups";

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
  const createGroup = useAppStore((s) => s.createGroup);
  const updateGroupMeta = useAppStore((s) => s.updateGroupMeta);
  const deleteGroup = useAppStore((s) => s.deleteGroup);
  const [openId, setOpenId] = useState<number | null>(null);
  // the open group's id: the index shows groups instead of their member
  // lists, a tapped group shows its members on a screen of their own
  const [groupId, setGroupId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [newList, setNewList] = useState("");
  // what the index's bottom field creates: another list, or a group to
  // file lists under. The phone had no way to make a group at all, which
  // left the group screens unreachable on a vault that had none yet.
  const [newKind, setNewKind] = useState<"list" | "group">("list");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // the open group's own settings fold, same shape as a list's
  const [groupSettings, setGroupSettings] = useState(false);

  // groups the user folded on the index; every group starts open, and
  // the choice is remembered on this phone
  const [collapsed, setCollapsed] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem(FOLDED_KEY);
      return new Set(raw ? (JSON.parse(raw) as number[]) : []);
    } catch {
      return new Set();
    }
  });
  const toggleGroup = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]));
      } catch {
        // storage unavailable: the fold just lasts this session
      }
      return next;
    });

  const alpha = useAppStore((s) => s.config?.lists_sort_alpha ?? false);
  const active = useMemo(() => lists.filter((list) => !list.archived), [lists]);
  const current = active.find((list) => list.id === openId) ?? null;
  const currentGroup = groups.find((g) => g.id === groupId) ?? null;

  // hardware back retraces the screens: settings fold first, then the
  // open list, then the open group, then MobileApp's tab step takes over
  useBackStep(groupId !== null, () => {
    setGroupId(null);
    setGroupSettings(false);
  });
  useBackStep(openId !== null, () => {
    setOpenId(null);
    setSettingsOpen(false);
  });
  useBackStep(settingsOpen, () => setSettingsOpen(false));
  useBackStep(groupSettings, () => setGroupSettings(false));
  // the desktop list column's own layout: Priority, backlog, closed
  const sections = useListSections(current);

  const listRow = (list: List, nested = false) => {
    const open = tasks.filter(
      (t) =>
        t.list_id === list.id &&
        t.parent_task_id === null &&
        t.status === "todo",
    ).length;
    return (
      <li key={list.id} className="border-b border-line/60">
        <button
          onClick={() => setOpenId(list.id)}
          className={`flex w-full items-center justify-between py-4 pr-4 text-left ${
            nested ? "pl-10" : "pl-4"
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            {list.color && (
              <span
                aria-hidden
                style={{ background: readable(list.color, "mark") }}
                className="h-3 w-3 shrink-0 rounded-full"
              />
            )}
            <span className="min-w-0 wrap-break-word">
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
    const members = orderLists(
      active.filter((l) => l.group_id === currentGroup.id),
      tasks,
      alpha,
    );
    // alphabetical: a picker is read by looking for a name
    const outsiders = active
      .filter((l) => !l.auto && l.group_id !== currentGroup.id)
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {
          sensitivity: "base",
          numeric: true,
        }),
      );
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-2 border-b border-line px-2 py-3">
          <button
            onClick={() => {
              setGroupId(null);
              setGroupSettings(false);
            }}
            className="px-2 py-1 text-content-muted"
          >
            ‹ Lists
          </button>
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate font-semibold">
            {currentGroup.color && (
              <span
                aria-hidden
                style={{ background: readable(currentGroup.color, "mark") }}
                className="h-3 w-3 shrink-0 rounded-full"
              />
            )}
            {currentGroup.name}
          </span>
          <button
            onClick={() => setGroupSettings((v) => !v)}
            aria-label="Group settings"
            className="px-3 text-content-muted"
          >
            ⋯
          </button>
        </header>

        {groupSettings && (
          // inline for the same reason a list's settings are: a dialog
          // would cover the group it describes
          <div className="flex flex-col gap-3 border-b border-line bg-surface-alt px-4 py-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-content-muted">
                Name
              </span>
              <input
                defaultValue={currentGroup.name}
                onBlur={(e) => {
                  const trimmed = e.target.value.trim();
                  if (trimmed && trimmed !== currentGroup.name) {
                    void updateGroupMeta(currentGroup.id, {
                      name: trimmed,
                      color: currentGroup.color,
                    });
                  }
                }}
                className="rounded-lg border border-line bg-surface px-3 py-2"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() =>
                  void updateGroupMeta(currentGroup.id, {
                    name: currentGroup.name,
                    color: null,
                  })
                }
                className={`h-8 w-8 rounded-full border ${
                  currentGroup.color ? "border-line" : "border-2 border-accent"
                }`}
                aria-label="No colour"
              />
              {COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() =>
                    void updateGroupMeta(currentGroup.id, {
                      name: currentGroup.name,
                      color,
                    })
                  }
                  style={{ background: color }}
                  className={`h-8 w-8 rounded-full ${
                    currentGroup.color === color
                      ? "ring-2 ring-accent ring-offset-2"
                      : ""
                  }`}
                  aria-label={`Colour ${color}`}
                />
              ))}
            </div>
            <button
              onClick={() => {
                void deleteGroup(currentGroup.id);
                setGroupId(null);
                setGroupSettings(false);
              }}
              className="rounded-lg border border-danger/50 px-4 py-2 text-danger"
            >
              Delete group (its lists stay)
            </button>
          </div>
        )}

        <ul className="min-h-0 flex-1 overflow-auto">
          {members.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-content-muted">
              No lists in this group yet - add one below.
            </li>
          )}
          {members.map((list) => listRow(list))}
        </ul>

        {/* filling a group from inside it: a new list lands here
            directly, and an existing one can be moved in without going
            back out to its own settings */}
        <div className="flex flex-col gap-2 border-t border-line p-3">
          <div className="flex gap-2">
            <input
              value={newList}
              onChange={(e) => setNewList(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const trimmed = newList.trim();
                if (!trimmed) return;
                void createList(trimmed, currentGroup.id);
                setNewList("");
              }}
              placeholder={`New list in ${currentGroup.name}`}
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface-alt px-3 py-2"
            />
            <button
              onClick={() => {
                const trimmed = newList.trim();
                if (!trimmed) return;
                void createList(trimmed, currentGroup.id);
                setNewList("");
              }}
              className="rounded-lg bg-accent-fill px-4 py-2 font-medium text-white"
            >
              Add
            </button>
          </div>
          {outsiders.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                void setListGroup(Number(e.target.value), currentGroup.id);
              }}
              className="rounded-lg border border-line bg-surface-alt px-3 py-2 text-sm"
            >
              <option value="">Move an existing list in…</option>
              {outsiders.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                  {list.group_id !== null ? " (in another group)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    );
  }

  const addFromIndex = () => {
    const trimmed = newList.trim();
    if (!trimmed) return;
    if (newKind === "list") void createList(trimmed);
    else void createGroup(trimmed);
    setNewList("");
  };

  if (!current) {
    // same visibility rule as the desktop panel: an auto list ({Category},
    // Birthdays) earns a row only while something unscheduled or priority
    // lives in it - and the ordering (favorites first, then sort order or
    // the alphabet) matches the desktop too
    const ungrouped = orderLists(
      active.filter((l) => l.group_id === null),
      tasks,
      alpha,
    );
    return (
      <div className="flex h-full flex-col">
        <ul className="min-h-0 flex-1 overflow-auto">
          {groups.length === 0 && ungrouped.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-content-muted">
              No lists yet.
            </li>
          )}
          {/* groups open in place, members indented under them, so
              the whole hierarchy reads at a glance; the triangle folds
              a group, the gear opens its own screen (settings, filing
              lists in) */}
          {groups.map((group) => {
            const members = orderLists(
              active.filter((l) => l.group_id === group.id),
              tasks,
              alpha,
            );
            const folded = collapsed.has(group.id);
            return (
              <Fragment key={`g${group.id}`}>
                <li className="flex items-stretch border-b border-line/60">
                  <button
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={!folded}
                    className="flex min-w-0 flex-1 items-center gap-2 py-4 pl-4 text-left"
                  >
                    <span
                      aria-hidden
                      className="w-4 shrink-0 text-center text-xs text-content-muted"
                    >
                      {folded ? "▸" : "▾"}
                    </span>
                    {group.color && (
                      <span
                        aria-hidden
                        style={{ background: readable(group.color, "mark") }}
                        className="h-3 w-3 shrink-0 rounded-full"
                      />
                    )}
                    <span className="min-w-0 wrap-break-word font-medium">
                      {group.name}
                    </span>
                    <span className="ml-auto shrink-0 pl-3 text-sm text-content-muted">
                      {members.length}
                    </span>
                  </button>
                  <button
                    onClick={() => setGroupId(group.id)}
                    aria-label={`Open group ${group.name}`}
                    className="shrink-0 px-4 text-content-muted"
                  >
                    ⋯
                  </button>
                </li>
                {!folded && members.map((list) => listRow(list, true))}
              </Fragment>
            );
          })}
          {ungrouped.map((list) => listRow(list))}
        </ul>
        <div className="flex flex-col gap-2 border-t border-line p-3">
          {/* the same field makes both: a phone with no way to create a
              group could only ever see the ones a desktop had made */}
          <div className="flex gap-2 text-xs">
            {(["list", "group"] as const).map((kind) => (
              <button
                key={kind}
                onClick={() => setNewKind(kind)}
                className={`rounded-full px-3 py-1 ${
                  newKind === kind
                    ? "bg-accent/15 text-accent"
                    : "border border-line text-content-muted"
                }`}
              >
                {kind === "list" ? "List" : "Group"}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newList}
              onChange={(e) => setNewList(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addFromIndex()}
              placeholder={newKind === "list" ? "New list" : "New group"}
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface-alt px-3 py-2"
            />
            <button
              onClick={addFromIndex}
              className="rounded-lg bg-accent-fill px-4 py-2 font-medium text-white"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    );
  }

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    // a refused add gives the text back unless something new was typed
    void createTask({ title: trimmed, list_id: current.id }).then((ok) => {
      if (!ok) setTitle((now) => now || trimmed);
    });
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
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">Favourite</span>
            <Toggle
              checked={current.favorite}
              onChange={() => void toggleListFavorite(current.id)}
              label="Favourite"
            />
          </div>
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

      {sections.length === 0 ? (
        <p className="min-h-0 flex-1 px-4 py-8 text-center text-sm text-content-muted">
          This list is empty.
        </p>
      ) : (
        <Sections
          sections={sections}
          extras={(section, index) => {
            // Up/Down move within the backlog only - the one block the
            // desktop column lets a drag reorder
            const rows = section.rows;
            return {
              showList: false,
              neighbours:
                section.key === "rest"
                  ? {
                      previous: index > 0 ? rows[index - 1].task.id : undefined,
                      next:
                        index < rows.length - 1
                          ? rows[index + 1].task.id
                          : undefined,
                    }
                  : undefined,
            };
          }}
        />
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
          className="rounded-lg bg-accent-fill px-4 py-2 font-medium text-white"
        >
          Add
        </button>
      </div>
    </div>
  );
}
