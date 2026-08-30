import { ColorPicker, Field, NumberInput, TextInput, Toggle } from "../../components/form";
import { CADENCE_GROUP_LABELS } from "../../lib/tasks";
import { MD_PRESET_LABELS, MD_TOKENS } from "../../lib/mdPresets";
import { THEME_PRESET_LABELS, resolveThemeColors } from "../../lib/themePresets";
import type { AppConfig, DoneDisplay, Theme } from "../../types";
import { useAppStore } from "../../store";

// overridable text colors: [label, config key, dark default, light
// default] - the defaults are the stylesheet values, shown in the
// picker while no override is set
const TEXT_COLOR_ROWS = [
  ["Main text", "content_color", "#e6e9ee", "#171a1f"],
  ["Secondary text", "content_muted_color", "#a8b0bc", "#58606c"],
  ["Weekly focus", "weekly_focus_color", "#6091ff", "#2563eb"],
  ["Day reminders", "reminder_color", "#a8b0bc", "#58606c"],
  ["Day header (weekday, date)", "day_header_color", "#e6e9ee", "#171a1f"],
  ["Weekday marker ([SAT#1])", "dow_label_color", "#a8b0bc", "#58606c"],
] as const;

export default function AppearanceTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const move = (
    key: "section_order" | "cadence_group_order",
    index: number,
    delta: number,
  ) => {
    if (!config) return;
    const order = [...config[key]];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void updateConfig({ [key]: order });
  };
  if (!config) return null;

  return (
    <>

        <Field label="Theme">
          <select
            className="input"
            value={config.theme}
            onChange={(e) =>
              void updateConfig({ theme: e.target.value as Theme })
            }
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </Field>

        <Field label="Theme palette (each has a dark and a light variant)">
          <select
            className="input"
            value={config.theme_preset}
            onChange={(e) =>
              void updateConfig({
                theme_preset: e.target.value as AppConfig["theme_preset"],
              })
            }
          >
            {Object.entries(THEME_PRESET_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <section className="flex flex-col gap-2">
          <span className="text-sm font-medium">Theme colors</span>
          {(
            [
              ["Accent", "accent_color", "accent"],
              ["Background", "surface_color", "surface"],
              ["Panels", "surface_alt_color", "surfaceAlt"],
              ["Borders", "line_color", "line"],
            ] as const
          ).map(([label, key, token]) => {
            const presetColors = resolveThemeColors(config);
            const stylesheet =
              config.theme === "light"
                ? { accent: "#2563eb", surface: "#f4f6f8", surfaceAlt: "#ffffff", line: "#dadfe6" }
                : { accent: "#6091ff", surface: "#121418", surfaceAlt: "#1c1f25", line: "#343942" };
            const fallback = presetColors?.[token] ?? stylesheet[token];
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="w-48 text-xs text-content-muted">{label}</span>
                <ColorPicker
                  value={config[key] || fallback}
                  onChange={(color) => void updateConfig({ [key]: color })}
                />
                {config[key] ? (
                  <button
                    className="text-xs text-content-muted hover:text-content"
                    onClick={() => void updateConfig({ [key]: "" })}
                  >
                    reset to palette default
                  </button>
                ) : (
                  <span className="text-xs text-content-muted">
                    palette default
                  </span>
                )}
              </div>
            );
          })}
        </section>

        <Field label="Done tasks display">
          <select
            className="input"
            value={config.done_display}
            onChange={(e) =>
              void updateConfig({
                done_display: e.target.value as DoneDisplay,
              })
            }
          >
            <option value="inline">Inline with active tasks</option>
            <option value="separate">Separate block per day</option>
          </select>
        </Field>

        <Field label="Hold before a done/postponed task moves to its section, seconds (0 = immediately)">
          <NumberInput
            value={config.done_hold_seconds}
            min={0}
            onCommit={(n) =>
              void updateConfig({ done_hold_seconds: Math.min(30, n) })
            }
          />
        </Field>

        <Field label="UI font (empty = system default)">
          <TextInput
            value={config.ui_font}
            placeholder="e.g. Segoe UI"
            onCommit={(v) => void updateConfig({ ui_font: v })}
          />
        </Field>

        <Field label="Editor font (Journal, Notes, config files)">
          <TextInput
            value={config.editor_font}
            placeholder="Consolas"
            onCommit={(v) => void updateConfig({ editor_font: v })}
          />
        </Field>

        <Field label="Base font size, px (16 = default; every text size scales from it)">
          <NumberInput
            value={config.ui_font_size}
            min={10}
            onCommit={(n) => void updateConfig({ ui_font_size: Math.min(28, n) })}
          />
        </Field>

        <Field label="Editor font size (Journal, Notes, config files; same scale as the base size - equal values match the main text)">
          <NumberInput
            value={config.editor_font_size}
            min={10}
            onCommit={(n) =>
              void updateConfig({ editor_font_size: Math.min(28, n) })
            }
          />
        </Field>

        <section className="flex flex-col gap-2">
          <span className="text-sm font-medium">Text colors</span>
          {TEXT_COLOR_ROWS.map(([label, key, darkHex, lightHex]) => {
            const fallback = config.theme === "light" ? lightHex : darkHex;
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="w-48 text-xs text-content-muted">{label}</span>
                <ColorPicker
                  value={config[key] || fallback}
                  onChange={(color) => void updateConfig({ [key]: color })}
                />
                {config[key] ? (
                  <button
                    className="text-xs text-content-muted hover:text-content"
                    onClick={() => void updateConfig({ [key]: "" })}
                  >
                    reset to theme default
                  </button>
                ) : (
                  <span className="text-xs text-content-muted">
                    theme default
                  </span>
                )}
              </div>
            );
          })}
        </section>

        <section className="flex flex-col gap-2">
          <span className="text-sm font-medium">Markdown colors</span>
          <select
            className="input w-64"
            value={config.md_preset}
            onChange={(e) =>
              void updateConfig({
                md_preset: e.target.value as AppConfig["md_preset"],
              })
            }
          >
            {Object.entries(MD_PRESET_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {config.md_preset === "custom" && (
            <div className="flex flex-col gap-2 pl-6">
              {MD_TOKENS.map(({ key, label }) => {
                const field = `md_color_${key}` as const;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-40 text-xs text-content-muted">
                      {label}
                    </span>
                    <ColorPicker
                      value={config[field]}
                      onChange={(color) => void updateConfig({ [field]: color })}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <span className="text-xs text-content-muted">
            Token colors in the Journal/Notes editor. Custom keeps its own
            seven colors and applies them on both themes.
          </span>
        </section>

        <Toggle
          checked={config.day_header_centered}
          label="Center day headers"
          hint="Weekday and date centered on top of each day column."
          onChange={(v) => void updateConfig({ day_header_centered: v })}
        />

        <Toggle
          checked={config.cadence_colors}
          label="Color tasks by cadence"
          hint="Daily, weekly, monthly, yearly and exact-date tasks get a color stripe on the card (the same stripe a manual task color uses; a manual color wins)."
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
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Category label color</span>
          <ColorPicker
            value={config.category_color}
            onChange={(color) => void updateConfig({ category_color: color })}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Done checkbox color</span>
          <ColorPicker
            value={config.done_color}
            onChange={(color) => void updateConfig({ done_color: color })}
          />
        </div>

        <section className="flex flex-col gap-2">
          <span className="text-sm font-medium">Vertical spacing, px</span>
          <div className="flex flex-wrap gap-4">
            <label className="flex w-40 flex-col gap-1">
              <span className="text-xs text-content-muted">Between tasks</span>
              <NumberInput
                value={config.task_gap}
                min={0}
                onCommit={(n) => void updateConfig({ task_gap: n })}
              />
            </label>
            <label className="flex w-40 flex-col gap-1">
              <span className="text-xs text-content-muted">
                Between sections
              </span>
              <NumberInput
                value={config.section_gap}
                min={0}
                onCommit={(n) => void updateConfig({ section_gap: n })}
              />
            </label>
            <label className="flex w-40 flex-col gap-1">
              <span className="text-xs text-content-muted">
                Between category blocks
              </span>
              <NumberInput
                value={config.category_block_gap}
                min={0}
                onCommit={(n) => void updateConfig({ category_block_gap: n })}
              />
            </label>
          </div>
          <span className="text-xs text-content-muted">
            Sections are the cadence groups plus Postponed and Done;
            category blocks group tasks by their {"{X}"} prefix or list
            inside a section.
          </span>
        </section>

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
                  onClick={() => move("cadence_group_order", i, -1)}
                >
                  ↑
                </button>
                <button
                  className="btn-ghost px-2 py-0.5 text-xs disabled:opacity-30"
                  disabled={i === config.cadence_group_order.length - 1}
                  title="Move down"
                  onClick={() => move("cadence_group_order", i, 1)}
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
