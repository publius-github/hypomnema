import {
  ColorPicker,
  Field,
  NumberInput,
  TextInput,
} from "../../components/form";
import { Toggle } from "../../components/form";
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

/**
 * The app's global look: the chrome that belongs to no single object on
 * screen. What a task card, a day column or a list column looks like
 * lives with that object - under Task cards and Columns - so its color,
 * spacing and behavior can be set in one place.
 */
export default function AppearanceTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
    <>
      <SettingsGroup id="appearance.theme">
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

      <SettingsGroup id="appearance.fonts">
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

      <SettingsGroup id="appearance.text">
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

      <SettingsGroup id="appearance.editor">
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
