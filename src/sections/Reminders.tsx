import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import { currentAndNextBlock } from "../lib/tasks";
import { ConfirmModal } from "../components/dialogs";
import { DeleteRowButton, EditFormButtons } from "../components/rowForms";
import type { DayReminder, RemindersOverview, ScheduleBlock } from "../types";
import { pressable } from "../lib/a11y";

type SubTab = "focus" | "reminders" | "schedule";

// day-reminders.yml day_type values, in the order the picker offers
// them; the Rust side validates against the same list.
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

const DAY_TYPE_LABELS: Record<string, string> = {
  workday: "Every workday",
  weekend: "Every weekend day",
  mon: "Mondays",
  tue: "Tuesdays",
  wed: "Wednesdays",
  thu: "Thursdays",
  fri: "Fridays",
  sat: "Saturdays",
  sun: "Sundays",
};

const EMPTY: RemindersOverview = {
  focus: null,
  rotation: "cycle",
  phrases: [],
  reminders: [],
  blocks: [],
  today: "",
  today_reminders: [],
  errors: [],
};

/**
 * The three "ambient" config files that have no other UI: the weekly
 * focus phrases, the per-day-type reminders shown in the day columns,
 * and the day-schedule blocks behind the Now/Next line. Each row edits
 * the YAML in place (comment-preserving splice), same as Upcoming does
 * for the task configs.
 */
export default function Reminders() {
  const vaultVersion = useAppStore((s) => s.vaultVersion);
  const setError = useCallback(
    (e: unknown) => useAppStore.getState().setError(errorMessage(e)),
    [],
  );
  const [tab, setTab] = useState<SubTab>("focus");
  const [data, setData] = useState<RemindersOverview>(EMPTY);

  const load = useCallback(async () => {
    try {
      setData(await invoke("reminders_overview"));
    } catch (e) {
      setError(e);
    }
  }, [setError]);

  useEffect(() => {
    void load();
  }, [load, vaultVersion]);

  // the watcher on config/ re-runs the engine and bumps vaultVersion,
  // which reloads through the effect above; an explicit load() here
  // would only race with it
  const afterWrite = async () => {
    const store = useAppStore.getState();
    await store.runEngine();
    await store.refresh();
    await load();
  };

  const now = currentAndNextBlock(data.blocks, new Date());

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 p-6">
      <div className="flex gap-1 border-b border-line">
        {(
          [
            ["focus", "Weekly focus"],
            ["reminders", "Day reminders"],
            ["schedule", "Day schedule"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`px-4 py-2 text-sm font-medium ${
              tab === id
                ? "border-b-2 border-accent text-accent"
                : "text-content-muted hover:text-content"
            }`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {data.errors.length > 0 && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {data.errors.map((err, i) => (
            <div key={i}>
              {err.file}
              {err.line !== null ? ` line ${err.line}` : ""}: {err.message}
            </div>
          ))}
        </div>
      )}

      {/* what the three files actually produce right now - the section
          is otherwise a list of rules with no visible effect */}
      <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface-alt px-3 py-2 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-content-muted">
          Right now
        </span>
        <span>
          <span className="text-content-muted">Focus: </span>
          {data.focus ?? <span className="text-content-muted">none</span>}
        </span>
        <span>
          <span className="text-content-muted">Today ({data.today}): </span>
          {data.today_reminders.length > 0 ? (
            data.today_reminders.join(" · ")
          ) : (
            <span className="text-content-muted">no reminders</span>
          )}
        </span>
        <span>
          <span className="text-content-muted">Block: </span>
          {now?.current
            ? `${now.current.label} until ${now.current.to}`
            : "none"}
          {now?.next ? ` · next ${now.next.label} at ${now.next.from}` : ""}
        </span>
      </div>

      {tab === "focus" && (
        <FocusTab
          phrases={data.phrases}
          rotation={data.rotation}
          current={data.focus}
          onWrite={afterWrite}
        />
      )}
      {tab === "reminders" && (
        <DayRemindersTab reminders={data.reminders} onWrite={afterWrite} />
      )}
      {tab === "schedule" && (
        <ScheduleTab blocks={data.blocks} onWrite={afterWrite} />
      )}
    </div>
  );
}

/**
 * Writes one change to a config file and reloads the overview, sending
 * a failure to the error banner - the one way every tab here writes.
 */
function useConfigWrite(onWrite: () => Promise<void>) {
  return async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await onWrite();
    } catch (e) {
      useAppStore.getState().setError(errorMessage(e));
    }
  };
}

/**
 * The rows of one config file: each opens its editor on click (or Enter
 * on its text), deletes behind a confirmation, and shows `empty` when
 * there is nothing. A row's own buttons keep it from being a button
 * itself, so the keyboard stop is its text (`pressable`, `lib/a11y.ts`).
 */
