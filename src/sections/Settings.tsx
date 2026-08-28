import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store";
import { ConfirmModal } from "../components/dialogs";
import type { DoneDisplay, List, Theme } from "../types";

const SECTION_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  upcoming: "Upcoming",
  calendar: "Calendar",
  journal: "Journal",
  kb: "Notes",
};

export default function Settings() {
  const { vaultPath, config, updateConfig } = useAppStore();

  if (!config) return null;

  const moveSection = (index: number, delta: number) => {
    const order = [...config.section_order];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void updateConfig({ section_order: order });
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-8 pb-16">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Group title="Appearance">
        <Field label="Theme">
          <select
            className="input"
            value={config.theme}
            onChange={(e) =>
              void updateConfig({ theme: e.target.value as Theme })
            }
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </Field>

        <Field label="Done tasks display">
          <select
            className="input"
            value={config.done_display}
            onChange={(e) =>
              void updateConfig({
                done_display: e.target.value as DoneDisplay,
              })
            }
          >
            <option value="inline">Inline with active tasks</option>
            <option value="separate">Separate block per day</option>
          </select>
        </Field>
      </Group>

      <Group title="Planner">
        <Field label="Week grid columns (today + following days)">
          <select
            className="input"
            value={config.grid_columns}
            onChange={(e) =>
              void updateConfig({ grid_columns: Number(e.target.value) })
            }
          >
            {[2, 3, 5, 7, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Dashboard split: day grid height, % (also draggable on the dashboard)">
          <NumberInput
            value={config.dashboard_split}
            min={20}
            onCommit={(n) =>
              void updateConfig({ dashboard_split: Math.min(80, n) })
            }
          />
        </Field>

        <Field label="Retention of done one-off tasks, days (0 = keep forever)">
          <NumberInput
            value={config.retention_days}
            min={0}
            onCommit={(n) => void updateConfig({ retention_days: n })}
          />
        </Field>

        <Field label="Recurring catch-up window, days">
          <NumberInput
            value={config.catchup_days}
            min={1}
            onCommit={(n) => void updateConfig({ catchup_days: n })}
          />
        </Field>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={config.cron_ignore_time}
            onChange={(e) =>
              void updateConfig({ cron_ignore_time: e.target.checked })
            }
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">
              Catch up recurring crons by calendar day
            </span>
            <span className="text-xs text-content-muted">
              The firing time is ignored: a rule like 0 0 * * 1 counts as
              missed for the whole Monday, as if it fired at 23:59.
            </span>
          </span>
        </label>
      </Group>

      <Group title="Calendar outlook">
        <p className="text-xs text-content-muted">
          How far ahead the Calendar projects rules that have not become
          tasks yet, by rule frequency. Projected entries are previews;
          tasks are still generated only for the grid window.
        </p>
        <Field label="Daily rules, days ahead">
          <NumberInput
            value={config.calendar_daily_days}
            min={0}
            onCommit={(n) => void updateConfig({ calendar_daily_days: n })}
          />
        </Field>
        <Field label="Weekly rules, weeks ahead">
          <NumberInput
            value={config.calendar_weekly_weeks}
            min={0}
            onCommit={(n) => void updateConfig({ calendar_weekly_weeks: n })}
          />
        </Field>
        <Field label="Monthly rules, months ahead">
          <NumberInput
            value={config.calendar_monthly_months}
            min={0}
            onCommit={(n) => void updateConfig({ calendar_monthly_months: n })}
          />
        </Field>
        <Field label="Yearly rules, years ahead">
          <NumberInput
            value={config.calendar_yearly_years}
            min={0}
            onCommit={(n) => void updateConfig({ calendar_yearly_years: n })}
          />
        </Field>
        <Field label="Exact dates and birthdays, years ahead">
          <NumberInput
            value={config.calendar_dates_years}
            min={0}
            onCommit={(n) => void updateConfig({ calendar_dates_years: n })}
          />
        </Field>
      </Group>

      <Group title="Navigation">
        <span className="text-xs text-content-muted">
          Order of the sections in the left bar.
        </span>
        <div className="flex flex-col gap-1">
          {config.section_order.map((id, i) => (
            <div
              key={id}
              className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1">
                {SECTION_LABELS[id] ?? id}
              </span>
              <button
                className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-30"
                disabled={i === 0}
                title="Move up"
                onClick={() => moveSection(i, -1)}
              >
                ↑
              </button>
              <button
                className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-30"
                disabled={i === config.section_order.length - 1}
                title="Move down"
                onClick={() => moveSection(i, 1)}
              >
                ↓
              </button>
            </div>
          ))}
        </div>
      </Group>

      <Group title="Files">
        <section className="flex flex-col gap-1">
          <span className="text-sm font-medium">Vault</span>
          <span className="select-text text-sm text-content-muted">
            {vaultPath}
          </span>
        </section>

        <section className="flex flex-col gap-1">
          <span className="text-sm font-medium">Notes folder</span>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 select-text truncate text-sm text-content-muted">
              {config.kb_path || "Not set"}
            </span>
            <button
              className="btn-ghost px-3 py-1 text-xs"
              onClick={async () => {
                const path = await open({
                  directory: true,
                  title: "Select KB folder",
                });
                if (typeof path === "string") {
                  await updateConfig({ kb_path: path });
                }
              }}
            >
              Change
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-1">
          <span className="text-sm font-medium">Journal template</span>
          <button
            className="btn-ghost w-fit px-3 py-1 text-xs"
            onClick={() => useAppStore.getState().setSection("journal")}
          >
            Edit in Journal
          </button>
        </section>

        <section className="flex flex-col gap-1">
          <span className="text-sm font-medium">Config files</span>
          <p className="text-xs text-content-muted">
            recurring.yml, scheduled.yml and the other config files are
            edited in Notes under the Config group, with validation on save.
            Quick links to the files without a form UI:
          </p>
          <div className="flex flex-wrap gap-2">
            {["weekly-focus.yml", "day-reminders.yml", "day-schedule.yml"].map(
              (file) => (
                <button
                  key={file}
                  className="btn-ghost px-3 py-1 text-xs"
                  onClick={() => useAppStore.getState().openConfigFile(file)}
                >
                  {file}
                </button>
              ),
            )}
            <button
              className="btn-ghost px-3 py-1 text-xs"
              onClick={() => useAppStore.getState().setSection("kb")}
            >
              All in Notes
            </button>
          </div>
        </section>
      </Group>

      <MaintenanceSection />
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-content-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Commits on blur/Enter only. Retention drives a hard, non-undoable
 * prune on the Rust side, and the config watcher applies a saved value
 * within half a second - committing per keystroke would prune against
 * the "3" of a half-typed "30".
 */
function NumberInput({
  value,
  min,
  onCommit,
}: {
  value: number;
  min: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const n = Math.max(min, Number(draft) || 0);
    if (n !== value) onCommit(n);
  };

  return (
    <input
      className="input"
      type="number"
      min={min}
      value={editing ? draft : String(value)}
      onFocus={() => {
        setDraft(String(value));
        setEditing(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function MaintenanceSection() {
  const [status, setStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [archived, setArchived] = useState<List[]>([]);

  const loadArchived = useCallback(async () => {
    try {
      setArchived(await invoke<List[]>("lists_archived"));
    } catch (e) {
      useAppStore.setState({ error: String(e) });
    }
  }, []);

  useEffect(() => {
    void loadArchived();
  }, [loadArchived]);

  const deleteDone = async () => {
    setConfirming(false);
    try {
      const deleted = await invoke<number>("tasks_delete_done");
      setStatus(`Deleted ${deleted} done task(s)`);
      await useAppStore.getState().refresh();
    } catch (e) {
      useAppStore.setState({ error: String(e) });
    }
  };

  const restore = async (id: number) => {
    try {
      await invoke("list_unarchive", { id });
      await loadArchived();
      await useAppStore.getState().refresh();
    } catch (e) {
      useAppStore.setState({ error: String(e) });
    }
  };

  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-content-muted">
        Maintenance
      </h2>
      <div className="flex items-center gap-2">
        <button
          className="btn-danger w-fit px-3 py-1 text-xs"
          onClick={() => setConfirming(true)}
        >
          Delete all done tasks
        </button>
        {status && (
          <span className="text-xs text-content-muted">{status}</span>
        )}
      </div>
      {archived.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-content-muted">Archived lists</span>
          {archived.map((list) => (
            <div key={list.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{list.name}</span>
              <button
                className="btn-ghost px-2 py-0.5 text-xs"
                onClick={() => void restore(list.id)}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
      {confirming && (
        <ConfirmModal
          title="Delete every task marked done?"
          message="This cannot be undone."
          onConfirm={() => void deleteDone()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
