import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useAppStore } from "../store";
import {
  categoryBlockIndex,
  categoryChipColor,
  categoryOf,
  splitCategory,
  tintStyle,
  todayISO,
  isClosed,
  STATUS_GLYPH,
  STATUS_GLYPH_CLASS,
} from "../lib/tasks";
import type { OutlookEvent, Task } from "../types";
import TaskModal from "../components/TaskModal";
import QuickAdd from "../components/QuickAdd";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// one dot per kind of thing happening that day: rule cadences, exact
// dates and birthdays each get a stable color
const KIND_DOT: Record<string, string> = {
  daily: "bg-zinc-400",
  weekly: "bg-blue-400",
  monthly: "bg-violet-400",
  yearly: "bg-amber-400",
  date: "bg-sky-400",
  birthday: "bg-pink-400",
  once: "bg-emerald-400",
};
const KIND_ORDER = Object.keys(KIND_DOT);

function taskKind(task: Task): string {
  if (task.origin === "scheduled") return "date";
  if (task.origin === "birthday") return "birthday";
  return task.cadence && task.cadence in KIND_DOT ? task.cadence : "once";
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Month cell as a drop target: dropping a task row here reschedules it
 *  to this date. */
function MonthCell({
  date,
  onSelect,
  className,
  children,
}: {
  date: string;
  onSelect: () => void;
  className: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `calday:${date}` });
  return (
    <button
      ref={setNodeRef}
      onClick={onSelect}
      className={`${className}${isOver ? " ring-2 ring-accent" : ""}`}
    >
      {children}
    </button>
  );
}