function RowListEditor<T>({
  items,
  rowKey,
  empty,
  lead,
  text,
  trail,
  editor,
  deleteLabel,
  onDelete,
}: {
  items: T[];
  rowKey: (item: T, index: number) => string;
  empty: ReactNode;
  lead: (item: T, index: number) => ReactNode;
  text: (item: T) => ReactNode;
  trail?: (item: T) => ReactNode;
  /** the row's edit form; `close` puts the row back. `item` is the row
   *  as it was when the editor opened - the `original` an edit sends,
   *  so a reload under the open form cannot redirect it */
  editor: (item: T, index: number, close: () => void) => ReactNode;
  deleteLabel: (item: T) => string;
  onDelete: (index: number, item: T) => void;
}) {
  const [editing, setEditing] = useState<{ index: number; item: T } | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState<{
    index: number;
    item: T;
  } | null>(null);
  const close = () => setEditing(null);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 && (
          <p className="pt-6 text-center text-sm text-content-muted">{empty}</p>
        )}
        {items.map((item, i) =>
          editing?.index === i ? (
            <Fragment key={`edit-${i}`}>
              {editor(editing.item, i, close)}
            </Fragment>
          ) : (
            <div
              key={rowKey(item, i)}
              className="group flex cursor-pointer items-center gap-3 border-b border-line py-2 text-sm hover:bg-line/20"
              title="Click to edit"
              role="presentation"
              onClick={() => setEditing({ index: i, item })}
            >
              {lead(item, i)}
              <span
                className="min-w-0 flex-1 wrap-break-word"
                {...pressable(() => setEditing({ index: i, item }), {
                  click: false,
                })}
              >
                {text(item)}
              </span>
              {trail?.(item)}
              <DeleteRowButton
                onDelete={(e) => {
                  e.stopPropagation();
                  setConfirmDelete({ index: i, item });
                }}
              />
            </div>
          ),
        )}
      </div>
      {confirmDelete !== null && (
        <ConfirmModal
          title={`Delete "${deleteLabel(confirmDelete.item)}"?`}
          onConfirm={() => {
            const { index, item } = confirmDelete;
            setConfirmDelete(null);
            onDelete(index, item);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}

function FocusTab({
  phrases,
  rotation,
  current,
  onWrite,
}: {
  phrases: string[];
  rotation: string;
  current: string | null;
  onWrite: () => Promise<void>;
}) {
  const write = useConfigWrite(onWrite);
  const [phrase, setPhrase] = useState("");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-xs text-content-muted">
        One phrase per ISO week, in file order ({rotation} rotation). The
        week's phrase is pinned once assigned, so editing the list never
        changes the phrase mid-week.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!phrase.trim()) return;
          void write(async () => {
            await invoke("focus_phrase_add", { phrase: phrase.trim() });
            setPhrase("");
          });
        }}
      >
        <input
          className="input min-w-0 flex-1"
          placeholder="Focus phrase for a week"
          required
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
        <button className="btn-primary py-0">Add</button>
      </form>
      <RowListEditor
        items={phrases}
        rowKey={(text, i) => `${text}-${i}`}
        empty="No phrases yet. With none, the dashboard simply shows no focus line."
        lead={(_, i) => (
          <span className="w-8 shrink-0 font-mono text-content-muted">{i + 1}</span>
        )}
        text={(text) => text}
        trail={(text) =>
          text === current && (
            <span className="shrink-0 rounded-sm bg-accent/15 px-1.5 py-0.5 text-[0.6875rem] text-accent">
              this week
            </span>
          )
        }
        editor={(text, i, close) => (
          <PhraseEditRow
            text={text}
            onCancel={close}
            onSave={(replacement) =>
              void write(async () => {
                await invoke("focus_phrase_edit", {
                  index: i,
                  original: text,
                  replacement,
                });
                close();
              })
            }
          />
        )}
        deleteLabel={(text) => text}
        onDelete={(index, text) =>
          void write(() =>
            invoke("focus_phrase_edit", {
              index,
              original: text,
              replacement: null,
            }),
          )
        }
      />
    </div>
  );
}

function PhraseEditRow({
  text,
  onSave,
  onCancel,
}: {
  text: string;
  onSave: (replacement: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(text);
  return (
    <form
      className="flex items-center gap-2 border-b border-line py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.trim()) return;
        onSave(draft.trim());
      }}
    >
      <input
        className="input min-w-0 flex-1"
        required
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <EditFormButtons onCancel={onCancel} />
    </form>
  );
}

