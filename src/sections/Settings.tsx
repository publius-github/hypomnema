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

const TABS = [
  { id: "appearance", label: "Appearance" },
  { id: "planner", label: "Planner" },
  { id: "calendar", label: "Calendar" },
  { id: "navigation", label: "Navigation" },
  { id: "files", label: "Files" },
  { id: "maintenance", label: "Maintenance" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function Settings() {
  const { vaultPath, config, updateConfig } = useAppStore();
  const [tab, setTab] = useState<Tab>("appearance");

  if (!config) return null;

  const moveSection = (index: number, delta: number) => {
    const order = [...config.section_order];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void updateConfig({ section_order: order });
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 p-6">
      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t.id
                ? "border-b-2 border-accent text-accent"
                : "text-content-muted hover:text-content"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-10">
      {tab === "appearance" && (
        <>
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

        <Field label="Hold before a done/postponed task moves to its section, seconds (0 = immediately)">
          <NumberInput
            value={config.done_hold_seconds}
            min={0}
            onCommit={(n) =>
              void updateConfig({ done_hold_seconds: Math.min(30, n) })
            }
          />
        </Field>

        <Field label="UI font (empty = system default)">
          <TextInput
            value={config.ui_font}
            placeholder="e.g. Segoe UI"
            onCommit={(v) => void updateConfig({ ui_font: v })}
          />
        </Field>

        <Field label="Editor font (Journal, Notes, config files)">
          <TextInput
            value={config.editor_font}
            placeholder="Consolas"
            onCommit={(v) => void updateConfig({ editor_font: v })}
          />
        </Field>

        <Toggle
          checked={config.day_header_centered}
          label="Center day headers"
          hint="Weekday and date centered on top of each day column."
          onChange={(v) => void updateConfig({ day_header_centered: v })}
        />

        <Toggle
          checked={config.cadence_colors}
          label="Color tasks by cadence"
          hint="Daily, weekly, monthly, yearly and exact-date tasks get a color stripe on the card (the same stripe a manual task color uses; a manual color wins)."
          onChange={(v) => void updateConfig({ cadence_colors: v })}
        />
        {config.cadence_colors && (
          <div className="flex flex-wrap gap-4 pl-6">
            {(
              [
                ["Daily", "cadence_color_daily"],
                ["Weekly", "cadence_color_weekly"],
                ["Monthly", "cadence_color_monthly"],
                ["Yearly", "cadence_color_yearly"],
                ["Exact date", "cadence_color_exact"],
              ] as const
            ).map(([label, key]) => (
              <label key={key} className="flex items-center gap-1.5 text-xs">
                <input
                  type="color"
                  className="h-6 w-8 cursor-pointer rounded border border-line bg-transparent"
                  value={config[key]}
                  onChange={(e) =>
                    void updateConfig({ [key]: e.target.value })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        )}

        <Toggle
          checked={config.cadence_group_gap}
          label="Extra spacing between cadence groups"
          hint="A wider gap before each group header in the day columns."
          onChange={(v) => void updateConfig({ cadence_group_gap: v })}
        />
        </>
      )}

      {tab === "planner" && (
        <>
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

        <Field label="List columns visible in the bottom zone">
          <select
            className="input"
            value={config.list_columns}
            onChange={(e) =>
              void updateConfig({ list_columns: Number(e.target.value) })
            }
          >
            {[1, 2, 3, 4, 5, 6, 8].map((n) => (
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
            checked={config.dashboard_today_only}
            onChange={(e) =>
              void updateConfig({ dashboard_today_only: e.target.checked })
            }
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">
              Dashboard shows only today
            </span>
            <span className="text-xs text-content-muted">
              A single Today column with its to-do list instead of the week
              grid. Also toggled right on the dashboard.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={config.daily_tasks_today_only}
            onChange={(e) =>
              void updateConfig({ daily_tasks_today_only: e.target.checked })
            }
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">
              Show daily tasks only on today
            </span>
            <span className="text-xs text-content-muted">
              Future day columns skip daily-cadence tasks - they repeat
              every day anyway and only clutter the look-ahead. Past days
              keep them.
            </span>
          </span>
        </label>

        <Toggle
          checked={config.subtasks_done_last}
          label="Done subtasks sink to the bottom"
          hint="Checked subtasks move below the open ones in the card and the task dialog."
          onChange={(v) => void updateConfig({ subtasks_done_last: v })}
        />

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
        </>
      )}

      {tab === "calendar" && (
        <>
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
        </>
      )}

      {tab === "navigation" && (
        <>
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
        </>
      )}

      {tab === "files" && (
        <>
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
          <p className="text-xs text-content-muted">
            The template for new journal entries lives in
            config/journal-template.md.
          </p>
          <button
            className="btn-ghost w-fit px-3 py-1 text-xs"
            onClick={() =>
              useAppStore.getState().openConfigFile("journal-template.md")
            }
          >
            Edit in Notes
          </button>
        </section>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={config.kb_line_numbers}
            onChange={(e) =>
              void updateConfig({ kb_line_numbers: e.target.checked })
            }
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">
              Line numbers in the Notes editor
            </span>
            <span className="text-xs text-content-muted">
              Config files always show them; this turns them on for notes
              too.
            </span>
          </span>
        </label>

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
        </>
      )}

      {tab === "maintenance" && <MaintenanceSection />}
      </div>
    </div>
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

function Toggle({
  checked,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-content-muted">{hint}</span>
      </span>
    </label>
  );
}

/** Text setting committed on blur/Enter, like NumberInput. */
function TextInput({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  return (
    <input
      className="input"
      placeholder={placeholder}
      value={editing ? draft : value}
      onFocus={() => {
        setDraft(value);
        setEditing(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const trimmed = draft.trim();
        if (trimmed !== value) onCommit(trimmed);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
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
    <section className="flex flex-col gap-2">
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
