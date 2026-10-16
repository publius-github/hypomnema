import { Field, NumberInput, Toggle } from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
import { CADENCE_GROUP_LABELS } from "../../lib/tasks";
import type { AppConfig, DoneDisplay } from "../../types";
import { useAppStore } from "../../store";

/**
 * Tasks as they sit on the pages: what a card says about itself, then
 * how the day and list columns group and order them. The look of the
 * columns (spacing, plates, opacity) is fine-tuning in app.yml, not a
 * choice to make here.
 */
export default function TasksTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const moveCadence = (index: number, delta: number) => {
    if (!config) return;
    const order = [...config.cadence_group_order];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void updateConfig({ cadence_group_order: order });
  };
  if (!config) return null;

  return (
    <>
      <SettingsGroup id="tasks.cards">
        <Toggle
          checked={config.category_headers}
          label="Category as a block header"
          hint="A category block names its category once, in bold over its rows, instead of a chip on every row."
          onChange={(v) => void updateConfig({ category_headers: v })}
        />
        <Toggle
          checked={config.cron_weekday_labels}
          label="Weekday markers"
          hint="Recurring tasks whose cron pins weekdays show a [SAT#1]-style marker before the title, and rules that fire every day show [EVERYDAY]."
          onChange={(v) => void updateConfig({ cron_weekday_labels: v })}
        />
        <Field label="Completion rate chip on recurring tasks">
          <select
            className="input"
            value={config.habit_rate_display}
            onChange={(e) =>
              void updateConfig({
                habit_rate_display: e.target
                  .value as AppConfig["habit_rate_display"],
              })
            }
          >
            <option value="off">Off</option>
            <option value="alert">Only below the alert threshold</option>
            <option value="always">Always</option>
          </select>
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          A Rate: 82% chip - how many of the item&apos;s recent instances
          were done. Done and waiting count as done; dropped and a missed
          daily count as not done.
        </span>
        {config.habit_rate_display !== "off" && (
          <div className="pl-6">
            <Field label="Alert below, % (a rule's own threshold in recurring.yml wins)">
              <NumberInput
                value={config.habit_rate_threshold}
                min={0}
                onCommit={(n) =>
                  void updateConfig({ habit_rate_threshold: Math.min(100, n) })
                }
              />
            </Field>
          </div>
        )}
        <Toggle
          checked={config.subtasks_done_last}
          label="Done subtasks sink to the bottom"
          hint="Checked subtasks move below the open ones in the card and the task dialog."
          onChange={(v) => void updateConfig({ subtasks_done_last: v })}
        />
        <Toggle
          checked={config.priority_overdue}
          label="Priority tasks get the overdue mark"
          hint="A starred task left unfinished past its day is marked OVERDUE like any other task; off = it carries over silently."
          onChange={(v) => void updateConfig({ priority_overdue: v })}
        />
      </SettingsGroup>

      <SettingsGroup id="tasks.columns">
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
            <option value="separate">Separate blocks per column</option>
          </select>
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          Separate gives every column its Postponed, Done, waiting, Done and
          Not done, dropped blocks; a click on a block&apos;s plate folds it,
          and the app remembers.
        </span>
        {config.done_display === "separate" && (
          <div className="pl-6">
            <Toggle
              checked={config.closed_sections_sort_alpha}
              label="Sort Postponed and Done alphabetically"
              hint="The closed blocks order by category, then title. Off = the same order the open tasks use."
              onChange={(v) =>
                void updateConfig({ closed_sections_sort_alpha: v })
              }
            />
          </div>
        )}

        <section className="flex flex-col gap-1">
          <span className="text-sm font-medium">Day column section order</span>
          <span className="text-xs text-content-muted">
            Order of the cadence sections inside a day column.
          </span>
          <div className="flex flex-col gap-1">
            {config.cadence_group_order.map((id, i) => (
              <div
                key={id}
                className="flex items-center gap-2 rounded-md border border-line px-3 py-1 text-sm"
              >
                <span className="min-w-0 flex-1">
                  {CADENCE_GROUP_LABELS[id] ?? id}
                </span>
                <button
                  className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-30"
                  disabled={i === 0}
                  title="Move up"
                  onClick={() => moveCadence(i, -1)}
                >
                  ↑
                </button>
                <button
                  className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-30"
                  disabled={i === config.cadence_group_order.length - 1}
                  title="Move down"
                  onClick={() => moveCadence(i, 1)}
                >
                  ↓
                </button>
              </div>
            ))}
          </div>
        </section>

        <Toggle
          checked={config.daily_tasks_today_only}
          label="Show daily tasks only on today"
          hint="Future day columns skip daily-cadence tasks - they repeat every day anyway and only clutter the look-ahead. Past days keep them."
          onChange={(v) => void updateConfig({ daily_tasks_today_only: v })}
        />
        <Toggle
          checked={config.lists_sort_alpha}
          label="Sort lists and their tasks alphabetically"
          hint="List columns order by name (favorites still first) and the tasks inside them by title (timed tasks still on top). Off = creation and drag order."
          onChange={(v) => void updateConfig({ lists_sort_alpha: v })}
        />
        <Field label="Task title lines in a list column (1 = one truncated line)">
          <NumberInput
            value={config.list_task_lines}
            min={1}
            onCommit={(n) =>
              void updateConfig({ list_task_lines: Math.min(10, n) })
            }
          />
        </Field>
      </SettingsGroup>
    </>
  );
}