function DayRemindersTab({
  reminders,
  onWrite,
}: {
  reminders: DayReminder[];
  onWrite: () => Promise<void>;
}) {
  const write = useConfigWrite(onWrite);
  const [dayType, setDayType] = useState("workday");
  const [text, setText] = useState("");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-xs text-content-muted">
        A line shown under the header of every matching day column.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void write(async () => {
            await invoke("day_reminder_add", {
              entry: { day_type: dayType, text: text.trim() },
            });
            setText("");
          });
        }}
      >
        <DayTypeSelect value={dayType} onChange={setDayType} />
        <input
          className="input min-w-0 flex-1"
          placeholder="Reminder text"
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn-primary py-0">Add</button>
      </form>
      <RowListEditor
        items={reminders}
        rowKey={(entry, i) => `${entry.day_type}-${entry.text}-${i}`}
        empty="No day reminders yet."
        lead={(entry) => (
          <span className="w-36 shrink-0 text-content-muted">
            {DAY_TYPE_LABELS[entry.day_type] ?? entry.day_type}
          </span>
        )}
        text={(entry) => entry.text}
        editor={(entry, i, close) => (
          <ReminderEditRow
            entry={entry}
            onCancel={close}
            onSave={(replacement) =>
              void write(async () => {
                await invoke("day_reminder_edit", {
                  index: i,
                  original: entry,
                  replacement,
                });
                close();
              })
            }
          />
        )}
        deleteLabel={(entry) => entry.text}
        onDelete={(index, entry) =>
          void write(() =>
            invoke("day_reminder_edit", {
              index,
              original: entry,
              replacement: null,
            }),
          )
        }
      />
    </div>
  );
}

function DayTypeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="input w-40 shrink-0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {DAY_TYPES.map((type) => (
        <option key={type} value={type}>
          {DAY_TYPE_LABELS[type]}
        </option>
      ))}
    </select>
  );
}

function ReminderEditRow({
  entry,
  onSave,
  onCancel,
}: {
  entry: DayReminder;
  onSave: (replacement: DayReminder) => void;
  onCancel: () => void;
}) {
  const [dayType, setDayType] = useState(entry.day_type);
  const [text, setText] = useState(entry.text);

  return (
    <form
      className="flex items-center gap-2 border-b border-line py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onSave({ day_type: dayType, text: text.trim() });
      }}
    >
      <DayTypeSelect value={dayType} onChange={setDayType} />
      <input
        className="input min-w-0 flex-1"
        required
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <EditFormButtons onCancel={onCancel} />
    </form>
  );
}

function ScheduleTab({
  blocks,
  onWrite,
}: {
  blocks: ScheduleBlock[];
  onWrite: () => Promise<void>;
}) {
  const write = useConfigWrite(onWrite);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-xs text-content-muted">
        Named time blocks of a typical day. Today&apos;s column shows the
        block covering the current time and the one after it. A block whose
        end is before its start spans midnight.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!from || !to || !label.trim()) return;
          void write(async () => {
            await invoke("schedule_block_add", {
              block: { from, to, label: label.trim() },
            });
            setFrom("");
            setTo("");
            setLabel("");
          });
        }}
      >
        <input
          className="input"
          type="time"
          aria-label="From"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          className="input"
          type="time"
          aria-label="To"
          required
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <input
          className="input min-w-0 flex-1"
          placeholder="Block label, e.g. Deep work"
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button className="btn-primary py-0">Add</button>
      </form>
      <RowListEditor
        items={blocks}
        rowKey={(block, i) => `${block.from}-${block.label}-${i}`}
        empty="No blocks yet."
        lead={(block) => (
          <span className="w-28 shrink-0 font-mono text-content-muted">
            {block.from}-{block.to}
          </span>
        )}
        text={(block) => block.label}
        editor={(block, i, close) => (
          <BlockEditRow
            block={block}
            onCancel={close}
            onSave={(replacement) =>
              void write(async () => {
                await invoke("schedule_block_edit", {
                  index: i,
                  original: block,
                  replacement,
                });
                close();
              })
            }
          />
        )}
        deleteLabel={(block) => block.label}
        onDelete={(index, block) =>
          void write(() =>
            invoke("schedule_block_edit", {
              index,
              original: block,
              replacement: null,
            }),
          )
        }
      />
    </div>
  );
}

function BlockEditRow({
  block,
  onSave,
  onCancel,
}: {
  block: ScheduleBlock;
  onSave: (replacement: ScheduleBlock) => void;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState(block.from);
  const [to, setTo] = useState(block.to);
  const [label, setLabel] = useState(block.label);

  return (
    <form
      className="flex items-center gap-2 border-b border-line py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!from || !to || !label.trim()) return;
        onSave({ from, to, label: label.trim() });
      }}
    >
      <input
        className="input"
        type="time"
        required
        value={from}
        onChange={(e) => setFrom(e.target.value)}
      />
      <input
        className="input"
        type="time"
        required
        value={to}
        onChange={(e) => setTo(e.target.value)}
      />
      <input
        className="input min-w-0 flex-1"
        required
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <EditFormButtons onCancel={onCancel} />
    </form>
  );
}
