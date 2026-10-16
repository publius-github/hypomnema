import { Field, NumberInput, Toggle } from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
import { useAppStore } from "../../store";

/**
 * The task card itself, wherever it shows up: the chips, category
 * headers and markers it wears, its completion-rate chip and
 * what it does when acted on. The column a card sits in - including
 * the Postponed/Done blocks it lands in - is under Columns.
 */
export default function TaskCardsTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
    <>
      <SettingsGroup id="cards.chips">
        <Toggle
          checked={config.category_headers}
          label="Category as a block header"
          hint="A category block names its category once over its rows instead of a chip on every row."
          onChange={(v) => void updateConfig({ category_headers: v })}
        />
        {config.category_headers && (
          <div className="pl-6">
            <Toggle
              checked={config.category_header_bold}
              label="Bold category header"
              hint="The header reads in bold at the task text size, apart from the titles under it; off = a small medium-weight label."
              onChange={(v) => void updateConfig({ category_header_bold: v })}
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
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup id="cards.rate">
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
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup id="cards.behavior">
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
