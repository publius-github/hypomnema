import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import type { BirthdayView, ConfigError, UpcomingEvent } from "../types";

type SubTab = "scheduled" | "birthdays";

// "0830" -> "08-30" while typing, so the hyphen never has to be typed
export function formatMmDd(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits;
}

export default function Upcoming() {
  const { runEngine, refresh } = useAppStore();
  const setError = useCallback(
    (e: unknown) => useAppStore.setState({ error: String(e) }),
    [],
  );
  const [tab, setTab] = useState<SubTab>("scheduled");
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [birthdays, setBirthdays] = useState<BirthdayView[]>([]);
  const [fileErrors, setFileErrors] = useState<ConfigError[]>([]);

  const load = useCallback(async () => {
    try {
      const [upcoming, bdays] = await Promise.all([
        invoke<{ events: UpcomingEvent[]; errors: ConfigError[] }>(
          "upcoming_events",
        ),
        invoke<{ birthdays: BirthdayView[]; errors: ConfigError[] }>(
          "birthdays_list",
        ),
      ]);
      setEvents(upcoming.events);
      setBirthdays(bdays.birthdays);
      setFileErrors([...upcoming.errors, ...bdays.errors]);
    } catch (e) {
      setError(e);
    }
  }, [setError]);

  useEffect(() => {
    void load();
  }, [load]);

  const afterWrite = async () => {
    await runEngine();
    await refresh();
    await load();
  };

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 p-6">
      <div className="flex gap-1 border-b border-line">
        {(["scheduled", "birthdays"] as const).map((t) => (
          <button
            key={t}
            className={`px-4 py-2 text-sm font-medium capitalize ${
              tab === t
                ? "border-b-2 border-accent text-accent"
                : "text-content-muted hover:text-content"
            }`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {fileErrors.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          {fileErrors.map((err, i) => (
            <div key={i}>
              {err.file}
              {err.line !== null ? ` line ${err.line}` : ""}: {err.message}
            </div>
          ))}
        </div>
      )}

      {tab === "scheduled" ? (
        <ScheduledTab events={events} onWrite={afterWrite} />
      ) : (
        <BirthdaysTab birthdays={birthdays} onWrite={afterWrite} />
      )}
    </div>
  );
}

function ScheduledTab({
  events,
  onWrite,
}: {
  events: UpcomingEvent[];
  onWrite: () => Promise<void>;
}) {
  const setError = (e: unknown) => useAppStore.setState({ error: String(e) });
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [editing, setEditing] = useState<number | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !title.trim()) return;
    try {
      await invoke("scheduled_add", {
        event: { date, title: title.trim(), time: time || null },
      });
      setDate("");
      setTitle("");
      setTime("");
      await onWrite();
    } catch (err) {
      setError(err);
    }
  };

  const remove = async (event: UpcomingEvent) => {
    if (!confirm(`Delete "${event.title}" (${event.date})?`)) return;
    try {
      await invoke("scheduled_edit", { original: event, replacement: null });
      await onWrite();
    } catch (err) {
      setError(err);
    }
  };

  const save = async (original: UpcomingEvent, replacement: UpcomingEvent) => {
    try {
      await invoke("scheduled_edit", { original, replacement });
      setEditing(null);
      await onWrite();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <form className="flex gap-2" onSubmit={add}>
        <input
          className="input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          className="input min-w-0 flex-1"
          placeholder="{List} event title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="input"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <button className="rounded-md bg-accent px-4 text-sm font-medium text-white">
          Add
        </button>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {events.length === 0 && (
          <p className="pt-6 text-center text-sm text-content-muted">
            No upcoming events. Events wait here until their date enters the
            week grid, then become normal tasks.
          </p>
        )}
        {events.map((event, i) =>
          editing === i ? (
            <EventEditRow
              key={`edit-${i}`}
              event={event}
              onCancel={() => setEditing(null)}
              onSave={(replacement) => void save(event, replacement)}
            />
          ) : (
            <div
              key={`${event.date}-${event.title}-${i}`}
              className="group flex items-center gap-3 border-b border-line py-2 text-sm"
            >
              <span className="w-24 shrink-0 font-mono text-content-muted">
                {event.date}
              </span>
              <span className="min-w-0 flex-1 truncate">{event.title}</span>
              {event.time && (
                <span className="text-xs text-content-muted">
                  {event.time}
                </span>
              )}
              <RowActions
                onEdit={() => setEditing(i)}
                onDelete={() => void remove(event)}
              />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function EventEditRow({
  event,
  onSave,
  onCancel,
}: {
  event: UpcomingEvent;
  onSave: (replacement: UpcomingEvent) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(event.date);
  const [title, setTitle] = useState(event.title);
  const [time, setTime] = useState(event.time ?? "");

  return (
    <form
      className="flex items-center gap-2 border-b border-line py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!date || !title.trim()) return;
        onSave({ date, title: title.trim(), time: time || null });
      }}
    >
      <input
        className="input"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <input
        className="input min-w-0 flex-1"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className="input"
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
      />
      <EditFormButtons onCancel={onCancel} />
    </form>
  );
}

function BirthdaysTab({
  birthdays,
  onWrite,
}: {
  birthdays: BirthdayView[];
  onWrite: () => Promise<void>;
}) {
  const setError = (e: unknown) => useAppStore.setState({ error: String(e) });
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [year, setYear] = useState("");
  const [editing, setEditing] = useState<number | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !/^\d{2}-\d{2}$/.test(date)) return;
    try {
      await invoke("birthday_add", {
        entry: {
          name: name.trim(),
          date,
          year: year ? Number(year) : null,
        },
      });
      setName("");
      setDate("");
      setYear("");
      await onWrite();
    } catch (err) {
      setError(err);
    }
  };

  const entryOf = (b: BirthdayView) => ({
    name: b.name,
    date: b.date,
    year: b.year,
  });

  const remove = async (b: BirthdayView) => {
    if (!confirm(`Delete birthday "${b.name}"?`)) return;
    try {
      await invoke("birthday_edit", {
        original: entryOf(b),
        replacement: null,
      });
      await onWrite();
    } catch (err) {
      setError(err);
    }
  };

  const save = async (
    b: BirthdayView,
    replacement: { name: string; date: string; year: number | null },
  ) => {
    try {
      await invoke("birthday_edit", { original: entryOf(b), replacement });
      setEditing(null);
      await onWrite();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <form className="flex gap-2" onSubmit={add}>
        <input
          className="input min-w-0 flex-1"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input w-24"
          placeholder="MM-DD"
          value={date}
          onChange={(e) => setDate(formatMmDd(e.target.value))}
        />
        <input
          className="input w-24"
          type="number"
          placeholder="Year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
        <button className="rounded-md bg-accent px-4 text-sm font-medium text-white">
          Add
        </button>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {birthdays.length === 0 && (
          <p className="pt-6 text-center text-sm text-content-muted">
            No birthdays yet. Each entry creates a yearly reminder task in
            the Birthdays list.
          </p>
        )}
        {birthdays.map((b, i) =>
          editing === i ? (
            <BirthdayEditRow
              key={`edit-${i}`}
              birthday={b}
              onCancel={() => setEditing(null)}
              onSave={(replacement) => void save(b, replacement)}
            />
          ) : (
            <div
              key={`${b.name}-${i}`}
              className="group flex items-center gap-3 border-b border-line py-2 text-sm"
            >
              <span className="w-24 shrink-0 font-mono text-content-muted">
                {b.next_occurrence}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {b.name}
                {b.turns !== null && (
                  <span className="text-content-muted"> (turns {b.turns})</span>
                )}
              </span>
              <span className="text-xs text-content-muted">
                {b.days_until === 0 ? "today" : `in ${b.days_until}d`}
              </span>
              <RowActions
                onEdit={() => setEditing(i)}
                onDelete={() => void remove(b)}
              />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function BirthdayEditRow({
  birthday,
  onSave,
  onCancel,
}: {
  birthday: BirthdayView;
  onSave: (replacement: {
    name: string;
    date: string;
    year: number | null;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(birthday.name);
  const [date, setDate] = useState(birthday.date);
  const [year, setYear] = useState(
    birthday.year !== null ? String(birthday.year) : "",
  );

  return (
    <form
      className="flex items-center gap-2 border-b border-line py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !/^\d{2}-\d{2}$/.test(date)) return;
        onSave({
          name: name.trim(),
          date,
          year: year ? Number(year) : null,
        });
      }}
    >
      <input
        className="input min-w-0 flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="input w-24"
        placeholder="MM-DD"
        value={date}
        onChange={(e) => setDate(formatMmDd(e.target.value))}
      />
      <input
        className="input w-24"
        type="number"
        placeholder="Year"
        value={year}
        onChange={(e) => setYear(e.target.value)}
      />
      <EditFormButtons onCancel={onCancel} />
    </form>
  );
}

function RowActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <span className="hidden shrink-0 gap-1 group-hover:flex">
      <button
        className="rounded px-1.5 text-xs text-content-muted hover:text-accent"
        title="Edit"
        onClick={onEdit}
      >
        &#9998;
      </button>
      <button
        className="rounded px-1.5 text-xs text-content-muted hover:text-red-500"
        title="Delete"
        onClick={onDelete}
      >
        &#215;
      </button>
    </span>
  );
}

export function EditFormButtons({ onCancel }: { onCancel: () => void }) {
  return (
    <span className="flex shrink-0 gap-1">
      <button
        type="submit"
        className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white"
      >
        Save
      </button>
      <button
        type="button"
        className="rounded-md border border-line px-3 py-1 text-xs text-content-muted hover:text-content"
        onClick={onCancel}
      >
        Cancel
      </button>
    </span>
  );
}
