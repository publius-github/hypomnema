import { Field, NumberInput, Toggle } from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
import { useAppStore } from "../../store";
import ColorRow from "./ColorRow";

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
 * The pages themselves: which of them the left bar carries, and what
 * each page shows beyond its columns. Column counts and view modes sit
 * on the page headers; what is inside a day or list column is under
 * Columns; what a card looks like is under Task cards.
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
      <SettingsGroup id="views.navigation">
        <span className="text-xs text-content-muted">
          Order of the pages in the left bar, and which of them it shows at
          all - an app half of whose features you never open should not spend a
          rail on them. Settings always stays.
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
      <SettingsGroup id="views.dashboard">
        {/* column counts, the group shape and the today-only switches
            are set on the page headers themselves, where the grid they
            reshape is visible; a second copy here would only invite the
            two to disagree */}
        <Field label="Dashboard split: day grid height, % (also draggable on the dashboard)">
          <NumberInput
            value={config.dashboard_split}
            min={20}
            onCommit={(n) =>
              void updateConfig({ dashboard_split: Math.min(80, n) })
            }
          />
        </Field>
        <ColorRow
          label="Weekly focus phrase"
          field="weekly_focus_color"
          dark="#3794ff"
          light="#005fb8"
        />
      </SettingsGroup>

      <SettingsGroup id="views.lists">
        <Toggle
          checked={config.lists_page_align_rows}
          label="Align list rows on the Lists page"
          hint="Every list column stretches to its grid row's height, so the rows line up instead of forming a ragged mosaic. Off = each column takes its natural height."
          onChange={(v) => void updateConfig({ lists_page_align_rows: v })}
        />
      </SettingsGroup>

      <SettingsGroup id="views.history">
        <Field label="Marks per daily streak (0 = hide the strip)">
          <NumberInput
            value={config.streak_strip_days}
            min={0}
            onCommit={(n) =>
              void updateConfig({ streak_strip_days: Math.min(180, n) })
            }
          />
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          Each daily streak in History carries a strip of its newest
          instances, one mark per day.
        </span>
      </SettingsGroup>
    </>
  );
}
