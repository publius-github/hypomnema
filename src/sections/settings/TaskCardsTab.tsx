import {
  ColorPicker,
  Field,
  NumberInput,
  Toggle,
} from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
import type { AppConfig } from "../../types";
import { useAppStore } from "../../store";

/**
 * The task card itself, wherever it shows up: its colors, the chips and
 * markers it wears, and what it does when checked off. The column a
 * card sits in is under Columns.
 */
export default function TaskCardsTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
    <>
      <SettingsGroup id="cards.colors">
        <Toggle
          checked={config.cadence_colors}
          label="Color tasks by cadence"
          hint="Daily, weekly, monthly, yearly and exact-date tasks get a color stripe on the card (the same stripe a manual task color uses; a manual color wins). The same palette colors the section plates inside a column."
          onChange={(v) => void updateConfig({ cadence_colors: v })}
        />
        {config.cadence_colors && (
          <div className="flex flex-col gap-2 pl-6">
            {(
              [
                ["Daily", "cadence_color_daily"],
                ["Weekly", "cadence_color_weekly"],
                ["Monthly", "cadence_color_monthly"],
                ["Yearly", "cadence_color_yearly"],
                ["Exact date", "cadence_color_exact"],
              ] as const
            ).map(([label, key]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-24 text-xs text-content-muted">
                  {label}
                </span>
                <ColorPicker
                  value={config[key]}
                  onChange={(color) => void updateConfig({ [key]: color })}
                />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="w-24 text-xs text-content-muted">General</span>
              <ColorPicker
                value={config.cadence_color_general || "#6b7280"}
                onChange={(color) =>
                  void updateConfig({ cadence_color_general: color })
                }
              />
              {config.cadence_color_general ? (
                <button
                  className="text-xs text-content-muted hover:text-content"
                  onClick={() => void updateConfig({ cadence_color_general: "" })}
                >
                  reset to neutral
                </button>
              ) : (
                <span className="text-xs text-content-muted">
                  neutral - manual tasks carry no cadence
                </span>
              )}
            </div>
          </div>
        )}

        {/* the closed sections are not a cadence, so their plates keep
            their own colors whether cadence coloring is on or not */}
        <section className="flex flex-col gap-2">
          <span className="text-sm font-medium">Closed section plates</span>
          <span className="-mt-1 text-xs text-content-muted">
            The Postponed, Done-waiting, Done and Not-done-dropped headers of
            a day or list column (Separate done display), each in a color of
            its own.
          </span>
          <div className="flex flex-col gap-2 pl-6">
            {(
              [
                ["Postponed", "postponed_plate_color"],
                ["Done, waiting", "waiting_plate_color"],
                ["Done", "done_plate_color"],
                ["Dropped", "dropped_plate_color"],
              ] as const
            ).map(([label, key]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-24 text-xs text-content-muted">
                  {label}
                </span>
                <ColorPicker
                  value={config[key]}
                  onChange={(color) => void updateConfig({ [key]: color })}
                />
              </div>
            ))}
          </div>
        </section>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Done checkbox color</span>
          <ColorPicker
            value={config.done_color}
            onChange={(color) => void updateConfig({ done_color: color })}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Done, waiting mark color</span>
          <ColorPicker
            value={config.waiting_color}
            onChange={(color) => void updateConfig({ waiting_color: color })}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Not done, dropped mark color</span>
          <ColorPicker
            value={config.dropped_color}
            onChange={(color) => void updateConfig({ dropped_color: color })}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup id="cards.chips">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Category label color</span>
          <ColorPicker
            value={config.category_color}
            onChange={(color) => void updateConfig({ category_color: color })}
          />
          <span className="text-xs text-content-muted">
            Used when the mode below is &quot;One color for all&quot;.
          </span>
        </div>
        <Field label="Category chip colors">
          <select
            className="input"
            value={config.category_color_mode}
            onChange={(e) =>
              void updateConfig({
                category_color_mode: e.target
                  .value as AppConfig["category_color_mode"],
              })
            }
          >
            <option value="single">One color for all (above)</option>
            <option value="varied">A color per category</option>
            <option value="alternate">Alternate between two colors</option>
          </select>
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          {config.category_color_mode === "varied"
            ? "Each category takes its own hue: a list keeps the color of its own column, any other {Category} gets a palette color picked from its name."
            : config.category_color_mode === "alternate"
              ? "The two colors below take turns, one category block after the next, running down a whole column - the turn carries on across the Daily/Weekly/Monthly sections and into Postponed and Done instead of restarting."
              : "Every category label wears the single color above."}
        </span>
        {config.category_color_mode === "varied" && (
          <Toggle
            checked={config.category_avoid_cadence_colors}
            label="Avoid the cadence colors"
            hint="A palette color close to one of the cadence colors (the Weekly/Monthly/... plates) is skipped, so a chip never blends into the section it sits under. A list's own hand-picked color is kept either way."
            onChange={(v) =>
              void updateConfig({ category_avoid_cadence_colors: v })
            }
          />
        )}
        {config.category_color_mode === "alternate" && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Alternating colors</span>
            <ColorPicker
              value={config.category_color_a}
              onChange={(color) =>
                void updateConfig({ category_color_a: color })
              }
            />
            <ColorPicker
              value={config.category_color_b}
              onChange={(color) =>
                void updateConfig({ category_color_b: color })
              }
            />
          </div>
        )}
        <Field label="Chip text size, % of the text beside it">
          <NumberInput
            value={config.chip_font_scale}
            min={50}
            onCommit={(n) => void updateConfig({ chip_font_scale: n })}
          />
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          The category, list and date chips on the task cards and in the
          Calendar day list. 100 = exactly the size of the task text.
        </span>
      </SettingsGroup>

      <SettingsGroup id="cards.markers">
        <Toggle
          checked={config.cron_weekday_labels}
          label="Weekday marker from cron on tasks"
          hint="Recurring tasks whose cron pins concrete weekdays show a [SAT#1]-style marker before the title (dashboard, calendar and projections)."
          onChange={(v) => void updateConfig({ cron_weekday_labels: v })}
        />

        {config.cron_weekday_labels && (
          <div className="flex flex-col gap-3 pl-6">
            <Toggle
              checked={config.cron_everyday_label}
              label="[EVERYDAY] marker on daily rules"
              hint="Rules free on both day fields (e.g. 0 9 * * *) wear an [EVERYDAY] marker instead of going unlabeled."
              onChange={(v) => void updateConfig({ cron_everyday_label: v })}
            />
            <Field label="Marker opacity, % (default color only; a picked color shows as picked)">
              <NumberInput
                value={config.dow_label_opacity}
                min={20}
                onCommit={(n) =>
                  void updateConfig({ dow_label_opacity: Math.min(100, n) })
                }
              />
            </Field>
          </div>
        )}

        <Toggle
          checked={config.habit_rate_chip}
          label="Completion rate chip on recurring tasks"
          hint="A Rate: 82% chip next to the priority and overdue marks: how many of the item's recent instances were done. Done and waiting count as done; dropped and a missed daily count as not done."
          onChange={(v) => void updateConfig({ habit_rate_chip: v })}
        />

        {config.habit_rate_chip && (
          <div className="flex flex-col gap-3 pl-6">
            <Toggle
              checked={config.habit_rate_alert_only}
              label="Only when below the threshold"
              hint="A healthy rate is noise on every row; the chip appears once the rate drops under its alert threshold."
              onChange={(v) => void updateConfig({ habit_rate_alert_only: v })}
            />
            <Field label="Alert below, % (a rule's own threshold in recurring.yml wins)">
              <NumberInput
                value={config.habit_rate_threshold}
                min={0}
                onCommit={(n) =>
                  void updateConfig({ habit_rate_threshold: Math.min(100, n) })
                }
              />
            </Field>

            <Field label="Count the last N instances (0 = all history)">
              <NumberInput
                value={config.habit_rate_window}
                min={0}
                onCommit={(n) =>
                  void updateConfig({ habit_rate_window: Math.min(3650, n) })
                }
              />
            </Field>

            <Field label="Show the rate after at least N instances">
              <NumberInput
                value={config.habit_rate_min_instances}
                min={1}
                onCommit={(n) =>
                  void updateConfig({
                    habit_rate_min_instances: Math.min(365, n),
                  })
                }
              />
            </Field>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Alert chip color</span>
              <ColorPicker
                value={config.habit_rate_alert_color}
                onChange={(color) =>
                  void updateConfig({ habit_rate_alert_color: color })
                }
              />
            </div>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup id="cards.behavior">
        <Field label="Hold before a done/postponed task moves to its section, seconds (0 = immediately)">
          <NumberInput
            value={config.done_hold_seconds}
            min={0}
            onCommit={(n) =>
              void updateConfig({ done_hold_seconds: Math.min(30, n) })
            }
          />
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          Only matters while Done tasks show as a separate block (Columns
          &gt; Day and list columns).
        </span>

        <Field label="Undo toast after deleting a task or archiving a list, seconds (0 = no undo offer)">
          <NumberInput
            value={config.undo_toast_seconds}
            min={0}
            onCommit={(n) =>
              void updateConfig({ undo_toast_seconds: Math.min(30, n) })
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
      </SettingsGroup>
    </>
  );
}
