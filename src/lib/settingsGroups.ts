import type { AppConfig } from "../types";

/**
 * Whether any of the given fields differs from its factory default -
 * the signal that expands a settings group automatically. Array fields
 * (section_order, cadence_group_order) compare element-wise.
 */
export function isGroupCustomized(
  config: AppConfig,
  defaults: AppConfig,
  keys: (keyof AppConfig)[],
): boolean {
  return keys.some((key) => {
    const a = config[key];
    const b = defaults[key];
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length !== b.length || a.some((v, i) => v !== b[i]);
    }
    return a !== b;
  });
}

/** Collapsed-group summary: how many of the fields left their default. */
export function customizedCount(
  config: AppConfig,
  defaults: AppConfig,
  keys: (keyof AppConfig)[],
): number {
  return keys.filter((key) => isGroupCustomized(config, defaults, [key]))
    .length;
}
