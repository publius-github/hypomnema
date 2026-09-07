import { useState, type ReactNode } from "react";
import { useAppStore } from "../store";
import { customizedCount, isGroupCustomized } from "../lib/settingsGroups";
import type { AppConfig } from "../types";

/**
 * Collapsible settings group with progressive disclosure: a group whose
 * fields all sit at their factory defaults renders as a header plus a
 * "Customize" affordance, one with any non-default field starts
 * expanded. Manual expand/collapse is ephemeral local state - the
 * customized check decides again on the next visit. Without the
 * defaults at hand (still loading, or the command failed) everything
 * stays visible: hiding fields must never cost access to them.
 */
export default function SettingsGroup({
  title,
  keys,
  alwaysOpen,
  children,
}: {
  title: string;
  /** Config fields the group holds; drives the customized check. */
  keys?: (keyof AppConfig)[];
  /** Informational groups (vault paths, maintenance actions). */
  alwaysOpen?: boolean;
  children: ReactNode;
}) {
  const config = useAppStore((s) => s.config);
  const defaults = useAppStore((s) => s.defaults);
  const [manual, setManual] = useState<boolean | null>(null);
  const ready = keys && config && defaults ? { config, defaults, keys } : null;
  const customized = ready
    ? isGroupCustomized(ready.config, ready.defaults, ready.keys)
    : true;
  const open = Boolean(alwaysOpen) || (manual ?? customized);
  const count = ready
    ? customizedCount(ready.config, ready.defaults, ready.keys)
    : 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="mt-2 flex items-baseline justify-between gap-2 border-b border-line pb-1">
        <span className="text-sm font-semibold">{title}</span>
        {!alwaysOpen && ready !== null && (
          <button
            className="text-xs text-content-muted hover:text-content"
            onClick={() => setManual(!open)}
          >
            {open
              ? "collapse"
              : count > 0
                ? `show (${count} changed)`
                : "Customize"}
          </button>
        )}
      </div>
      {open && children}
    </section>
  );
}
