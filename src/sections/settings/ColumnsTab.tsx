import { Field, NumberInput, Toggle } from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
import { CADENCE_GROUP_LABELS } from "../../lib/tasks";
import type { DoneDisplay } from "../../types";
import { useAppStore } from "../../store";

/**
 * The columns tasks live in. What every column shares comes first - its
 * inside layout, then the closed (postponed/done/dropped) tasks with
 * their plates, folds and order - and then each kind of column on its
 * own, so a question about the Done block is answered in one group.
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
      <SettingsGroup id="columns.sections">
        <span className="text-xs text-content-muted">
          How a column is laid out inside - plates, the lines between
          rows and the bands between blocks. One set for
          every day and list column, so all pages read the same.
        </span>
        <Toggle
          checked={config.row_hairlines}
          label="Hairlines between rows"
          hint="A thin line under every row; off leaves the rows apart by spacing alone."
          onChange={(v) => void updateConfig({ row_hairlines: v })}
        />
        <Toggle
          checked={config.section_plate_count}
          label="Task count on section plates"
          hint="DAILY · 6, or done/total when done tasks stay inline."
          onChange={(v) => void updateConfig({ section_plate_count: v })}
        />
        <Toggle
          checked={config.section_plate_sticky}
          label="Sticky section plates"
          hint="The plate stays at the top of the column while its rows scroll under it."
          onChange={(v) => void updateConfig({ section_plate_sticky: v })}
        />
        <Field label="Section plate height, % of normal (the plate text scales with it)">
          <NumberInput
            value={config.list_view_plate_scale}
            min={100}
            onCommit={(n) =>
              void updateConfig({ list_view_plate_scale: Math.min(400, n) })
            }
          />
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          The Daily/Monthly/Done... plates. 100 = the same plate as on cards;
          200 doubles both the plate and its label.
        </span>
        <Field label="Separator stripe height, % of a row">
          <NumberInput
            value={config.list_gap_stripe}
            min={25}
            onCommit={(n) =>
              void updateConfig({ list_gap_stripe: Math.min(150, n) })
            }
          />
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          Gaps between rows are whole stripes: 1 between category blocks, 2
          between sections and between the Postponed / Done, waiting / Done /
          Dropped blocks, 3 before the first of those blocks.
        </span>
        <Field label="Edge softness, % (0 = hard edges, 100 = fades from the middle line)">
          <NumberInput
            value={config.gap_fill_fade}
            min={0}
            onCommit={(n) =>
              void updateConfig({ gap_fill_fade: Math.min(100, n) })
            }
          />
        </Field>
        <Field label="Inset from the row lines, % of the gap height">
          <NumberInput
            value={config.gap_fill_inset}
            min={0}
            onCommit={(n) =>
              void updateConfig({ gap_fill_inset: Math.min(45, n) })
            }
          />
        </Field>
        <Field label="Opacity, % (100 = solid)">
          <NumberInput
            value={config.gap_fill_opacity}
            min={0}
            onCommit={(n) =>
              void updateConfig({ gap_fill_opacity: Math.min(100, n) })
            }
          />
        </Field>
        <Field label="Maximum band thickness, px">
          <NumberInput
            value={config.gap_fill_max_thickness}
            min={1}
            onCommit={(n) =>
              void updateConfig({ gap_fill_max_thickness: Math.min(64, n) })
            }
          />
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          Empty space the band leaves above and below itself, so it floats in
          the gap instead of touching the lines of the rows around it. 0 = the
          band spans the whole gap. In a tall gap the band stops at the maximum
          thickness and stays centered.
        </span>
      </SettingsGroup>

      <SettingsGroup id="columns.closed">
        <span className="text-xs text-content-muted">
          Postponed, Done, waiting, Done and Not done, dropped tasks in the
          day and list columns: where they go, how they are ordered, how
          loud they stay.
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
          blocks.
        </span>
        {config.done_display === "separate" && (
          <div className="flex flex-col gap-3 pl-6">
            <Toggle
              checked={config.closed_sections_sort_alpha}
              label="Sort Postponed and Done alphabetically"
              hint="The Postponed, Done-waiting and Done blocks order by category, then title. Off = the same order the open tasks use."
              onChange={(v) =>
                void updateConfig({ closed_sections_sort_alpha: v })
              }
            />
            <Field label="Hold before a done/postponed task moves to its block, seconds (0 = immediately)">
              <NumberInput
                value={config.done_hold_seconds}
                min={0}
                onCommit={(n) =>
                  void updateConfig({ done_hold_seconds: Math.min(30, n) })
                }
              />
            </Field>
            <span className="-mt-1 text-xs text-content-muted">
              A short grace period to catch a misclick before the task jumps
              to its block.
            </span>
          </div>
        )}

        <span className="text-sm font-medium">Folded by default</span>
        <span className="-mt-2 text-xs text-content-muted">
          A folded section shows only its plate and count; a click on any
          plate folds or opens it.
        </span>
        <div className="flex flex-col gap-2 pl-6">
          {(
            [
              ["Postponed", "fold_postponed"],
              ["Done, waiting", "fold_waiting"],
              ["Done", "fold_done"],
              ["Not done, dropped", "fold_dropped"],
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config[key]}
                onChange={(e) => void updateConfig({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        <Field label="Closed row opacity, % (the status box stays at full strength)">
          <NumberInput
            value={config.closed_row_opacity}
            min={20}
            onCommit={(n) =>
              void updateConfig({ closed_row_opacity: Math.min(100, n) })
            }
          />
        </Field>
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
      </SettingsGroup>
    </>
  );
}