/** Task row of the selected day, draggable onto a month cell. */
function DayTaskRow({
  task,
  onOpen,
  children,
}: {
  task: Task;
  onOpen: () => void;
  children: ReactNode;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `caltask:${task.id}`,
  });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 rounded-md border border-line bg-surface-alt px-3 py-2 text-left text-sm hover:border-accent/60${
        isDragging ? " opacity-40" : ""
      }`}
      onClick={onOpen}
    >
      {children}
    </button>
  );
}

export default function Calendar() {
  const lists = useAppStore((s) => s.lists);
  const config = useAppStore((s) => s.config);
  const dowLabels = useAppStore((s) => s.config?.cron_weekday_labels ?? true);
  const everydayLabel = useAppStore(
    (s) => s.config?.cron_everyday_label ?? true,
  );
  const today = todayISO();
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)) - 1);
  const [selected, setSelected] = useState(today);
  const [monthTasks, setMonthTasks] = useState<Task[]>([]);
  const [outlook, setOutlook] = useState<OutlookEvent[]>([]);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  // any task mutation anywhere refreshes the month view
  const storeTasks = useAppStore((s) => s.tasks);

  const monthStart = iso(year, month, 1);
  const nextMonthStart =
    month === 11 ? iso(year + 1, 0, 1) : iso(year, month + 1, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthEnd = iso(year, month, daysInMonth);

  useEffect(() => {
    let cancelled = false;
    void invoke<Task[]>("tasks_snapshot", {
      startDate: monthStart,
      endDate: nextMonthStart,
    })
      .then((tasks) => {
        if (!cancelled) {
          setMonthTasks(
            tasks.filter(
              (t) =>
                t.parent_task_id === null &&
                t.scheduled_date !== null &&
                t.scheduled_date >= monthStart &&
                t.scheduled_date < nextMonthStart,
            ),
          );
        }
      })
      .catch((e) => useAppStore.getState().setError(String(e)));
    // projected occurrences beyond the grid horizon (Settings > Calendar
    // outlook controls how far each cadence reaches)
    // calendar_outlook's `to` is inclusive, unlike tasks_snapshot's
    // exclusive endDate above
    void invoke<OutlookEvent[]>("calendar_outlook", {
      from: monthStart,
      to: monthEnd,
    })
      .then((events) => {
        if (!cancelled) setOutlook(events);
      })
      .catch(() => setOutlook([]));
    return () => {
      cancelled = true;
    };
  }, [monthStart, nextMonthStart, monthEnd, storeTasks]);

  // keep the opened task fresh after edits made in the modal
  useEffect(() => {
    if (!openTask) return;
    const live = monthTasks.find((t) => t.id === openTask.id);
    if (live) {
      setOpenTask(live);
      return;
    }
    let cancelled = false;
    invoke<Task>("task_get", { id: openTask.id })
      .then((t) => {
        // closed (or switched) while in flight: do not reopen it
        if (!cancelled) setOpenTask((prev) => (prev?.id === t.id ? t : prev));
      })
      .catch(() => {
        if (!cancelled) setOpenTask(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthTasks]);

  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of monthTasks) {
      const date = task.scheduled_date as string;
      map.set(date, [...(map.get(date) ?? []), task]);
    }
    return map;
  }, [monthTasks]);

  const outlookByDate = useMemo(() => {
    const map = new Map<string, OutlookEvent[]>();
    for (const event of outlook) {
      map.set(event.date, [...(map.get(event.date) ?? []), event]);
    }
    return map;
  }, [outlook]);

  // Monday-first offset of the 1st
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const shiftMonth = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  // drag a task row onto a month cell to reschedule it to that date
  const updateTask = useAppStore((s) => s.updateTask);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const [dragTask, setDragTask] = useState<Task | null>(null);
  const onDragEnd = (event: DragEndEvent) => {
    setDragTask(null);
    const { active, over } = event;
    if (!over) return;
    const target = String(over.id);
    if (!target.startsWith("calday:")) return;
    const date = target.slice(7);
    const taskId = Number(String(active.id).replace("caltask:", ""));
    const task = monthTasks.find((t) => t.id === taskId);
    if (!task || task.scheduled_date === date) return;
    void updateTask(taskId, { scheduled_date: date });
    // follow the task to its new day so the move is visible immediately
    setSelected(date);
  };

  const selectedOutlook = outlookByDate.get(selected) ?? [];
  const listName = (id: number | null) =>
    lists.find((l) => l.id === id)?.name ?? null;
  // the same notion of "category" the day columns use: the {X} title
  // prefix, or the list a generated task belongs to
  const categoryOfTask = (task: Task) =>
    categoryOf(task.title) ?? listName(task.list_id);
  // same chip color a category wears on the task cards, so a category
  // is recognisable across the app (Settings > Appearance)
  const chipHue = (name: string, blockIndex?: number) =>
    categoryChipColor(name, lists, config, blockIndex);
  // tasks of the day grouped by category, so the alternating chip
  // colors read as blocks instead of a stripe pattern
  const selectedTasks = [...(byDate.get(selected) ?? [])].sort((a, b) => {
    const ca = categoryOfTask(a) ?? "";
    const cb = categoryOfTask(b) ?? "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.id - b.id;
  });
  // the alternating palette walks the day's list top to bottom, same
  // rule the day columns follow
  const blockIndex = categoryBlockIndex(selectedTasks, categoryOfTask);
  // chips follow the row text: 100% is exactly the size of the task
  // title next to them (Settings > Appearance)
  const chipSize = `${config?.chip_font_scale ?? 100}%`;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) =>
        setDragTask(
          monthTasks.find(
            (t) => t.id === Number(String(e.active.id).replace("caltask:", "")),
          ) ?? null,
        )
      }
      onDragCancel={() => setDragTask(null)}
      onDragEnd={onDragEnd}
    >
    <div className="flex h-full">
      <div className="flex w-[380px] shrink-0 flex-col gap-3 border-r border-line p-4">
        <div className="flex items-center justify-between">
          <button
            className="btn-ghost px-3 py-1"
            onClick={() => shiftMonth(-1)}
          >
            &lt;
          </button>
          <span className="text-sm font-semibold">
            {MONTHS[month]} {year}
          </span>
          <span className="flex items-center gap-1">
            <button
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => {
                setYear(Number(today.slice(0, 4)));
                setMonth(Number(today.slice(5, 7)) - 1);
                setSelected(today);
              }}
            >
              Today
            </button>
            <button
              className="btn-ghost px-3 py-1"
              onClick={() => shiftMonth(1)}
            >
              &gt;
            </button>
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-content-muted">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (day === null) return <span key={`empty-${i}`} />;
            const date = iso(year, month, day);
            const dayTasks = byDate.get(date) ?? [];
            const projected = outlookByDate.get(date)?.length ?? 0;
            const doneCount = dayTasks.filter(
              (t) => t.status === "done",
            ).length;
            const kinds = new Set<string>([
              ...dayTasks.map(taskKind),
              ...(outlookByDate.get(date) ?? []).map((e) => e.kind),
            ]);
            const dots = KIND_ORDER.filter((k) => kinds.has(k)).slice(0, 5);
            return (
              <MonthCell
                key={date}
                date={date}
                onSelect={() => setSelected(date)}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-md border text-sm ${
                  selected === date
                    ? "border-accent bg-accent/15 text-accent"
                    : date === today
                      ? "border-accent/50"
                      : "border-line hover:border-content-muted"
                }`}
              >
                <span className={date === today ? "font-bold" : ""}>
                  {day}
                </span>
                {dayTasks.length > 0 ? (
                  <span
                    className={`text-[11px] leading-none ${
                      doneCount === dayTasks.length
                        ? "text-accent"
                        : "text-content-muted"
                    }`}
                  >
                    {doneCount}/{dayTasks.length}
                  </span>
                ) : (
                  projected > 0 && (
                    <span className="text-[11px] leading-none text-content-muted">
                      +{projected}
                    </span>
                  )
                )}
                {dots.length > 0 && (
                  <span className="flex gap-0.5">
                    {dots.map((k) => (
                      <span
                        key={k}
                        title={k}
                        className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[k]}`}
                      />
                    ))}
                  </span>
                )}
              </MonthCell>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-content-muted">
          {KIND_ORDER.map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[k]}`} />
              {k}
            </span>
          ))}
        </div>
        <p className="text-xs text-content-muted">
          Done one-off tasks may be pruned by retention; pruned days show
          fewer tasks than were actually completed.
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
        <h2 className="text-sm font-semibold">{selected}</h2>
        {selectedTasks.length === 0 && selectedOutlook.length === 0 && (
          <p className="text-sm text-content-muted">
            No tasks recorded for this day.
          </p>
        )}
        {selectedTasks.map((task) => (
          <DayTaskRow
            key={task.id}
            task={task}
            onOpen={() => setOpenTask(task)}
          >
            <span
              className={STATUS_GLYPH_CLASS[task.status]}
              style={
                task.status === "done"
                  ? { color: "var(--color-done)" }
                  : undefined
              }
            >
              {STATUS_GLYPH[task.status]}
            </span>
            <span
              className={`min-w-0 flex-1 truncate ${
                isClosed(task.status) ? "text-content-muted line-through" : ""
              }`}
            >
              {task.dow_label &&
                dowLabels &&
                (task.dow_label !== "EVERYDAY" || everydayLabel) &&
                `[${task.dow_label}] `}
              {splitCategory(task.title).text}
            </span>
            {task.time && (
              <span className="text-content-muted" style={{ fontSize: chipSize }}>
                {task.time}
              </span>
            )}
            {categoryOfTask(task) && (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 font-semibold"
                style={{
                  ...tintStyle(
                    chipHue(categoryOfTask(task)!, blockIndex.get(task.id)),
                  ),
                  fontSize: chipSize,
                }}
                title={`Category: ${categoryOfTask(task)}`}
              >
                {categoryOfTask(task)}
              </span>
            )}
          </DayTaskRow>
        ))}
        {selectedOutlook.length > 0 && (
          <>
            <div className="pt-2 text-[11px] font-medium uppercase tracking-wider text-content-muted">
              Projected
            </div>
            {selectedOutlook.map((event, i) => (
              <div
                key={`${event.title}-${i}`}
                className="flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-2 text-sm text-content-muted"
                title="Not generated yet; appears as a task when the date nears"
              >
                <span
                  className="w-16 shrink-0 rounded bg-line/40 px-1.5 py-0.5 text-center"
                  style={{ fontSize: chipSize }}
                >
                  {event.kind}
                </span>
                <span className="min-w-0 flex-1 truncate">{event.title}</span>
              </div>
            ))}
          </>
        )}
        <div className="pt-1">
          <QuickAdd target={{ scheduled_date: selected }} />
        </div>
      </div>
      {openTask && (
        <TaskModal task={openTask} onClose={() => setOpenTask(null)} />
      )}
    </div>
    <DragOverlay>
      {dragTask && (
        <div className="flex items-center gap-2 rounded-md border border-accent/60 bg-surface-alt px-3 py-2 text-sm shadow-lg">
          <span className="min-w-0 flex-1 truncate">
            {splitCategory(dragTask.title).text}
          </span>
        </div>
      )}
    </DragOverlay>
    </DndContext>
  );
}
