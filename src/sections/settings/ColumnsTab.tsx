import { ColorPicker, Field, NumberInput, Toggle } from "../../components/form";
import SettingsGroup, {
  SettingsSubGroup,
} from "../../components/SettingsGroup";
import { CADENCE_GROUP_LABELS } from "../../lib/tasks";
import type { AppConfig, DoneDisplay } from "../../types";
import { useAppStore } from "../../store";

/** One vertical-rhythm knob, px. */
function Gap({ label, field }: { label: string; field: keyof AppConfig }) {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const value = config?.[field];
  if (typeof value !== "number") return null;
  return (
    <label className="flex w-40 flex-col gap-1">
      <span className="text-xs text-content-muted">{label}</span>
      <NumberInput
        value={value}
        min={0}
        onCommit={(n) => void updateConfig({ [field]: Math.min(400, n) })}
      />
    </label>
  );
}

/**
 * The two kinds of column tasks live in. Each kind owns its own
 * sections, gaps and habits, so "the Done block in my lists sits too
 * high" is answered in one group instead of being split between a
 * spacing table and a color tab; what both share sits above them,
 * named as shared.
 */
export default function ColumnsTab() {
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
      <SettingsGroup id="columns.shared">
        <span className="text-xs text-content-muted">
          Settings the day grid and the custom list columns share. The two
          groups below then tune each kind on its own.
        </span>

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
            <option value="separate">Separate block per column</option>
          </select>
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          Separate gives every column its Postponed, Done-waiting and Done
          blocks - the sections the gaps and plates below refer to.
        </span>

        <SettingsSubGroup id="columns.shared.spacing">
          <div className="flex flex-wrap gap-4">
            <Gap label="Between tasks" field="task_gap" />
            <Gap label="Between sections" field="section_gap" />
          </div>
        </SettingsSubGroup>

        <SettingsSubGroup id="columns.shared.plates">
          {(
            [
              ["Postponed", "postponed_plate_color"],
              ["Done, waiting", "waiting_plate_color"],
              ["Done", "done_plate_color"],
            ] as const
          ).map(([label, key]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-24 text-xs text-content-muted">{label}</span>
              <ColorPicker
                value={config[key] || "#6b7280"}
                onChange={(color) => void updateConfig({ [key]: color })}
              />
              {config[key] ? (
                <button
                  className="text-xs text-content-muted hover:text-content"
                  onClick={() => void updateConfig({ [key]: "" })}
                >
                  reset to neutral
                </button>
              ) : (
                <span className="text-xs text-content-muted">neutral</span>
              )}
            </div>
          ))}
        </SettingsSubGroup>
      </SettingsGroup>

      <SettingsGroup id="columns.day">
        <Toggle
          checked={config.day_header_centered}
          label="Center day headers"
          hint="Weekday and date centered on top of each day column."
          onChange={(v) => void updateConfig({ day_header_centered: v })}
        />

        <Toggle
          checked={config.daily_tasks_today_only}
          label="Show daily tasks only on today"
          hint="Future day columns skip daily-cadence tasks - they repeat every day anyway and only clutter the look-ahead. Past days keep them."
          onChange={(v) => void updateConfig({ daily_tasks_today_only: v })}
        />

        <section className="flex flex-col gap-1">
          <span className="text-sm font-medium">Section order</span>
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

        <SettingsSubGroup id="columns.day.spacing">
          <div className="flex flex-wrap gap-4">
            <Gap label="Category blocks" field="category_block_gap" />
            <Gap label="Before Postponed" field="postponed_section_gap" />
            <Gap label="Before Done, waiting" field="waiting_section_gap" />
            <Gap label="Before Done" field="done_section_gap" />
          </div>
        </SettingsSubGroup>
      </SettingsGroup>

      <SettingsGroup id="columns.list">
        <Toggle
          checked={config.lists_sort_alpha}
          label="Sort lists alphabetically"
          hint="List columns order by name instead of creation order. Favorite lists always come first."
          onChange={(v) => void updateConfig({ lists_sort_alpha: v })}
        />

        <Toggle
          checked={config.list_tasks_sort_alpha}
          label="Sort tasks inside lists alphabetically"
          hint="Backlog tasks in a list column order by title instead of manual drag order; timed tasks still pin to the top."
          onChange={(v) => void updateConfig({ list_tasks_sort_alpha: v })}
        />

        <Toggle
          checked={config.clear_done_list_tasks}
          label="Clear done list tasks at day rollover"
          hint="Tasks checked off in a list column are removed from the database once their completion day has passed - the list is a working queue, not history."
          onChange={(v) => void updateConfig({ clear_done_list_tasks: v })}
        />

        <SettingsSubGroup id="columns.list.spacing">
          <div className="flex flex-wrap gap-4">
            <Gap label="Category blocks" field="list_category_block_gap" />
            <Gap label="Before Postponed" field="list_postponed_section_gap" />
            <Gap
              label="Before Done, waiting"
              field="list_waiting_section_gap"
            />
            <Gap label="Before Done" field="list_done_section_gap" />
          </div>
        </SettingsSubGroup>

        <Field label="Task title lines in a list column (1 = one truncated line)">
          <NumberInput
            value={config.list_task_lines}
            min={1}
            onCommit={(n) =>
              void updateConfig({ list_task_lines: Math.min(10, n) })
            }
          />
        </Field>

        <Field label="Task title lines in the list dialog">
          <NumberInput
            value={config.list_dialog_task_lines}
            min={1}
            onCommit={(n) =>
              void updateConfig({ list_dialog_task_lines: Math.min(10, n) })
            }
          />
        </Field>

        <section className="flex flex-col gap-2">
          <span className="text-sm font-medium">Dated tasks</span>
          <span className="text-xs text-content-muted">
            A list task with a date also shows on its day column, where it
            always wears the exact-date look. These two control how loud it is
            inside its own list before the date arrives.
          </span>

          <Toggle
            checked={config.list_exact_stripe}
            label="Exact-date stripe inside the list"
            hint="On: the card stripe takes the exact-date color in the list too. Off: the list color rules there and only the date chip marks the task."
            onChange={(v) => void updateConfig({ list_exact_stripe: v })}
          />

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Date chip color</span>
            <ColorPicker
              value={config.list_date_chip_color || config.cadence_color_exact}
              onChange={(color) =>
                void updateConfig({ list_date_chip_color: color })
              }
            />
            {config.list_date_chip_color ? (
              <button
                className="text-xs text-content-muted hover:text-content"
                onClick={() => void updateConfig({ list_date_chip_color: "" })}
              >
                reset to exact-date color
              </button>
            ) : (
              <span className="text-xs text-content-muted">
                exact-date color
              </span>
            )}
          </div>
        </section>
      </SettingsGroup>
    </>
  );
}
