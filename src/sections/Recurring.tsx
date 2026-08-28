import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { DeleteRowButton, EditFormButtons } from "../components/rowForms";
import { ConfirmModal } from "../components/dialogs";
import type { ConfigError, RecurringRule } from "../types";

const WEEKDAYS = [
  { cron: 1, label: "Mon" },
  { cron: 2, label: "Tue" },
  { cron: 3, label: "Wed" },
  { cron: 4, label: "Thu" },
  { cron: 5, label: "Fri" },
  { cron: 6, label: "Sat" },
  { cron: 0, label: "Sun" },
];

export default function Recurring() {
  const { runEngine, refresh } = useAppStore();
  const vaultVersion = useAppStore((s) => s.vaultVersion);
  const setError = useCallback(
    (e: unknown) => useAppStore.setState({ error: String(e) }),
    [],
  );
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [fileErrors, setFileErrors] = useState<ConfigError[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await invoke<{
        rules: RecurringRule[];
        errors: ConfigError[];
      }>("recurring_list");
      setRules(result.rules);
      setFileErrors(result.errors);
    } catch (e) {
      setError(e);
    }
  }, [setError]);

  // reload whenever the engine ran (sync button, watcher, YAML edit in
  // Notes), so the list never shows a stale file state
  useEffect(() => {
    void load();
  }, [load, vaultVersion]);

  const afterWrite = async () => {
    await runEngine();
    await refresh();
    await load();
  };

  const remove = async (index: number) => {
    setConfirmDelete(null);
    try {
      await invoke("recurring_edit", { index, replacement: null });
      await afterWrite();
    } catch (e) {
      setError(e);
    }
  };

  const save = async (index: number, replacement: RecurringRule) => {
    try {
      await invoke("recurring_edit", { index, replacement });
      setEditing(null);
      await afterWrite();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-sm text-content-muted">
        Rules from recurring.yml. Each firing of the schedule creates the
        listed items as tasks; a &#123;List&#125; prefix places an item
        into that list.
      </p>

      {fileErrors.length > 0 && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {fileErrors.map((err, i) => (
            <div key={i}>
              {err.line !== null ? `line ${err.line}: ` : ""}
              {err.message}
            </div>
          ))}
        </div>
      )}

      <AddRuleForm onWrite={afterWrite} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rules.length === 0 && (
          <p className="pt-6 text-center text-sm text-content-muted">
            No recurring rules yet. Add one above or edit recurring.yml
            directly (Notes &gt; Config).
          </p>
        )}
        {rules.map((rule, i) =>
          editing === i ? (
            <RuleEditForm
              key={`edit-${i}`}
              rule={rule}
              onCancel={() => setEditing(null)}
              onSave={(replacement) => void save(i, replacement)}
            />
          ) : (
            <div
              key={i}
              className="group flex cursor-pointer items-center gap-2 border-b border-line py-3 hover:bg-line/20"
              title="Click to edit"
              onClick={() => setEditing(i)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 text-sm">
                  <span className="shrink-0 rounded bg-line/40 px-2 py-0.5 font-mono text-xs">
                    {rule.schedule}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {rule.description || "(no description)"}
                  </span>
                </div>
                <ul className="mt-1 pl-1 text-sm text-content-muted">
                  {rule.items.map((item, j) => (
                    <li key={j}>- {item}</li>
                  ))}
                </ul>
              </div>
              <DeleteRowButton
                onDelete={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(i);
                }}
              />
            </div>
          ),
        )}
      </div>
      {confirmDelete !== null && rules[confirmDelete] && (
        <ConfirmModal
          title={`Delete rule "${
            rules[confirmDelete].description ||
            rules[confirmDelete].schedule
          }"?`}
          message="Its not-yet-reached task instances are removed from the grid; today's and past instances stay."
          onConfirm={() => void remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

type Frequency = "daily" | "weekly" | "monthly";

interface BuilderState {
  mode: "simple" | "cron";
  frequency: Frequency;
  weekdays: Set<number>;
  monthDay: number;
  cron: string;
}

/** Maps the simple patterns the builder emits back into Simple mode, so
 * editing a rule created with weekday chips does not confront the user
 * with raw cron; anything else opens in Cron mode. */
function parseSchedule(cron: string): BuilderState {
  const base: BuilderState = {
    mode: "cron",
    frequency: "daily",
    weekdays: new Set([1]),
    monthDay: 1,
    cron,
  };
  const trimmed = cron.trim();
  if (trimmed === "" || trimmed === "0 0 * * *") {
    return { ...base, mode: "simple", frequency: "daily" };
  }
  const weekly = trimmed.match(/^0 0 \* \* ([0-6](?:,[0-6])*)$/);
  if (weekly) {
    return {
      ...base,
      mode: "simple",
      frequency: "weekly",
      weekdays: new Set(weekly[1].split(",").map(Number)),
    };
  }
  const monthly = trimmed.match(/^0 0 ([1-9]|[12]\d|3[01]) \* \*$/);
  if (monthly) {
    return {
      ...base,
      mode: "simple",
      frequency: "monthly",
      monthDay: Number(monthly[1]),
    };
  }
  return base;
}

function buildSchedule(s: BuilderState): string | null {
  if (s.mode === "cron") return s.cron.trim() || null;
  switch (s.frequency) {
    case "daily":
      return "0 0 * * *";
    case "weekly": {
      if (s.weekdays.size === 0) return null;
      const days = [...s.weekdays].sort((a, b) => a - b).join(",");
      return `0 0 * * ${days}`;
    }
    case "monthly":
      return `0 0 ${s.monthDay} * *`;
  }
}

function ScheduleBuilder({
  state,
  onChange,
}: {
  state: BuilderState;
  onChange: (state: BuilderState) => void;
}) {
  return (
    <>
      <div className="flex gap-1">
        {(["simple", "cron"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${
              state.mode === m
                ? "bg-accent/15 text-accent"
                : "text-content-muted hover:text-content"
            }`}
            onClick={() => {
              // switching to cron shows the schedule the simple state
              // builds, so nothing silently changes meaning
              if (m === "cron" && state.mode === "simple") {
                onChange({
                  ...state,
                  mode: m,
                  cron: buildSchedule(state) ?? state.cron,
                });
              } else {
                onChange({ ...state, mode: m });
              }
            }}
          >
            {m === "simple" ? "Simple" : "Cron expression"}
          </button>
        ))}
      </div>

      {state.mode === "simple" ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-32"
            value={state.frequency}
            onChange={(e) =>
              onChange({ ...state, frequency: e.target.value as Frequency })
            }
          >
            <option value="daily">Every day</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          {state.frequency === "weekly" && (
            <span className="flex gap-1">
              {WEEKDAYS.map((d) => (
                <button
                  key={d.cron}
                  type="button"
                  className={`rounded-md border px-2 py-1 text-xs ${
                    state.weekdays.has(d.cron)
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line text-content-muted hover:text-content"
                  }`}
                  onClick={() => {
                    const next = new Set(state.weekdays);
                    if (next.has(d.cron)) next.delete(d.cron);
                    else next.add(d.cron);
                    onChange({ ...state, weekdays: next });
                  }}
                >
                  {d.label}
                </button>
              ))}
            </span>
          )}
          {state.frequency === "monthly" && (
            <label className="flex items-center gap-1 text-xs text-content-muted">
              on day
              <input
                className="input w-16"
                type="number"
                min={1}
                max={31}
                value={state.monthDay}
                onChange={(e) =>
                  onChange({
                    ...state,
                    monthDay: Math.min(
                      31,
                      Math.max(1, Number(e.target.value) || 1),
                    ),
                  })
                }
              />
            </label>
          )}
        </div>
      ) : (
        <input
          className="input w-48 font-mono"
          placeholder="0 0 * * 1-5"
          title="Cron: minute hour day-of-month month day-of-week"
          value={state.cron}
          onChange={(e) => onChange({ ...state, cron: e.target.value })}
        />
      )}
    </>
  );
}

function AddRuleForm({ onWrite }: { onWrite: () => Promise<void> }) {
  const setError = (e: unknown) => useAppStore.setState({ error: String(e) });
  const [schedule, setSchedule] = useState<BuilderState>(() =>
    parseSchedule(""),
  );
  const [description, setDescription] = useState("");
  const [items, setItems] = useState("");

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const cron = buildSchedule(schedule);
    const parsedItems = items
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!cron || parsedItems.length === 0) return;
    try {
      await invoke("recurring_add", {
        rule: {
          schedule: cron,
          description: description.trim(),
          items: parsedItems,
        },
      });
      setSchedule(parseSchedule(""));
      setDescription("");
      setItems("");
      await onWrite();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-line p-3"
      onSubmit={add}
    >
      <ScheduleBuilder state={schedule} onChange={setSchedule} />
      <input
        className="input"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <textarea
        className="input min-h-[64px] resize-y"
        placeholder={"One task per line, e.g.\n{Home} water plants"}
        value={items}
        onChange={(e) => setItems(e.target.value)}
      />
      <button className="btn-primary self-end">
        Add rule
      </button>
    </form>
  );
}

function RuleEditForm({
  rule,
  onSave,
  onCancel,
}: {
  rule: RecurringRule;
  onSave: (replacement: RecurringRule) => void;
  onCancel: () => void;
}) {
  const [schedule, setSchedule] = useState<BuilderState>(() =>
    parseSchedule(rule.schedule),
  );
  const [description, setDescription] = useState(rule.description);
  const [items, setItems] = useState(rule.items.join("\n"));

  return (
    <form
      className="flex flex-col gap-2 border-b border-line py-3"
      onSubmit={(e) => {
        e.preventDefault();
        const cron = buildSchedule(schedule);
        const parsedItems = items
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (!cron || parsedItems.length === 0) return;
        onSave({
          schedule: cron,
          description: description.trim(),
          items: parsedItems,
        });
      }}
    >
      <ScheduleBuilder state={schedule} onChange={setSchedule} />
      <input
        className="input"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <textarea
        className="input min-h-[64px] resize-y"
        value={items}
        onChange={(e) => setItems(e.target.value)}
      />
      <div className="self-end">
        <EditFormButtons onCancel={onCancel} />
      </div>
    </form>
  );
}
