import {
  ColorPicker,
  Field,
  NumberInput,
  TextInput,
  Toggle,
} from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
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

/** Everything about how the app looks; layout geometry is under Layout. */
export default function AppearanceTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
    <>
      <SettingsGroup
        title="Theme & palette"
        keys={[
          "theme",
          "theme_preset",
          "accent_color",
          "surface_color",
          "surface_alt_color",
          "line_color",
        ]}
      >
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
      </SettingsGroup>

      <SettingsGroup
        title="Fonts & sizes"
        keys={["ui_font", "editor_font", "ui_font_size", "editor_font_size"]}
      >
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
      </SettingsGroup>

      <SettingsGroup
        title="Text colors"
        keys={[
          "content_color",
          "content_muted_color",
          "weekly_focus_color",
          "reminder_color",
          "day_header_color",
          "dow_label_color",
        ]}
      >
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
      </SettingsGroup>

      <SettingsGroup
        title="Task colors"
        keys={[
          "cadence_colors",
          "cadence_color_daily",
          "cadence_color_weekly",
          "cadence_color_monthly",
          "cadence_color_yearly",
          "cadence_color_exact",
          "done_color",
        ]}
      >
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
          <span className="text-sm font-medium">Done checkbox color</span>
          <ColorPicker
            value={config.done_color}
            onChange={(color) => void updateConfig({ done_color: color })}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Category chips"
        keys={[
          "category_color",
          "category_color_mode",
          "category_color_a",
          "category_color_b",
          "chip_font_scale",
        ]}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Category label color</span>
          <ColorPicker
            value={config.category_color}
            onChange={(color) => void updateConfig({ category_color: color })}
          />
          <span className="text-xs text-content-muted">
            Used when the mode below is &quot;One color for all&quot;.
          </span>
        </div>
        <Field label="Category chip colors">
          <select
            className="input"
            value={config.category_color_mode}
            onChange={(e) =>
              void updateConfig({
                category_color_mode: e.target
                  .value as AppConfig["category_color_mode"],
              })
            }
          >
            <option value="single">One color for all (above)</option>
            <option value="varied">A color per category</option>
            <option value="alternate">Alternate between two colors</option>
          </select>
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          {config.category_color_mode === "varied"
            ? "Each category takes its own hue: a list keeps the color of its own column, any other {Category} gets a palette color picked from its name."
            : config.category_color_mode === "alternate"
              ? "The two colors below take turns, one category block after the next, running down a whole column - the turn carries on across the Daily/Weekly/Monthly sections and into Postponed and Done instead of restarting."
              : "Every category label wears the single color above."}
        </span>
        {config.category_color_mode === "alternate" && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Alternating colors</span>
            <ColorPicker
              value={config.category_color_a}
              onChange={(color) =>
                void updateConfig({ category_color_a: color })
              }
            />
            <ColorPicker
              value={config.category_color_b}
              onChange={(color) =>
                void updateConfig({ category_color_b: color })
              }
            />
          </div>
        )}
        <Field label="Chip text size, % of the text beside it">
          <NumberInput
            value={config.chip_font_scale}
            min={50}
            onCommit={(n) => void updateConfig({ chip_font_scale: n })}
          />
        </Field>
        <span className="-mt-1 text-xs text-content-muted">
          The category, list and date chips on the task cards and in the
          Calendar day list. 100 = exactly the size of the task text.
        </span>
      </SettingsGroup>

      <SettingsGroup
        title="Section plates"
        keys={[
          "cadence_color_general",
          "postponed_plate_color",
          "done_plate_color",
        ]}
      >
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
      </SettingsGroup>

      <SettingsGroup
        title="Dated list tasks"
        keys={["list_exact_stripe", "list_date_chip_color"]}
      >
        <span className="text-xs text-content-muted">
          A list task with a date also shows on its day column, where it
          always wears the exact-date look. The settings below control how
          loud it is inside its own list before the date arrives.
        </span>

        <Toggle
          checked={config.list_exact_stripe}
          label="Exact-date stripe inside the list"
          hint="On: the card stripe takes the exact-date color in the list too. Off: the list color rules there and only the date chip marks the task."
          onChange={(v) => void updateConfig({ list_exact_stripe: v })}
        />

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            Date chip color inside the list
          </span>
          <ColorPicker
            value={config.list_date_chip_color || config.cadence_color_exact}
            onChange={(color) =>
              void updateConfig({ list_date_chip_color: color })
            }
          />
          {config.list_date_chip_color ? (
            <button
              className="text-xs text-content-muted hover:text-content"
              onClick={() => void updateConfig({ list_date_chip_color: "" })}
            >
              reset to exact-date color
            </button>
          ) : (
            <span className="text-xs text-content-muted">
              exact-date color
            </span>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Editor"
        keys={[
          "md_preset",
          "md_color_heading",
          "md_color_bold",
          "md_color_italic",
          "md_color_code",
          "md_color_link",
          "md_color_quote",
          "md_color_marker",
          "kb_line_numbers",
        ]}
      >
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

        <Toggle
          checked={config.kb_line_numbers}
          label="Line numbers in the Notes editor"
          hint="Config files always show them; this covers regular notes."
          onChange={(v) => void updateConfig({ kb_line_numbers: v })}
        />
      </SettingsGroup>
    </>
  );
}
