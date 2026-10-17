import { useState, type KeyboardEvent } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableSyntheticListeners,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useAppStore } from "../store";

/** Keyboard dragging of task cards, shared with the Calendar. */
export const KEYBOARD_CODES = {
  start: ["Space"],
  cancel: ["Escape"],
  end: ["Space", "Enter"],
};

/** What the drag announcements call each id the drag-and-drop uses. */
export interface DndNames {
  task: (id: number) => string | undefined;
  list: (id: number) => string | undefined;
  group: (id: number) => string | undefined;
}

/**
 * A drag id in words, for the screen reader: `task:42` is the task's
 * title, `day:2026-10-15` the weekday and date, `list:3` the list's
 * name. dnd-kit's own announcements read the raw ids.
 */
export function describeDndId(raw: string | number, names: DndNames): string {
  const id = String(raw);
  const colon = id.indexOf(":");
  const kind = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  const quoted = (name: string | undefined, fallback: string) =>
    name ? `"${name}"` : fallback;
  switch (kind) {
    case "task":
    case "caltask":
      return `task ${quoted(names.task(Number(rest)), "")}`.trim();
    case "listmove":
    case "list":
      return `list ${quoted(names.list(Number(rest)), "")}`.trim();
    case "group":
      return rest === "none"
        ? "out of its group"
        : `group ${quoted(names.group(Number(rest)), "")}`.trim();
    case "day":
    case "calday": {
      const weekday = new Date(`${rest}T00:00:00`).toLocaleDateString("en-US", {
        weekday: "long",
      });
      return `${weekday} ${rest}`;
    }
    default:
      return id;
  }
}

/** dnd-kit `announcements` that speak names instead of ids. */
export function dndAnnouncements(names: DndNames) {
  const say = (id: string | number) => describeDndId(id, names);
  return {
    onDragStart: ({ active }: { active: { id: string | number } }) =>
      `Picked up ${say(active.id)}.`,
    onDragOver: ({
      active,
      over,
    }: {
      active: { id: string | number };
      over: { id: string | number } | null;
    }) =>
      over
        ? `${capitalize(say(active.id))} is over ${say(over.id)}.`
        : `${capitalize(say(active.id))} is no longer over a drop place.`,
    onDragEnd: ({
      active,
      over,
    }: {
      active: { id: string | number };
      over: { id: string | number } | null;
    }) =>
      over
        ? `${capitalize(say(active.id))} was dropped on ${say(over.id)}.`
        : `${capitalize(say(active.id))} was put back.`,
    onDragCancel: ({ active }: { active: { id: string | number } }) =>
      `Moving cancelled. ${capitalize(say(active.id))} was put back.`,
  };
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The names the announcements use, read from the store when spoken. */
const STORE_NAMES: DndNames = {
  task: (id) => useAppStore.getState().tasks.find((t) => t.id === id)?.title,
  list: (id) => useAppStore.getState().lists.find((l) => l.id === id)?.name,
  group: (id) => useAppStore.getState().groups.find((g) => g.id === id)?.name,
};

/** What a screen reader says on reaching a draggable task card, and
 *  while one is carried. */
export const DND_ACCESSIBILITY = {
  screenReaderInstructions: {
    draggable:
      "Enter opens the task. To move it, press Space, use the arrow keys to carry it to another day or list, then Space or Enter to drop it, or Escape to put it back.",
  },
  announcements: dndAnnouncements(STORE_NAMES),
};

/**
 * The props that make a dragged task card one keyboard stop: announced
 * as a task group (it holds its own buttons, so it cannot itself be a
 * button), named by the title, opened with Enter and picked up with
 * Space (the sensor's own key handler, passed everything but Enter).
 */
export function taskCardKeyboard(
  title: string,
  onOpen: (() => void) | undefined,
  listeners: DraggableSyntheticListeners,
) {
  return {
    role: "group",
    "aria-roledescription": "task",
    "aria-label": title,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" && e.target === e.currentTarget) {
        e.preventDefault();
        onOpen?.();
        return;
      }
      listeners?.onKeyDown?.(e);
    },
  } as const;
}

/**
 * Shared drag-and-drop wiring for every view that hosts task cards
 * (Dashboard, Lists, Days): dropping on a day column reschedules, on a
 * list column moves into the backlog, on a backlog card reorders or
 * moves into that card's list.
 *
 * The same context also carries the list columns themselves: a column's
 * header grip drags `listmove:<id>`, and dropping that on a group tile
 * (`group:<id>`) or on the open group's back bar (`group:none`) changes
 * the list's membership. Two kinds of drag, told apart by the id prefix,
 * because they share every drop target's screen space anyway.
 */
export function useTaskDnd() {
  const tasks = useAppStore((s) => s.tasks);
  const updateTask = useAppStore((s) => s.updateTask);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Space picks a focused card up, the arrows carry it, Space or
    // Enter drops it and Escape puts it back; Enter alone opens a card
    // (TaskCard), so it does not also start a drag
    useSensor(KeyboardSensor, { keyboardCodes: KEYBOARD_CODES }),
  );
  const activeTask = tasks.find((t) => t.id === activeTaskId) ?? null;

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    // a list drag has no card to show in the overlay
    setActiveTaskId(id.startsWith("task:") ? Number(id.slice(5)) : null);
  };

  const onDragCancel = () => setActiveTaskId(null);

  const onDragEnd = (event: DragEndEvent) => {
    setActiveTaskId(null);
    const { active, over } = event;
    if (!over) return;
    const source = String(active.id);
    const target = String(over.id);
    if (source.startsWith("listmove:")) {
      const listId = Number(source.slice(9));
      if (target === "group:none") {
        void useAppStore.getState().setListGroup(listId, null);
      } else if (target.startsWith("group:")) {
        void useAppStore.getState().setListGroup(listId, Number(target.slice(6)));
      }
      return;
    }
    const taskId = Number(source.replace("task:", ""));
    const task = tasks.find((t) => t.id === taskId);
    if (target.startsWith("day:")) {
      const date = target.slice(4);
      if (task?.scheduled_date === date) return;
      void updateTask(taskId, { scheduled_date: date });
    } else if (target.startsWith("list:")) {
      const listId = Number(target.slice(5));
      if (task && task.list_id === listId && task.scheduled_date === null)
        return;
      void updateTask(taskId, {
        list_id: listId,
        scheduled_date: null,
      });
    } else if (target.startsWith("task:")) {
      // dropped onto a backlog card: reorder within the list, or move
      // into that card's list when it is a different one
      void useAppStore.getState().reorderTask(taskId, Number(target.slice(5)));
    }
  };

  return { sensors, activeTask, onDragStart, onDragEnd, onDragCancel };
}
