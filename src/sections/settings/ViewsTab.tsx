import { ColorPicker, Field, NumberInput, Toggle } from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
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
      </SettingsGroup>

      <SettingsGroup id="views.lists">
        <Toggle
          checked={config.lists_page_align_rows}
          label="Align list rows on the Lists page"
          hint="Every list column stretches to its grid row's height, so the rows line up instead of forming a ragged mosaic. Off = each column takes its natural height."
          onChange={(v) => void updateConfig({ lists_page_align_rows: v })}
        />
      </SettingsGroup>

      <SettingsGroup id="views.listview">
        <span className="text-xs text-content-muted">
          The look of the List view, shared by the Days and Lists pages: one set
          of numbers, so both pages read the same.
        </span>
        <Toggle
          checked={config.section_cards}
          label="Sections as framed panels"
          hint="Each section (Daily, Weekly, Done...) is a framed panel with one rail in its color down the left edge; the breaks between sections are plain space instead of stripes, and a row's stripe in the section's own color is left to the rail."
          onChange={(v) => void updateConfig({ section_cards: v })}
        />
        {config.section_cards && (
          <div className="flex flex-col gap-3 pl-6">
            <Field label="Space between section panels, px">
              <NumberInput
                value={config.section_gap}
                min={0}
                onCommit={(n) =>
                  void updateConfig({ section_gap: Math.min(64, n) })
                }
              />
            </Field>
            <Toggle
              checked={config.category_gap_bands}
              label="Bands in category breaks"
              hint="Off = the break between two category blocks inside a section is empty space of the same height."
              onChange={(v) => void updateConfig({ category_gap_bands: v })}
            />
          </div>
        )}
        <Toggle
          checked={config.row_hairlines}
          label="Hairlines between rows"
          hint="A thin line under every row; off leaves the rows apart by spacing alone."
          onChange={(v) => void updateConfig({ row_hairlines: v })}
        />
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
        <Toggle
          checked={config.section_plate_count}
          label="Task count on section plates"
          hint="DAILY · 6, or done/total when done tasks stay inline."
          onChange={(v) => void updateConfig({ section_plate_count: v })}
        />
        <Toggle
          checked={config.section_plate_sticky}
          label="Sticky section plates"
          hint="The plate stays at the top of the column while its rows scroll under it."
          onChange={(v) => void updateConfig({ section_plate_sticky: v })}
        />
        <span className="text-sm font-medium">Folded by default</span>
        <span className="-mt-2 text-xs text-content-muted">
          A folded section shows only its plate and count; a click on any
          plate folds or opens it.
        </span>
        <div className="flex flex-col gap-2 pl-6">
          {(
            [
              ["Postponed", "fold_postponed"],
              ["Done, waiting", "fold_waiting"],
              ["Done", "fold_done"],
              ["Not done, dropped", "fold_dropped"],
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config[key]}
                onChange={(e) => void updateConfig({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        <Field label="Closed row opacity, % (the status box stays at full strength)">
          <NumberInput
            value={config.closed_row_opacity}
            min={20}
            onCommit={(n) =>
              void updateConfig({ closed_row_opacity: Math.min(100, n) })
            }
          />
        </Field>
        <Field label="Section plate height, % of normal (the plate text scales with it)">
          <NumberInput
            value={config.list_view_plate_scale}
            min={100}
            onCommit={(n) =>
              void updateConfig({ list_view_plate_scale: Math.min(400, n) })
            }
          />
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          The Daily/Monthly/Done... plates. 100 = the same plate as on cards;
          200 doubles both the plate and its label.
        </span>
        <Field label="Separator stripe height, % of a row">
          <NumberInput
            value={config.list_gap_stripe}
            min={25}
            onCommit={(n) =>
              void updateConfig({ list_gap_stripe: Math.min(150, n) })
            }
          />
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          Gaps between rows are whole stripes: 1 between category blocks, 2
          between sections, 3 before Postponed / Done, waiting / Done / Dropped.
        </span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Gap fill color</span>
          <ColorPicker
            value={
              config.gap_fill_color ||
              (config.theme === "light" ? "#e0e0e0" : "#3c3c3c")
            }
            onChange={(color) => void updateConfig({ gap_fill_color: color })}
          />
          {config.gap_fill_color ? (
            <button
              className="text-xs text-content-muted hover:text-content"
              onClick={() => void updateConfig({ gap_fill_color: "" })}
            >
              reset to border color
            </button>
          ) : (
            <span className="text-xs text-content-muted">border color</span>
          )}
        </div>
        <Field label="Edge softness, % (0 = hard edges, 100 = fades from the middle line)">
          <NumberInput
            value={config.gap_fill_fade}
            min={0}
            onCommit={(n) =>
              void updateConfig({ gap_fill_fade: Math.min(100, n) })
            }
          />
        </Field>
        <Field label="Inset from the row lines, % of the gap height">
          <NumberInput
            value={config.gap_fill_inset}
            min={0}
            onCommit={(n) =>
              void updateConfig({ gap_fill_inset: Math.min(45, n) })
            }
          />
        </Field>
        <Field label="Opacity, % (100 = solid)">
          <NumberInput
            value={config.gap_fill_opacity}
            min={0}
            onCommit={(n) =>
              void updateConfig({ gap_fill_opacity: Math.min(100, n) })
            }
          />
        </Field>
        <Field label="Maximum band thickness, px">
          <NumberInput
            value={config.gap_fill_max_thickness}
            min={1}
            onCommit={(n) =>
              void updateConfig({ gap_fill_max_thickness: Math.min(64, n) })
            }
          />
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          Empty space the band leaves above and below itself, so it floats in
          the gap instead of touching the lines of the rows around it. 0 = the
          band spans the whole gap. In a tall gap the band stops at the maximum
          thickness and stays centered.
        </span>
      </SettingsGroup>

      <SettingsGroup id="views.navigation">
        <span className="text-xs text-content-muted">
          Order of the sections in the left bar, and which of them it shows at
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
    </>
  );
}
