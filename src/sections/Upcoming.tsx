import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { ConfirmModal } from "../components/dialogs";
import { DeleteRowButton, EditFormButtons } from "../components/rowForms";
import { DateInput, MonthDayInput } from "../components/dateFields";
import Recurring from "./Recurring";
import type { BirthdayView, ConfigError, UpcomingEvent } from "../types";

type SubTab = "scheduled" | "birthdays" | "recurring";

export default function Upcoming() {
  const { runEngine, refresh } = useAppStore();
  const vaultVersion = useAppStore((s) => s.vaultVersion);
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

  // reload whenever the engine ran (sync button, watcher, YAML edit in
  // Notes), so the list never shows a stale file state
  useEffect(() => {
    void load();
  }, [load, vaultVersion]);

  // runEngine bumps vaultVersion, which already triggers load() via the
  // effect above - an explicit load() here would double-fetch
  const afterWrite = async () => {
    await runEngine();
    await refresh();
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 p-6">
      <div className="flex gap-1 border-b border-line">
        {(["scheduled", "birthdays", "recurring"] as const).map((t) => (
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
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {fileErrors.map((err, i) => (
            <div key={i}>
              {err.file}
              {err.line !== null ? ` line ${err.line}` : ""}: {err.message}
            </div>
          ))}
        </div>
      )}

      {tab === "scheduled" && (
        <ScheduledTab events={events} onWrite={afterWrite} />
      )}
      {tab === "birthdays" && (
        <BirthdaysTab birthdays={birthdays} onWrite={afterWrite} />
      )}
      {tab === "recurring" && <Recurring />}
    </div>
  );
}

type EventFields = { date: string; title: string; time: string | null };

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
  const [confirmDelete, setConfirmDelete] = useState<UpcomingEvent | null>(
    null,
  );

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title.trim()) return;
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

  const fieldsOf = (e: UpcomingEvent): EventFields => ({
    date: e.date,
    title: e.title,
    time: e.time,
  });

  const remove = async (event: UpcomingEvent) => {
    setConfirmDelete(null);
    try {
      await invoke("scheduled_edit", {
        original: fieldsOf(event),
        replacement: null,
      });
      await onWrite();
    } catch (err) {
      setError(err);
    }
  };

  const save = async (original: UpcomingEvent, replacement: EventFields) => {
    try {
      await invoke("scheduled_edit", { original: fieldsOf(original), replacement });
      setEditing(null);
      await onWrite();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <form className="flex gap-2" onSubmit={add}>
        <DateInput
          className="w-36"
          required
          value={date}
          onChange={setDate}
        />
        <input
          className="input min-w-0 flex-1"
          placeholder="{List} event title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="input"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <button className="btn-primary py-0">
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
        {events.map((event, i) => {
          const editable = event.source === "scheduled.yml";
          return editing === i ? (
            <EventEditRow
              key={`edit-${i}`}
              event={event}
              onCancel={() => setEditing(null)}
              onSave={(replacement) => void save(event, replacement)}
            />
          ) : (
            <div
              key={`${event.date}-${event.title}-${i}`}
              className={`group flex items-center gap-3 border-b border-line py-2 text-sm ${
                editable ? "cursor-pointer hover:bg-line/20" : ""
              }`}
              title={
                editable ? "Click to edit" : `Read-only: from ${event.source}`
              }
              onClick={() => editable && setEditing(i)}
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
              {!editable && (
                <span className="max-w-[140px] truncate rounded bg-line/40 px-1.5 py-0.5 text-[11px] text-content-muted">
                  {event.source}
                </span>
              )}
              {editable && (
                <DeleteRowButton
                  onDelete={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(event);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      {confirmDelete && (
        <ConfirmModal
          title={`Delete "${confirmDelete.title}" (${confirmDelete.date})?`}
          onConfirm={() => void remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function EventEditRow({
  event,
  onSave,
  onCancel,
}: {
  event: UpcomingEvent;
  onSave: (replacement: EventFields) => void;
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
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title.trim()) return;
        onSave({ date, title: title.trim(), time: time || null });
      }}
    >
      <DateInput
        className="w-36"
        required
        value={date}
        onChange={setDate}
      />
      <input
        className="input min-w-0 flex-1"
        required
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
  const [confirmDelete, setConfirmDelete] = useState<BirthdayView | null>(
    null,
  );

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
    setConfirmDelete(null);
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
        <MonthDayInput
          className="w-24"
          required
          value={date}
          onChange={setDate}
        />
        <input
          className="input w-24"
          type="number"
          placeholder="Year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
        <button className="btn-primary py-0">
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
        {birthdays.map((b, i) => {
          const editable = b.source === "birthdays.yml";
          return editing === i ? (
            <BirthdayEditRow
              key={`edit-${i}`}
              birthday={b}
              onCancel={() => setEditing(null)}
              onSave={(replacement) => void save(b, replacement)}
            />
          ) : (
            <div
              key={`${b.name}-${i}`}
              className={`group flex items-center gap-3 border-b border-line py-2 text-sm ${
                editable ? "cursor-pointer hover:bg-line/20" : ""
              }`}
              title={editable ? "Click to edit" : `Read-only: from ${b.source}`}
              onClick={() => editable && setEditing(i)}
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
              {!editable && (
                <span className="max-w-[140px] truncate rounded bg-line/40 px-1.5 py-0.5 text-[11px] text-content-muted">
                  {b.source}
                </span>
              )}
              {editable && (
                <DeleteRowButton
                  onDelete={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(b);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      {confirmDelete && (
        <ConfirmModal
          title={`Delete birthday "${confirmDelete.name}"?`}
          onConfirm={() => void remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
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
      <MonthDayInput
        className="w-24"
        required
        value={date}
        onChange={setDate}
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
