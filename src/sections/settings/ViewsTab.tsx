import { Field, NumberInput, Toggle } from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
import type { AppConfig } from "../../types";
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
 * The pages themselves: how much each one shows at a time, and which of
 * them the left bar carries. What sits inside a day or list column is
 * under Columns; what a card looks like is under Task cards.
 */
export default function ViewsTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const move = (index: number, delta: number) => {
    if (!config) return;
    const order = [...config.section_order];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void updateConfig({ section_order: order });
  };
  if (!config) return null;

  return (
    <>
      <SettingsGroup id="views.dashboard">
        {/* the day-column count is set on the dashboard header itself
            (the Days dropdown), where the grid it resizes is visible */}
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

      <SettingsGroup id="views.days">
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

      <SettingsGroup id="views.lists">
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
        <span className="-mt-1 text-xs text-content-muted">
          Folded gives a group one panel slot listing its lists, opened by
          a click. Flat gives every list its own column whatever group it
          is in, with the group&apos;s name as a chip on the column header -
          the same lists, spread out instead of filed away. Applies to the
          dashboard list zone and the Lists page alike, and the Lists page
          header carries the same switch.
        </span>
      </SettingsGroup>

      <SettingsGroup id="views.settings">
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
          This page&apos;s own column. Too narrow and the tab strip above
          wraps onto a second line; widen it until every tab fits.
        </span>
      </SettingsGroup>

      <SettingsGroup id="views.navigation">
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
                  title={
                    hidden ? "Show in the left bar" : "Hide from the left bar"
                  }
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
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-30"
                  disabled={i === config.section_order.length - 1}
                  title="Move down"
                  onClick={() => move(i, 1)}
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
