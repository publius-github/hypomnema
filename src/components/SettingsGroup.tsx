import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAppStore } from "../store";
import { customizedCount, isGroupCustomized } from "../lib/settingsGroups";
import {
  SETTINGS_GROUPS,
  groupKeys,
  profileCoverage,
  type SettingsGroupId,
} from "../lib/settingsCatalog";
import type { AppConfig } from "../types";

/**
 * The group the search box sent the user to: it opens whatever its
 * collapsed state, scrolls into view and wears a ring until the next
 * search. A context rather than a prop so the tabs stay plain lists of
 * groups.
 */
export const SettingsFocusContext = createContext<SettingsGroupId | null>(null);

/**
 * Collapsible settings group with progressive disclosure: a group whose
 * fields all sit at their factory defaults renders as a header plus a
 * "Customize" affordance, one with any non-default field starts
 * expanded. Manual expand/collapse is ephemeral local state - the
 * customized check decides again on the next visit. Without the
 * defaults at hand (still loading, or the command failed) everything
 * stays visible: hiding fields must never cost access to them.
 *
 * Title and field list come from `settingsCatalog` by group id, so the
 * page's map lives in one file and a tab never repeats a key list.
 */
export default function SettingsGroup({
  id,
  children,
}: {
  id: SettingsGroupId;
  children: ReactNode;
}) {
  const { title, always, noReset } = SETTINGS_GROUPS[id];
  const keys = groupKeys(id);
  const config = useAppStore((s) => s.config);
  const defaults = useAppStore((s) => s.defaults);
  const profileKeys = useAppStore((s) => s.profileKeys);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const focused = useContext(SettingsFocusContext) === id;
  const ref = useRef<HTMLElement | null>(null);
  const [manual, setManual] = useState<boolean | null>(null);
  const ready =
    keys.length > 0 && config && defaults ? { config, defaults, keys } : null;
  const customized = ready
    ? isGroupCustomized(ready.config, ready.defaults, ready.keys)
    : true;
  const open = Boolean(always) || focused || (manual ?? customized);
  const count = ready
    ? customizedCount(ready.config, ready.defaults, ready.keys)
    : 0;
  const coverage = profileCoverage(id, profileKeys);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "start" });
  }, [focused]);

  const reset = () => {
    if (!ready) return;
    const patch: Partial<AppConfig> = {};
    for (const key of ready.keys) {
      // the value is the default's own, so the types line up by
      // construction; TS cannot see that through a keyof loop
      (patch as Record<string, unknown>)[key] = ready.defaults[key];
    }
    void updateConfig(patch);
  };

  return (
    <section
      ref={ref}
      className={`flex scroll-mt-4 flex-col gap-3 ${
        focused ? "rounded-md ring-2 ring-accent" : ""
      }`}
    >
      <div className="mt-2 flex items-baseline justify-between gap-2 border-b border-line pb-1">
        <span className="text-sm font-semibold">
          {title}
          {coverage !== "none" && coverage !== "unknown" && (
            <span
              className="ml-2 text-xs font-normal text-content-muted"
              title={
                coverage === "all"
                  ? "Every field here is saved into a settings profile and replaced when one is applied."
                  : "Part of this group is saved into a settings profile; the rest is behavior and stays as it is."
              }
            >
              {coverage === "all" ? "in profiles" : "partly in profiles"}
            </span>
          )}
        </span>
        <span className="flex items-baseline gap-3">
          {!noReset && ready !== null && customized && (
            <button
              className="text-xs text-content-muted hover:text-content"
              title="Put every field in this group back to its factory default"
              onClick={reset}
            >
              reset
            </button>
          )}
          {!always && ready !== null && (
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
        </span>
      </div>
      {open && children}
    </section>
  );
}
