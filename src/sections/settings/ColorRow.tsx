import { ColorPicker } from "../../components/form";
import { useAppStore } from "../../store";
import type { AppConfig } from "../../types";

/** A config field holding a color, where "" means "use the fallback". */
type OverridableColor = {
  [K in keyof AppConfig]: AppConfig[K] extends string ? K : never;
}[keyof AppConfig];

/**
 * One overridable color: the label, the picker showing the effective
 * color, and either a reset link (an override is set) or the name of
 * what applies without one. The fallback is per theme where the
 * stylesheet's own value differs between dark and light.
 */
export default function ColorRow({
  label,
  field,
  dark,
  light = dark,
  fallbackName = "theme default",
}: {
  label: string;
  field: OverridableColor;
  dark: string;
  light?: string;
  fallbackName?: string;
}) {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;
  const value = config[field] as string;
  const fallback = config.theme === "light" ? light : dark;
  return (
    <div className="flex items-center gap-2">
      <span className="w-48 text-xs text-content-muted">{label}</span>
      <ColorPicker
        value={value || fallback}
        onChange={(color) => void updateConfig({ [field]: color })}
      />
      {value ? (
        <button
          className="text-xs text-content-muted hover:text-content"
          onClick={() => void updateConfig({ [field]: "" })}
        >
          reset to {fallbackName}
        </button>
      ) : (
        <span className="text-xs text-content-muted">{fallbackName}</span>
      )}
    </div>
  );
}
