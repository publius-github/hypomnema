import { Field, NumberInput } from "../../components/form";
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
    </>
  );
}
