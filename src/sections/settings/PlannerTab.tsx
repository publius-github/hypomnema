import { Field, NumberInput, Toggle } from "../../components/form";
import { useAppStore } from "../../store";

export default function PlannerTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
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
          checked={config.notify_system}
          label="System notifications for due tasks"
          hint="A timed task coming due raises an OS notification in addition to the in-app toast, so it is visible when the window is minimized."
          onChange={(v) => void updateConfig({ notify_system: v })}
        />

        <Toggle
          checked={config.cron_weekday_labels}
          label="Weekday marker from cron on tasks"
          hint="Recurring tasks whose cron pins concrete weekdays show a [SAT#1]-style marker before the title (dashboard, calendar and projections)."
          onChange={(v) => void updateConfig({ cron_weekday_labels: v })}
        />

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
  );
}
