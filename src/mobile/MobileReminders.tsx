import { useCallback, useEffect, useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import type { RemindersOverview } from "../types";

const DAY_TYPES = [
  "workday",
  "weekend",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

/**
 * The three ambient files behind the day view: the weekly focus phrase,
 * the day-type reminders, and the schedule blocks.
 *
 * Read *and* write, though the first plan only asked for read on
 * mobile first. The reason it costs almost nothing: these files are
 * edited by index through the same comment-preserving splice the desktop
 * uses, so the whole feature is a list and an add box over commands that
 * already exist.
 */
export default function MobileReminders() {
  const [overview, setOverview] = useState<RemindersOverview | null>(null);
  const setError = useAppStore((s) => s.setError);
  const vaultVersion = useAppStore((s) => s.vaultVersion);

  const load = useCallback(() => {
    void invoke("reminders_overview")
      .then(setOverview)
      .catch((e) => setError(errorMessage(e)));
  }, [setError]);
  useEffect(load, [load, vaultVersion]);

  const act = async (run: () => Promise<unknown>) => {
    try {
      await run();
      load();
      await useAppStore.getState().refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const [phrase, setPhrase] = useState("");
  const [reminderText, setReminderText] = useState("");
  const [dayType, setDayType] = useState("workday");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");

  if (!overview) {
    return <p className="px-4 py-8 text-sm text-content-muted">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      {overview.errors.length > 0 && (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {overview.errors.map((e) => `${e.file}: ${e.message}`).join("; ")}
        </p>
      )}

      <section className="flex flex-col gap-1">
        <h2 className="font-semibold">Right now</h2>
        <p className="text-sm">{overview.focus ?? "No focus phrase set."}</p>
        {overview.today_reminders.map((text) => (
          <p key={text} className="text-sm text-content-muted">
            {text}
          </p>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Focus phrases</h2>
        <p className="text-xs text-content-muted">
          One per week, in order, cycling.
        </p>
        <ul>
          {overview.phrases.map((text, index) => (
            <li
              key={`${text}-${index}`}
              className="flex items-start justify-between gap-3 border-b border-line/60 py-2"
            >
              <span className="min-w-0 wrap-break-word text-sm">{text}</span>
              <button
                onClick={() =>
                  void act(() =>
                    invoke("focus_phrase_edit", { index, replacement: null }),
                  )
                }
                className="shrink-0 text-sm text-danger"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        <Add
          value={phrase}
          onChange={setPhrase}
          placeholder="New phrase"
          onAdd={() => {
            if (!phrase.trim()) return;
            void act(() =>
              invoke("focus_phrase_add", { phrase: phrase.trim() }),
            ).then(() => setPhrase(""));
          }}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Day reminders</h2>
        <ul>
          {overview.reminders.map((reminder, index) => (
            <li
              key={`${reminder.day_type}-${reminder.text}-${index}`}
              className="flex items-start justify-between gap-3 border-b border-line/60 py-2"
            >
              <span className="min-w-0 text-sm">
                <span className="block wrap-break-word">{reminder.text}</span>
                <span className="text-xs text-content-muted">
                  {reminder.day_type}
                </span>
              </span>
              <button
                onClick={() =>
                  void act(() =>
                    invoke("day_reminder_edit", { index, replacement: null }),
                  )
                }
                className="shrink-0 text-sm text-danger"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <select
            value={dayType}
            onChange={(e) => setDayType(e.target.value)}
            className="rounded-lg border border-line bg-surface-alt px-2 py-2 text-sm"
          >
            {DAY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <Add
            value={reminderText}
            onChange={setReminderText}
            placeholder="Reminder"
            onAdd={() => {
              if (!reminderText.trim()) return;
              void act(() =>
                invoke("day_reminder_add", {
                  entry: { day_type: dayType, text: reminderText.trim() },
                }),
              ).then(() => setReminderText(""));
            }}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Schedule blocks</h2>
        <ul>
          {overview.blocks.map((block, index) => (
            <li
              key={`${block.from}-${block.to}-${index}`}
              className="flex items-start justify-between gap-3 border-b border-line/60 py-2"
            >
              <span className="min-w-0 text-sm">
                <span className="block wrap-break-word">{block.label}</span>
                <span className="text-xs text-content-muted">
                  {block.from}–{block.to}
                </span>
              </span>
              <button
                onClick={() =>
                  void act(() =>
                    invoke("schedule_block_edit", { index, replacement: null }),
                  )
                }
                className="shrink-0 text-sm text-danger"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="time"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface-alt px-3 py-2"
            />
            <input
              type="time"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface-alt px-3 py-2"
            />
          </div>
          <Add
            value={label}
            onChange={setLabel}
            placeholder="What happens then"
            onAdd={() => {
              if (!from || !to || !label.trim()) return;
              void act(() =>
                invoke("schedule_block_add", {
                  block: { from, to, label: label.trim() },
                }),
              ).then(() => {
                setLabel("");
                setFrom("");
                setTo("");
              });
            }}
          />
        </div>
      </section>
    </div>
  );
}

function Add({
  value,
  onChange,
  placeholder,
  onAdd,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onAdd()}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg border border-line bg-surface-alt px-3 py-2"
      />
      <button
        onClick={onAdd}
        className="shrink-0 rounded-lg border border-line px-4 py-2"
      >
        Add
      </button>
    </div>
  );
}
