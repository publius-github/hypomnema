import { Field, NumberInput, TextInput } from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
import type { Theme } from "../../types";
import { useAppStore } from "../../store";
import ColorRow from "./ColorRow";

// the chrome palette: [label, config key, dark default, light default] -
// the defaults are the stylesheet values (VS Code Dark+ / Light+), shown
// in the picker while no override is set
const THEME_COLOR_ROWS = [
  ["Accent", "accent_color", "#3794ff", "#005fb8"],
  ["Background", "surface_color", "#1e1e1e", "#ffffff"],
  ["Panels", "surface_alt_color", "#252526", "#f3f3f3"],
  ["Borders", "line_color", "#3c3c3c", "#e0e0e0"],
  ["Main text", "content_color", "#d4d4d4", "#333333"],
  ["Secondary text", "content_muted_color", "#8c8c8c", "#6f6f6f"],
] as const;

// color_min_contrast steps, in tenths of a ratio: off keeps every color
// as picked, 3:1 is the WCAG floor for marks and large text, 4.5:1 for
// body text (AA), 7:1 the AAA level
const CONTRAST_FLOORS = [
  [0, "Off - use colors as picked"],
  [30, "3:1 - minimal"],
  [45, "4.5:1 - WCAG AA (recommended)"],
  [70, "7:1 - WCAG AAA"],
] as const;

/**
 * The app's global look: the chrome that belongs to no single object on
 * screen - theme, palette, text colors and fonts. Anything that colors
 * one object (the weekly focus, a day header, a marker) lives with that
 * object under Pages, Task cards or Columns.
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

        <section className="flex flex-col gap-2">
          <span className="text-sm font-medium">Theme colors</span>
          {THEME_COLOR_ROWS.map(([label, key, dark, light]) => (
            <ColorRow
              key={key}
              label={label}
              field={key}
              dark={dark}
              light={light}
            />
          ))}
        </section>

        <Field label="Color contrast floor (plates, chips, stripes and marks adapt to the theme)">
          <select
            className="input"
            value={config.color_min_contrast}
            onChange={(e) =>
              void updateConfig({ color_min_contrast: Number(e.target.value) })
            }
          >
            {CONTRAST_FLOORS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            {!CONTRAST_FLOORS.some(([v]) => v === config.color_min_contrast) && (
              <option value={config.color_min_contrast}>
                {config.color_min_contrast / 10}:1
              </option>
            )}
          </select>
        </Field>
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
    </>
  );
}
