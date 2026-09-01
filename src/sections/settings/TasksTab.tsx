import { ColorPicker, Field, NumberInput, Toggle } from "../../components/form";
import type { DoneDisplay } from "../../types";
import { useAppStore } from "../../store";

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="mt-2 border-b border-line pb-1 text-sm font-semibold">
      {children}
    </div>
  );
}

/** Behavior of task cards and list columns. */
export default function TasksTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
    <>
        <SectionTitle>Task cards</SectionTitle>

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

        <Toggle
          checked={config.cron_weekday_labels}
          label="Weekday marker from cron on tasks"
          hint="Recurring tasks whose cron pins concrete weekdays show a [SAT#1]-style marker before the title (dashboard, calendar and projections)."
          onChange={(v) => void updateConfig({ cron_weekday_labels: v })}
        />

        {config.cron_weekday_labels && (
          <div className="pl-6">
            <Toggle
              checked={config.cron_everyday_label}
              label="[EVERYDAY] marker on daily rules"
              hint="Rules free on both day fields (e.g. 0 9 * * *) wear an [EVERYDAY] marker instead of going unlabeled."
              onChange={(v) => void updateConfig({ cron_everyday_label: v })}
            />
          </div>
        )}

        <SectionTitle>Lists</SectionTitle>

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

        <Toggle
          checked={config.lists_page_align_rows}
          label="Align list rows on the Lists page"
          hint="Every list column stretches to its grid row's height, so the rows line up instead of forming a ragged mosaic. Off = each column takes its natural height."
          onChange={(v) => void updateConfig({ lists_page_align_rows: v })}
        />

        <Toggle
          checked={config.clear_done_list_tasks}
          label="Clear done list tasks at day rollover"
          hint="Tasks checked off in a list column are removed from the database once their completion day has passed - the list is a working queue, not history."
          onChange={(v) => void updateConfig({ clear_done_list_tasks: v })}
        />

        <SectionTitle>Dated list tasks</SectionTitle>

        <span className="text-xs text-content-muted">
          A list task with a date also shows on its day column, where it
          always wears the exact-date look. The settings below control how
          loud it is inside its own list before the date arrives.
        </span>

        <Toggle
          checked={config.list_exact_stripe}
          label="Exact-date stripe inside the list"
          hint="On: the card stripe takes the exact-date color in the list too. Off: the list color rules there and only the date chip marks the task."
          onChange={(v) => void updateConfig({ list_exact_stripe: v })}
        />

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            Date chip color inside the list
          </span>
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
    </>
  );
}
