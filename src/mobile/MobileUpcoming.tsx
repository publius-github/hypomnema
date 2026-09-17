import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import type {
  BirthdayEntry,
  BirthdaysResult,
  RecurringResult,
  RecurringRule,
  ScheduledEvent,
  UpcomingResult,
} from "../types";

type Sub = "scheduled" | "birthdays" | "recurring";

const SUBS: { id: Sub; label: string }[] = [
  { id: "scheduled", label: "Scheduled" },
  { id: "birthdays", label: "Birthdays" },
  { id: "recurring", label: "Recurring" },
];

/**
 * The three rule files, editable from the phone (REQUIREMENTS.md §6, P0).
 *
 * Every write goes through the same commands the desktop uses, which
 * splice the YAML in place rather than re-serializing it - so a rule
 * added from a phone leaves the hand-written comments around it intact.
 * That was listed as a P1 "nice to have" for mobile; it comes for free
 * by not building a second writer.
 */
export default function MobileUpcoming() {
  const [sub, setSub] = useState<Sub>("scheduled");
  const [scheduled, setScheduled] = useState<UpcomingResult | null>(null);
  const [birthdays, setBirthdays] = useState<BirthdaysResult | null>(null);
  const [recurring, setRecurring] = useState<RecurringResult | null>(null);
  const setError = useAppStore((s) => s.setError);
  const vaultVersion = useAppStore((s) => s.vaultVersion);

  const load = useCallback(() => {
    void invoke<UpcomingResult>("upcoming_events")
      .then(setScheduled)
      .catch((e) => setError(String(e)));
    void invoke<BirthdaysResult>("birthdays_list")
      .then(setBirthdays)
      .catch((e) => setError(String(e)));
    void invoke<RecurringResult>("recurring_list")
      .then(setRecurring)
      .catch((e) => setError(String(e)));
  }, [setError]);

  useEffect(load, [load, vaultVersion]);

  const act = async (run: () => Promise<unknown>) => {
    try {
      await run();
      await useAppStore.getState().runEngine();
      await useAppStore.getState().refresh();
      load();
    } catch (e) {
      setError(String(e));
    }
  };

  const errors =
    scheduled?.errors ?? birthdays?.errors ?? recurring?.errors ?? [];

  return (
    <div className="flex h-full flex-col">
      <nav className="flex shrink-0 border-b border-line">
        {SUBS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setSub(entry.id)}
            className={`flex-1 px-2 py-3 text-sm ${
              sub === entry.id
                ? "border-b-2 border-accent text-accent"
                : "text-content-muted"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {errors.length > 0 && (
        <p className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          {errors.map((e) => `${e.file}: ${e.message}`).join("; ")}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {sub === "scheduled" && <Scheduled result={scheduled} act={act} />}
        {sub === "birthdays" && <Birthdays result={birthdays} act={act} />}
        {sub === "recurring" && <Recurring result={recurring} act={act} />}
      </div>
    </div>
  );
}

type Act = (run: () => Promise<unknown>) => Promise<void>;

function Scheduled({
  result,
  act,
}: {
  result: UpcomingResult | null;
  act: Act;
}) {
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScheduledEvent>({
    date: "",
    title: "",
    time: null,
  });

  return (
    <div className="flex flex-col">
      <ul>
        {result?.events.length === 0 && <Empty>Nothing scheduled.</Empty>}
        {result?.events.map((event) => {
          const key = `${event.date}-${event.title}-${event.source}`;
          return (
          <li key={key} className="border-b border-line/60 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block break-words">{event.title}</span>
                <span className="text-xs text-content-muted">
                  {event.date}
                  {event.time && ` · ${event.time}`}
                  {event.source !== "scheduled.yml" && ` · ${event.source}`}
                </span>
              </span>
              {/* Only rows that live in the root scheduled.yml can be
                  spliced back by index; a pack's row is shown but not
                  edited, exactly as on the desktop. */}
              {event.source === "scheduled.yml" && (
                <span className="flex shrink-0 gap-3">
                  <button
                    onClick={() => {
                      setEditing(editing === key ? null : key);
                      setDraft({
                        date: event.date,
                        title: event.title,
                        time: event.time,
                      });
                    }}
                    className="text-sm text-content-muted"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() =>
                      void act(() =>
                        invoke("scheduled_edit", {
                          original: {
                            date: event.date,
                            title: event.title,
                            time: event.time,
                          },
                          replacement: null,
                        }),
                      )
                    }
                    className="text-sm text-danger"
                  >
                    Delete
                  </button>
                </span>
              )}
            </div>
            {editing === key && (
              <div className="mt-2 flex flex-col gap-2">
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                  className="rounded-lg border border-line bg-surface-alt px-3 py-2"
                />
                <input
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                  className="rounded-lg border border-line bg-surface-alt px-3 py-2"
                />
                <input
                  type="time"
                  value={draft.time ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, time: e.target.value || null })
                  }
                  className="rounded-lg border border-line bg-surface-alt px-3 py-2"
                />
                <button
                  onClick={() => {
                    if (!draft.date || !draft.title.trim()) return;
                    void act(() =>
                      invoke("scheduled_edit", {
                        original: {
                          date: event.date,
                          title: event.title,
                          time: event.time,
                        },
                        replacement: {
                          ...draft,
                          title: draft.title.trim(),
                        },
                      }),
                    ).then(() => setEditing(null));
                  }}
                  className="rounded-lg bg-accent px-4 py-2 font-medium text-white"
                >
                  Save
                </button>
              </div>
            )}
          </li>
          );
        })}
      </ul>
      <AddBox
        onAdd={() => {
          if (!date || !title.trim()) return;
          const event: ScheduledEvent = {
            date,
            title: title.trim(),
            time: time || null,
          };
          void act(() => invoke("scheduled_add", { event })).then(() => {
            setTitle("");
            setTime("");
          });
        }}
      >
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-line bg-surface-alt px-3 py-2"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What happens"
          className="rounded-lg border border-line bg-surface-alt px-3 py-2"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="rounded-lg border border-line bg-surface-alt px-3 py-2"
        />
      </AddBox>
    </div>
  );
}

function Birthdays({
  result,
  act,
}: {
  result: BirthdaysResult | null;
  act: Act;
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [year, setYear] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<BirthdayEntry>({
    name: "",
    date: "",
    year: null,
  });

  return (
    <div className="flex flex-col">
      <ul>
        {result?.birthdays.length === 0 && <Empty>No birthdays yet.</Empty>}
        {result?.birthdays.map((entry) => {
          const key = `${entry.name}-${entry.date}`;
          return (
          <li key={key} className="border-b border-line/60 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block break-words">{entry.name}</span>
                <span className="text-xs text-content-muted">
                  {entry.next_occurrence} · in {entry.days_until} d
                  {entry.turns !== null && ` · turns ${entry.turns}`}
                </span>
              </span>
              {entry.source === "birthdays.yml" && (
                <span className="flex shrink-0 gap-3">
                  <button
                    onClick={() => {
                      setEditing(editing === key ? null : key);
                      setDraft({
                        name: entry.name,
                        date: entry.date,
                        year: entry.year,
                      });
                    }}
                    className="text-sm text-content-muted"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() =>
                      void act(() =>
                        invoke("birthday_edit", {
                          original: {
                            name: entry.name,
                            date: entry.date,
                            year: entry.year,
                          },
                          replacement: null,
                        }),
                      )
                    }
                    className="text-sm text-danger"
                  >
                    Delete
                  </button>
                </span>
              )}
            </div>
            {editing === key && (
              <div className="mt-2 flex flex-col gap-2">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Whose birthday"
                  className="rounded-lg border border-line bg-surface-alt px-3 py-2"
                />
                <input
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                  placeholder="MM-DD"
                  inputMode="numeric"
                  className="rounded-lg border border-line bg-surface-alt px-3 py-2"
                />
                <input
                  value={draft.year === null ? "" : String(draft.year)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      year: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  placeholder="Year born (optional)"
                  inputMode="numeric"
                  className="rounded-lg border border-line bg-surface-alt px-3 py-2"
                />
                <button
                  onClick={() => {
                    if (
                      !draft.name.trim() ||
                      !/^\d{2}-\d{2}$/.test(draft.date)
                    )
                      return;
                    void act(() =>
                      invoke("birthday_edit", {
                        original: {
                          name: entry.name,
                          date: entry.date,
                          year: entry.year,
                        },
                        replacement: { ...draft, name: draft.name.trim() },
                      }),
                    ).then(() => setEditing(null));
                  }}
                  className="rounded-lg bg-accent px-4 py-2 font-medium text-white"
                >
                  Save
                </button>
              </div>
            )}
          </li>
          );
        })}
      </ul>
      <AddBox
        onAdd={() => {
          if (!name.trim() || !/^\d{2}-\d{2}$/.test(date)) return;
          const entry: BirthdayEntry = {
            name: name.trim(),
            date,
            year: year ? Number(year) : null,
          };
          void act(() => invoke("birthday_add", { entry })).then(() => {
            setName("");
            setDate("");
            setYear("");
          });
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Whose birthday"
          className="rounded-lg border border-line bg-surface-alt px-3 py-2"
        />
        <input
          value={date}
          onChange={(e) => setDate(e.target.value)}
          placeholder="MM-DD"
          inputMode="numeric"
          className="rounded-lg border border-line bg-surface-alt px-3 py-2"
        />
        <input
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="Year born (optional)"
          inputMode="numeric"
          className="rounded-lg border border-line bg-surface-alt px-3 py-2"
        />
      </AddBox>
    </div>
  );
}

function Recurring({
  result,
  act,
}: {
  result: RecurringResult | null;
  act: Act;
}) {
  const [schedule, setSchedule] = useState("");
  const [items, setItems] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<{
    schedule: string;
    description: string;
    items: string;
    // carried through untouched: the phone has no threshold control, and
    // editing a rule here must not drop its own rate-alert threshold
    threshold?: number;
  }>({ schedule: "", description: "", items: "" });

  return (
    <div className="flex flex-col">
      <ul>
        {result?.rules.length === 0 && <Empty>No recurring rules yet.</Empty>}
        {result?.rules.map((rule, index) => (
          <li
            key={`${rule.source}-${index}`}
            className="border-b border-line/60 px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block break-words">
                  {rule.description || rule.items.join(", ")}
                </span>
                <span className="block break-words text-xs text-content-muted">
                  {rule.schedule}
                  {rule.source !== "recurring.yml" && ` · ${rule.source}`}
                </span>
                {rule.description && (
                  <span className="block break-words text-xs text-content-muted">
                    {rule.items.join(", ")}
                  </span>
                )}
              </span>
              {rule.source === "recurring.yml" && (
                <span className="flex shrink-0 gap-3">
                  <button
                    onClick={() => {
                      setEditing(editing === index ? null : index);
                      setDraft({
                        schedule: rule.schedule,
                        description: rule.description,
                        items: rule.items.join("\n"),
                        // the view type spells "no threshold" as null,
                        // the rule payload as an absent key
                        threshold: rule.threshold ?? undefined,
                      });
                    }}
                    className="text-sm text-content-muted"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() =>
                      void act(() =>
                        invoke("recurring_edit", { index, replacement: null }),
                      )
                    }
                    className="text-sm text-danger"
                  >
                    Delete
                  </button>
                </span>
              )}
            </div>
            {editing === index && (
              <div className="mt-2 flex flex-col gap-2">
                <input
                  value={draft.schedule}
                  onChange={(e) =>
                    setDraft({ ...draft, schedule: e.target.value })
                  }
                  placeholder="Cron, e.g. 0 9 * * 1-5"
                  className="rounded-lg border border-line bg-surface-alt px-3 py-2 font-mono text-sm"
                />
                <input
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                  placeholder="Description (optional)"
                  className="rounded-lg border border-line bg-surface-alt px-3 py-2"
                />
                <textarea
                  value={draft.items}
                  onChange={(e) =>
                    setDraft({ ...draft, items: e.target.value })
                  }
                  rows={3}
                  placeholder="One task per line; {List} prefix picks a list"
                  className="resize-none rounded-lg border border-line bg-surface-alt px-3 py-2"
                />
                <button
                  onClick={() => {
                    const lines = draft.items
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean);
                    if (!draft.schedule.trim() || lines.length === 0) return;
                    const replacement: RecurringRule = {
                      schedule: draft.schedule.trim(),
                      description: draft.description.trim(),
                      items: lines,
                      ...(draft.threshold === undefined
                        ? {}
                        : { threshold: draft.threshold }),
                    };
                    void act(() =>
                      invoke("recurring_edit", { index, replacement }),
                    ).then(() => setEditing(null));
                  }}
                  className="rounded-lg bg-accent px-4 py-2 font-medium text-white"
                >
                  Save
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <AddBox
        onAdd={() => {
          const lines = items
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          if (!schedule.trim() || lines.length === 0) return;
          const rule: RecurringRule = {
            schedule: schedule.trim(),
            description: "",
            items: lines,
          };
          void act(() => invoke("recurring_add", { rule })).then(() => {
            setSchedule("");
            setItems("");
          });
        }}
      >
        <input
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          placeholder="Cron, e.g. 0 9 * * 1-5"
          className="rounded-lg border border-line bg-surface-alt px-3 py-2 font-mono text-sm"
        />
        <textarea
          value={items}
          onChange={(e) => setItems(e.target.value)}
          rows={2}
          placeholder="One task per line; {List} prefix picks a list"
          className="resize-none rounded-lg border border-line bg-surface-alt px-3 py-2"
        />
      </AddBox>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-4 py-8 text-center text-sm text-content-muted">
      {children}
    </li>
  );
}

/**
 * The add form, folded away until asked for. On a phone an open form
 * under every list would push the list itself off the screen.
 */
function AddBox({
  children,
  onAdd,
}: {
  children: React.ReactNode;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="m-3 rounded-lg bg-accent px-4 py-3 font-medium text-white"
      >
        + Add
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-t border-line p-3">
      {children}
      <div className="flex gap-2">
        <button
          onClick={onAdd}
          className="flex-1 rounded-lg bg-accent px-4 py-2 font-medium text-white"
        >
          Add
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border border-line px-4 py-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
