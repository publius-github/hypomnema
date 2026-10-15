import { Field, NumberInput, Toggle } from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
import { useAppStore } from "../../store";

/**
 * The recurring machinery end to end: how a rule is bucketed, how far
 * back generation catches up, and how far ahead the Calendar shows
 * firings that are not tasks yet. The buckets drive both, which is why
 * they sit on one tab.
 */
export default function RecurringTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
    <>
      <SettingsGroup id="recurring.buckets">
        <section className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            Minimum firings per year
          </span>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["Daily", "cadence_daily_min_per_year", "183 = every 1-2 days"],
                ["Weekly", "cadence_weekly_min_per_year", "37 = up to ~10 days apart"],
                ["Monthly", "cadence_monthly_min_per_year", "4 = up to a quarter apart"],
              ] as const
            ).map(([label, key, hint]) => (
              <label key={key} className="flex w-44 flex-col gap-1">
                <span className="text-xs text-content-muted">
                  {label} ({hint})
                </span>
                <NumberInput
                  value={config[key]}
                  min={1}
                  onCommit={(n) => void updateConfig({ [key]: n })}
                />
              </label>
            ))}
          </div>
          <span className="text-xs text-content-muted">
            A recurring rule lands in the bucket whose threshold its yearly
            firing count reaches; below Monthly it counts as yearly. The
            buckets drive the day-column sections, the cadence colors and
            the projection horizons below.
          </span>
        </section>
      </SettingsGroup>

      <SettingsGroup id="recurring.generation">
        <Field label="Recurring catch-up window, days">
          <NumberInput
            value={config.catchup_days}
            min={1}
            onCommit={(n) => void updateConfig({ catchup_days: n })}
          />
        </Field>

        <Toggle
          checked={config.cron_ignore_time}
          label="Catch up recurring crons by calendar day"
          hint="The firing time is ignored: a rule like 0 0 * * 1 counts as missed for the whole Monday, as if it fired at 23:59."
          onChange={(v) => void updateConfig({ cron_ignore_time: v })}
        />
      </SettingsGroup>

      <SettingsGroup id="recurring.calendar">
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
          The chips in the Calendar day list follow the app-wide chip size
          and category colors (Settings &gt; Task cards).
        </p>
      </SettingsGroup>
    </>
  );
}
