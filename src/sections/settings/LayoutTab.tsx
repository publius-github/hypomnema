import { Field, NumberInput, Toggle } from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
import { CADENCE_GROUP_LABELS } from "../../lib/tasks";
import type { AppConfig, DoneDisplay } from "../../types";
import { useAppStore } from "../../store";

const SECTION_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  lists: "Lists",
  days: "Days",
  upcoming: "Upcoming",
  reminders: "Reminders",
  calendar: "Calendar",
  history: "History",
  review: "Review",
  journal: "Journal",
  kb: "Notes",
};

/**
 * Layout of the three task views (Dashboard, Days, Lists), the day
 * columns, spacing/density, and the section order in the left bar.
 * What the cards and lists do is under Tasks & Lists; how they are
 * colored is under Appearance.
 */
export default function LayoutTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const move = (
    key: "section_order" | "cadence_group_order",
    index: number,
    delta: number,
  ) => {
    if (!config) return;
    const order = [...config[key]];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void updateConfig({ [key]: order });
  };
  if (!config) return null;

  return (
    <>
      <SettingsGroup
        title="Dashboard"
        keys={[
          "grid_columns",
          "dashboard_today_only",
          "list_columns",
          "dashboard_split",
        ]}
      >
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

        <Toggle
          checked={config.dashboard_today_only}
          label="Dashboard shows only today"
          hint="A single Today column with its to-do list instead of the week grid. Also toggled right on the dashboard."
          onChange={(v) => void updateConfig({ dashboard_today_only: v })}
        />

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
      </SettingsGroup>

      <SettingsGroup
        title="Days page"
        keys={["days_today_only", "days_page_columns"]}
      >
        <Toggle
          checked={config.days_today_only}
          label="Days page shows only today"
          hint="Independent from the dashboard toggle. Also toggled right on the Days page."
          onChange={(v) => void updateConfig({ days_today_only: v })}
        />

        <Field label="Day columns on the Days page">
          <select
            className="input"
            value={config.days_page_columns}
            onChange={(e) =>
              void updateConfig({ days_page_columns: Number(e.target.value) })
            }
          >
            {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      </SettingsGroup>

      <SettingsGroup
        title="Lists page"
        keys={["lists_page_columns", "lists_page_align_rows"]}
      >
        <Field label="Grid columns on the Lists page">
          <select
            className="input"
            value={config.lists_page_columns}
            onChange={(e) =>
              void updateConfig({ lists_page_columns: Number(e.target.value) })
            }
          >
            {[1, 2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>

        <Toggle
          checked={config.lists_page_align_rows}
          label="Align list rows on the Lists page"
          hint="Every list column stretches to its grid row's height, so the rows line up instead of forming a ragged mosaic. Off = each column takes its natural height."
          onChange={(v) => void updateConfig({ lists_page_align_rows: v })}
        />
      </SettingsGroup>

      <SettingsGroup title="List groups" keys={["lists_group_display"]}>
        <Field label="Grouped lists in the list panels">
          <select
            className="input"
            value={config.lists_group_display}
            onChange={(e) =>
              void updateConfig({
                lists_group_display: e.target
                  .value as AppConfig["lists_group_display"],
              })
            }
          >
            <option value="folded">Folded: one tile per group</option>
            <option value="flat">Flat: every list its own column</option>
          </select>
        </Field>
        <span className="text-xs text-content-muted">
          Folded gives a group one panel slot listing its lists, opened by
          a click. Flat gives every list its own column whatever group it
          is in, with the group's name as a chip on the column header - the
          same lists, spread out instead of filed away. Applies to the
          dashboard list zone and the Lists page alike.
        </span>
      </SettingsGroup>

      <SettingsGroup title="Settings page" keys={["settings_width"]}>
        <Field label="Settings content width, px (0 = the whole window)">
          <NumberInput
            value={config.settings_width}
            min={0}
            onCommit={(n) =>
              void updateConfig({
                settings_width: n === 0 ? 0 : Math.min(4000, Math.max(480, n)),
              })
            }
          />
        </Field>
        <span className="text-xs text-content-muted">
          This page's own column. Too narrow and the tab strip above wraps
          onto a second line; widen it until every tab fits.
        </span>
      </SettingsGroup>

      <SettingsGroup
        title="Day columns"
        keys={[
          "day_header_centered",
          "daily_tasks_today_only",
          "done_display",
          "cadence_group_order",
        ]}
      >
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

        <section className="flex flex-col gap-1">
          <span className="text-sm font-medium">Day column sections</span>
          <span className="text-xs text-content-muted">
            Order of the sections inside a day column.
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
                  onClick={() => move("cadence_group_order", i, -1)}
                >
                  ↑
                </button>
                <button
                  className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-30"
                  disabled={i === config.cadence_group_order.length - 1}
                  title="Move down"
                  onClick={() => move("cadence_group_order", i, 1)}
                >
                  ↓
                </button>
              </div>
            ))}
          </div>
        </section>
      </SettingsGroup>

      <SettingsGroup
        title="Spacing & density"
        keys={[
          "task_gap",
          "section_gap",
          "category_block_gap",
          "list_category_block_gap",
          "postponed_section_gap",
          "done_section_gap",
          "list_postponed_section_gap",
          "list_done_section_gap",
          "waiting_section_gap",
          "list_waiting_section_gap",
          "list_task_lines",
          "list_dialog_task_lines",
        ]}
      >
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-4">
            <label className="flex w-40 flex-col gap-1">
              <span className="text-xs text-content-muted">Between tasks</span>
              <NumberInput
                value={config.task_gap}
                min={0}
                onCommit={(n) => void updateConfig({ task_gap: n })}
              />
            </label>
            <label className="flex w-40 flex-col gap-1">
              <span className="text-xs text-content-muted">
                Between sections
              </span>
              <NumberInput
                value={config.section_gap}
                min={0}
                onCommit={(n) => void updateConfig({ section_gap: n })}
              />
            </label>
            <label className="flex w-40 flex-col gap-1">
              <span className="text-xs text-content-muted">
                Category blocks (days)
              </span>
              <NumberInput
                value={config.category_block_gap}
                min={0}
                onCommit={(n) => void updateConfig({ category_block_gap: n })}
              />
            </label>
            <label className="flex w-40 flex-col gap-1">
              <span className="text-xs text-content-muted">
                Category blocks (lists)
              </span>
              <NumberInput
                value={config.list_category_block_gap}
                min={0}
                onCommit={(n) =>
                  void updateConfig({ list_category_block_gap: n })
                }
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["Before Postponed (days)", "postponed_section_gap"],
                ["Before Done, waiting (days)", "waiting_section_gap"],
                ["Before Done (days)", "done_section_gap"],
                ["Before Postponed (lists)", "list_postponed_section_gap"],
                ["Before Done, waiting (lists)", "list_waiting_section_gap"],
                ["Before Done (lists)", "list_done_section_gap"],
              ] as const
            ).map(([label, key]) => (
              <label key={key} className="flex w-40 flex-col gap-1">
                <span className="text-xs text-content-muted">{label}</span>
                <NumberInput
                  value={config[key]}
                  min={0}
                  onCommit={(n) =>
                    void updateConfig({ [key]: Math.min(400, n) })
                  }
                />
              </label>
            ))}
          </div>
          <span className="text-xs text-content-muted">
            Sections are the cadence groups; the Postponed, Waiting and Done blocks
            take their own gaps, separately for the day columns and the
            custom list columns, so they can sit visibly lower. Category
            blocks group tasks by their {"{X}"} prefix or list inside a
            section - in the day columns and, with its own gap, in the
            custom list columns and the list dialog. All values in px.
          </span>
        </section>

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

      <SettingsGroup
        title="Section order"
        keys={["section_order", "section_hidden"]}
      >
        <span className="text-xs text-content-muted">
          Order of the sections in the left bar, and which of them it
          shows at all - an app half of whose features you never open
          should not spend a rail on them. Settings always stays.
        </span>
        <div className="flex flex-col gap-1">
          {config.section_order.map((id, i) => {
            const hidden = config.section_hidden.includes(id);
            return (
            <div
              key={id}
              className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm"
            >
              <span
                className={`min-w-0 flex-1 ${hidden ? "text-content-muted line-through" : ""}`}
              >
                {SECTION_LABELS[id] ?? id}
              </span>
              <button
                className="btn-ghost px-2 py-0.5 text-xs"
                title={hidden ? "Show in the left bar" : "Hide from the left bar"}
                onClick={() =>
                  void updateConfig({
                    section_hidden: hidden
                      ? config.section_hidden.filter((s) => s !== id)
                      : [...config.section_hidden, id],
                  })
                }
              >
                {hidden ? "Hidden" : "Shown"}
              </button>
              <button
                className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-30"
                disabled={i === 0}
                title="Move up"
                onClick={() => move("section_order", i, -1)}
              >
                ↑
              </button>
              <button
                className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-30"
                disabled={i === config.section_order.length - 1}
                title="Move down"
                onClick={() => move("section_order", i, 1)}
              >
                ↓
              </button>
            </div>
            );
          })}
        </div>
      </SettingsGroup>
    </>
  );
}
