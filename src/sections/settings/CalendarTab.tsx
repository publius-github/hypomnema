import { Field, NumberInput, Toggle } from "../../components/form";
import { useAppStore } from "../../store";

export default function CalendarTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
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

        <p className="pt-2 text-xs text-content-muted">
          The day list on the right of the Calendar.
        </p>
        <Field label="Chip text size, % of the task text">
          <NumberInput
            value={config.calendar_chip_font_scale}
            min={50}
            onCommit={(n) =>
              void updateConfig({ calendar_chip_font_scale: n })
            }
          />
        </Field>
        <Toggle
          checked={config.calendar_category_colors}
          label="Color the category chips"
          hint="Each category gets its own chip color (a list keeps the color it wears on the dashboard), so neighbouring categories are told apart at a glance; off = one neutral chip style."
          onChange={(v) => void updateConfig({ calendar_category_colors: v })}
        />
    </>
  );
}
