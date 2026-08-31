import { ColorPicker, Field, NumberInput, TextInput, Toggle } from "../../components/form";
import { MD_PRESET_LABELS, MD_TOKENS } from "../../lib/mdPresets";
import { THEME_PRESET_LABELS, resolveThemeColors } from "../../lib/themePresets";
import type { AppConfig, Theme } from "../../types";
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

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="mt-2 border-b border-line pb-1 text-sm font-semibold">
      {children}
    </div>
  );
}

export default function AppearanceTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
    <>
        <SectionTitle>Theme</SectionTitle>

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

        <SectionTitle>Fonts</SectionTitle>

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

        <SectionTitle>Text colors</SectionTitle>

        <section className="flex flex-col gap-2">
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

        <SectionTitle>Task colors</SectionTitle>

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

        <SectionTitle>Section plates</SectionTitle>

        <span className="text-xs text-content-muted">
          Colors of the section header plates inside a column. Empty keeps
          the neutral plate style; General also needs cadence colors on.
        </span>
        {(
          [
            ["General", "cadence_color_general"],
            ["Postponed", "postponed_plate_color"],
            ["Done", "done_plate_color"],
          ] as const
        ).map(([label, key]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-24 text-xs text-content-muted">{label}</span>
            <ColorPicker
              value={config[key] || "#6b7280"}
              onChange={(color) => void updateConfig({ [key]: color })}
            />
            {config[key] ? (
              <button
                className="text-xs text-content-muted hover:text-content"
                onClick={() => void updateConfig({ [key]: "" })}
              >
                reset to neutral
              </button>
            ) : (
              <span className="text-xs text-content-muted">neutral</span>
            )}
          </div>
        ))}

        <SectionTitle>Editor colors</SectionTitle>

        <section className="flex flex-col gap-2">
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
            Markdown token colors in the Journal/Notes editor. Custom keeps
            its own seven colors and applies them on both themes. YAML files
            always follow the VS Code Dark+/Light+ palette.
          </span>
        </section>

        <SectionTitle>Vertical spacing</SectionTitle>

        <section className="flex flex-col gap-2">
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
            <label className="flex w-40 flex-col gap-1">
              <span className="text-xs text-content-muted">
                Before Postponed/Done
              </span>
              <NumberInput
                value={config.done_section_gap}
                min={0}
                onCommit={(n) =>
                  void updateConfig({ done_section_gap: Math.min(400, n) })
                }
              />
            </label>
          </div>
          <span className="text-xs text-content-muted">
            Sections are the cadence groups; the Postponed and Done blocks
            take their own gap so they can sit visibly lower. Category
            blocks group tasks by their {"{X}"} prefix or list inside a
            section. All values in px.
          </span>
        </section>
    </>
  );
}
