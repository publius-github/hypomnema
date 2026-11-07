import { readable } from "../lib/color";
import { cadenceHex, recurringCadenceOf } from "../lib/tasks";
import type { AppConfig, Task } from "../types";

/**
 * The cadence a recurring task's `[DAILY]`-style badge names, or null:
 * the badge is drawn only under `day_sections: recurring`, where the
 * cadences share one Recurring section and the plate no longer says it.
 */
export function cadenceBadgeOf(
  config: AppConfig | null,
  task: Task,
): string | null {
  return config?.day_sections === "recurring" ? recurringCadenceOf(task) : null;
}

/**
 * The weekday marker a card shows next to its cadence badge: a daily
 * rule's [EVERYDAY] says nothing [DAILY] does not.
 */
export function dowBesideBadge(
  dowLabel: string | null,
  badge: string | null,
): string | null {
  return badge === "daily" && dowLabel === "EVERYDAY" ? null : dowLabel;
}

/**
 * `[DAILY]` before a task's weekday marker, in its cadence color under
 * `cadence_badge_colors`, else in the marker's muted tone. On a closed
 * card it joins the struck-through muted text.
 */
export default function CadenceBadge({
  cadence,
  config,
  closed,
}: {
  cadence: string;
  config: AppConfig | null;
  closed: boolean;
}) {
  const hex =
    (config?.cadence_badge_colors ?? true) && !closed
      ? cadenceHex(config, cadence)
      : null;
  return (
    <span
      className="text-content-muted"
      style={
        hex
          ? { color: readable(hex, "text") }
          : { opacity: (config?.dow_label_opacity ?? 60) / 100 }
      }
      title={`${cadence[0].toUpperCase()}${cadence.slice(1)} rule`}
    >
      [{cadence.toUpperCase()}]{" "}
    </span>
  );
}
