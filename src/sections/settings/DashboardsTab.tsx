import { Field, NumberInput, Toggle } from "../../components/form";
import { CADENCE_GROUP_LABELS } from "../../lib/tasks";
import { useAppStore } from "../../store";

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="mt-2 border-b border-line pb-1 text-sm font-semibold">
      {children}
    </div>
  );
}

/**
 * Layout of the three task views: the combined Dashboard, the Days page
 * and the Lists page. What the columns contain is under Tasks & Lists.
 */
export default function DashboardsTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const moveGroup = (index: number, delta: number) => {
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
        <SectionTitle>Dashboard</SectionTitle>

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

        <SectionTitle>Days page</SectionTitle>

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

        <SectionTitle>Lists page</SectionTitle>

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

        <SectionTitle>Day columns</SectionTitle>

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
                  onClick={() => moveGroup(i, -1)}
                >
                  ↑
                </button>
                <button
                  className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-30"
                  disabled={i === config.cadence_group_order.length - 1}
                  title="Move down"
                  onClick={() => moveGroup(i, 1)}
                >
                  ↓
                </button>
              </div>
            ))}
          </div>
        </section>
    </>
  );
}
