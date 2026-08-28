import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import type { BirthdayView, ConfigError, UpcomingEvent } from "../types";

type SubTab = "scheduled" | "birthdays";

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
        {events.map((event, i) => (
          <div
            key={`${event.date}-${event.title}-${i}`}
            className="flex items-center gap-3 border-b border-line py-2 text-sm"
          >
            <span className="w-24 shrink-0 font-mono text-content-muted">
              {event.date}
            </span>
            <span className="flex-1">{event.title}</span>
            {event.time && (
              <span className="text-xs text-content-muted">{event.time}</span>
            )}
          </div>
        ))}
      </div>
    </div>
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
          onChange={(e) => setDate(e.target.value)}
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
        {birthdays.map((b, i) => (
          <div
            key={`${b.name}-${i}`}
            className="flex items-center gap-3 border-b border-line py-2 text-sm"
          >
            <span className="w-24 shrink-0 font-mono text-content-muted">
              {b.next_occurrence}
            </span>
            <span className="flex-1">
              {b.name}
              {b.turns !== null && (
                <span className="text-content-muted"> (turns {b.turns})</span>
              )}
            </span>
            <span className="text-xs text-content-muted">
              {b.days_until === 0 ? "today" : `in ${b.days_until}d`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
