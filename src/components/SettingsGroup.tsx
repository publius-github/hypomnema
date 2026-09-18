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
  SETTINGS_SUBGROUPS,
  groupKeys,
  profileCoverage,
  subKeys,
  type SettingsGroupId,
  type SettingsSubId,
} from "../lib/settingsCatalog";
import type { AppConfig } from "../types";

/**
 * Where the search box sent the user: the group opens whatever its
 * collapsed state, scrolls into view and wears a ring until the next
 * search, and a hit on a field inside a micro-group opens that too -
 * hiding a field must never cost the search's ability to reach it. A
 * context rather than a prop so the tabs stay plain lists of groups.
 */
export type SettingsFocus = {
  group: SettingsGroupId;
  sub: SettingsSubId | null;
};

export const SettingsFocusContext = createContext<SettingsFocus | null>(null);

/**
 * The state every disclosure on this page is in, read from the config
 * rather than stored: a set of fields is "customized" when one of them
 * left its factory default. Without the defaults at hand (still
 * loading, or the command failed) `ready` is false and the caller
 * shows everything: hiding fields must never cost access to them.
 */
function useCustomization(keys: (keyof AppConfig)[]) {
  const config = useAppStore((s) => s.config);
  const defaults = useAppStore((s) => s.defaults);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const ready =
    keys.length > 0 && config && defaults ? { config, defaults } : null;

  return {
    ready: ready !== null,
    customized: ready
      ? isGroupCustomized(ready.config, ready.defaults, keys)
      : true,
    count: ready ? customizedCount(ready.config, ready.defaults, keys) : 0,
    reset: () => {
      if (!ready) return;
      const patch: Partial<AppConfig> = {};
      for (const key of keys) {
        // the value is the default's own, so the types line up by
        // construction; TS cannot see that through a keyof loop
        (patch as Record<string, unknown>)[key] = ready.defaults[key];
      }
      void updateConfig(patch);
    },
  };
}

/**
 * The customization switch, worn by a micro-group and by a group that
 * is nothing but knobs. Ticked = the fields are on screen; it ticks
 * itself when one of them differs from its default, so the checkbox
 * never contradicts the values under it. Unticking is therefore the
 * reset - leaving it unticked over changed values would be a lie - and
 * the title says so before the click.
 */
function CustomizeSwitch({
  label,
  hint,
  note,
  on,
  count,
  onChange,
}: {
  label: string;
  hint?: string;
  note?: ReactNode;
  on: boolean;
  count: number;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={on}
        title={
          count > 0
            ? "Unchecking puts these fields back to their factory defaults"
            : "Show these fields to tune them"
        }
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">
          {label}
          {note}
          {count > 0 && (
            <span className="ml-2 text-xs font-normal text-content-muted">
              {count} changed
            </span>
          )}
        </span>
        {hint && <span className="text-xs text-content-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Whether a profile's scope is worth naming beside a group title. */
function ProfileNote({ id }: { id: SettingsGroupId }) {
  const profileKeys = useAppStore((s) => s.profileKeys);
  const coverage = profileCoverage(id, profileKeys);
  if (coverage === "none" || coverage === "unknown") return null;
  return (
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
  );
}

/**
 * Collapsible settings group with progressive disclosure: a group whose
 * fields all sit at their factory defaults renders as a header plus a
 * "Customize" affordance, one with any non-default field starts
 * expanded. Manual expand/collapse is ephemeral local state - the
 * customized check decides again on the next visit.
 *
 * A group flagged `knobs` in the catalog holds nothing but fine-tuning,
 * so instead of the collapse link its header wears the same
 * customization checkbox a micro-group uses, and unchecking resets it.
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
  const { title, always, noReset, knobs } = SETTINGS_GROUPS[id];
  const keys = groupKeys(id);
  const focus = useContext(SettingsFocusContext);
  const focused = focus?.group === id;
  const ref = useRef<HTMLElement | null>(null);
  const [manual, setManual] = useState<boolean | null>(null);
  const { ready, customized, count, reset } = useCustomization(keys);
  const open = Boolean(always) || focused || (manual ?? customized);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "start" });
  }, [focused]);

  // a knobs group is its own micro-group: one switch, no collapse link
  if (knobs && ready) {
    return (
      <section
        ref={ref}
        className={`mt-2 flex scroll-mt-4 flex-col gap-3 ${
          focused && focus?.sub === null ? "rounded-md ring-2 ring-accent" : ""
        }`}
      >
        <CustomizeSwitch
          label={title}
          note={<ProfileNote id={id} />}
          on={open}
          count={count}
          onChange={(next) => {
            setManual(next);
            if (!next) reset();
          }}
        />
        {open && <div className="flex flex-col gap-3 pl-6">{children}</div>}
      </section>
    );
  }

  return (
    <section
      ref={ref}
      className={`flex scroll-mt-4 flex-col gap-3 ${
        focused && focus?.sub === null ? "rounded-md ring-2 ring-accent" : ""
      }`}
    >
      <div className="mt-2 flex items-baseline justify-between gap-2 border-b border-line pb-1">
        <span className="text-sm font-semibold">
          {title}
          <ProfileNote id={id} />
        </span>
        <span className="flex items-baseline gap-3">
          {!noReset && ready && customized && (
            <button
              className="text-xs text-content-muted hover:text-content"
              title="Put every field in this group back to its factory default"
              onClick={reset}
            >
              reset
            </button>
          )}
          {!always && ready && (
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

/**
 * A micro-group inside a group: the tail of fine-tuning that is hidden
 * until asked for. Same rule as a group, one level down and with a
 * checkbox instead of a link, because here the switch is the answer to
 * "do I want to hand-tune this at all?" rather than "is this section
 * folded?". It ticks itself while any of its fields differs from the
 * default, and unticking resets them.
 */
export function SettingsSubGroup({
  id,
  children,
}: {
  id: SettingsSubId;
  children: ReactNode;
}) {
  const { title, hint } = SETTINGS_SUBGROUPS[id];
  const keys = subKeys(id);
  const focused = useContext(SettingsFocusContext)?.sub === id;
  const ref = useRef<HTMLElement | null>(null);
  const [manual, setManual] = useState<boolean | null>(null);
  const { ready, count, customized, reset } = useCustomization(keys);
  const open = !ready || focused || (manual ?? customized);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "start" });
  }, [focused]);

  return (
    <section
      ref={ref}
      className={`flex scroll-mt-4 flex-col gap-2 ${
        focused ? "rounded-md ring-2 ring-accent" : ""
      }`}
    >
      <CustomizeSwitch
        label={title}
        hint={open ? hint : undefined}
        on={open}
        count={count}
        onChange={(next) => {
          setManual(next);
          if (!next) reset();
        }}
      />
      {open && <div className="flex flex-col gap-2 pl-6">{children}</div>}
    </section>
  );
}
