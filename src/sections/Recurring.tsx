import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { DeleteRowButton, EditFormButtons } from "./Upcoming";
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
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Recurring tasks</h1>
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
              className="group cursor-pointer border-b border-line py-3 hover:bg-line/20"
              title="Click to edit"
              onClick={() => setEditing(i)}
            >
              <div className="flex items-center gap-3 text-sm">
                <span className="shrink-0 rounded bg-line/40 px-2 py-0.5 font-mono text-xs">
                  {rule.schedule}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {rule.description || "(no description)"}
                </span>
                <DeleteRowButton
                  onDelete={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(i);
                  }}
                />
              </div>
              <ul className="mt-1 pl-1 text-sm text-content-muted">
                {rule.items.map((item, j) => (
                  <li key={j}>- {item}</li>
                ))}
              </ul>
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

function AddRuleForm({ onWrite }: { onWrite: () => Promise<void> }) {
  const setError = (e: unknown) => useAppStore.setState({ error: String(e) });
  const [mode, setMode] = useState<"simple" | "cron">("simple");
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set([1]));
  const [monthDay, setMonthDay] = useState(1);
  const [cron, setCron] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState("");

  const builtCron = (): string | null => {
    if (mode === "cron") return cron.trim() || null;
    switch (frequency) {
      case "daily":
        return "0 0 * * *";
      case "weekly": {
        if (weekdays.size === 0) return null;
        const days = [...weekdays].sort((a, b) => a - b).join(",");
        return `0 0 * * ${days}`;
      }
      case "monthly":
        return `0 0 ${monthDay} * *`;
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const schedule = builtCron();
    const parsedItems = items
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!schedule || parsedItems.length === 0) return;
    try {
      await invoke("recurring_add", {
        rule: {
          schedule,
          description: description.trim(),
          items: parsedItems,
        },
      });
      setCron("");
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
      <div className="flex gap-1">
        {(["simple", "cron"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${
              mode === m
                ? "bg-accent/15 text-accent"
                : "text-content-muted hover:text-content"
            }`}
            onClick={() => setMode(m)}
          >
            {m === "simple" ? "Simple" : "Cron expression"}
          </button>
        ))}
      </div>

      {mode === "simple" ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-32"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Frequency)}
          >
            <option value="daily">Every day</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          {frequency === "weekly" && (
            <span className="flex gap-1">
              {WEEKDAYS.map((d) => (
                <button
                  key={d.cron}
                  type="button"
                  className={`rounded-md border px-2 py-1 text-xs ${
                    weekdays.has(d.cron)
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line text-content-muted hover:text-content"
                  }`}
                  onClick={() =>
                    setWeekdays((prev) => {
                      const next = new Set(prev);
                      if (next.has(d.cron)) next.delete(d.cron);
                      else next.add(d.cron);
                      return next;
                    })
                  }
                >
                  {d.label}
                </button>
              ))}
            </span>
          )}
          {frequency === "monthly" && (
            <label className="flex items-center gap-1 text-xs text-content-muted">
              on day
              <input
                className="input w-16"
                type="number"
                min={1}
                max={31}
                value={monthDay}
                onChange={(e) =>
                  setMonthDay(
                    Math.min(31, Math.max(1, Number(e.target.value) || 1)),
                  )
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
          value={cron}
          onChange={(e) => setCron(e.target.value)}
        />
      )}

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
  const [schedule, setSchedule] = useState(rule.schedule);
  const [description, setDescription] = useState(rule.description);
  const [items, setItems] = useState(rule.items.join("\n"));

  return (
    <form
      className="flex flex-col gap-2 border-b border-line py-3"
      onSubmit={(e) => {
        e.preventDefault();
        const parsedItems = items
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (!schedule.trim() || parsedItems.length === 0) return;
        onSave({
          schedule: schedule.trim(),
          description: description.trim(),
          items: parsedItems,
        });
      }}
    >
      <div className="flex gap-2">
        <input
          className="input w-40 font-mono"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
        />
        <input
          className="input min-w-0 flex-1"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
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
