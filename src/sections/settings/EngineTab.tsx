import { Field, NumberInput, Toggle } from "../../components/form";
import { useAppStore } from "../../store";

/** Generation engine: cadence buckets, catch-up, retention. */
export default function EngineTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
    <>
        <section className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            Cadence buckets: minimum firings per year
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
            buckets drive day-column grouping, cadence colors and the
            calendar outlook horizons.
          </span>
        </section>

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

        <Field label="Retention of done one-off tasks, days (0 = keep forever)">
          <NumberInput
            value={config.retention_days}
            min={0}
            onCommit={(n) => void updateConfig({ retention_days: n })}
          />
        </Field>
    </>
  );
}
