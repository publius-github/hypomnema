import { useState } from "react";
import { useAppStore } from "../../store";
import { CADENCE_GROUP_LABELS } from "../../lib/tasks";
import type { AppConfig } from "../../types";
import {
  ChoiceRow,
  NumberRow,
  Section,
  Sheet,
  SwitchRow,
  ValueRow,
} from "./rows";

type Props = { config: AppConfig };

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * How tasks show on the Day and Lists screens - the desktop's Settings >
 * Tasks minus the list column title clamp, which a phone row does not
 * have. Synced as cards.yml while card sync is on (Sync).
 */
export function TasksPanel({ config }: Props) {
  const updateConfig = useAppStore((s) => s.updateConfig);
  return (
    <>
      <Section title="Task cards">
        <SwitchRow
          label="Category as a block header"
          hint="Named once over its rows instead of a chip on each"
          checked={config.category_headers}
          onChange={(v) => void updateConfig({ category_headers: v })}
        />
        <SwitchRow
          label="Weekday markers"
          hint="[SAT#1] or [EVERYDAY] before a recurring title"
          checked={config.cron_weekday_labels}
          onChange={(v) => void updateConfig({ cron_weekday_labels: v })}
        />
        <ChoiceRow
          label="Completion rate chip"
          value={config.habit_rate_display}
          options={[
            { value: "off", label: "Off" },
            {
              value: "alert",
              label: "Below threshold",
              hint: "Only on items doing worse than the alert",
            },
            { value: "always", label: "Always" },
          ]}
          onChange={(v) => void updateConfig({ habit_rate_display: v })}
        />
        {config.habit_rate_display !== "off" && (
          <NumberRow
            label="Alert below"
            hint="A rule's own threshold in recurring.yml wins"
            value={config.habit_rate_threshold}
            presets={[50, 60, 70, 80, 90]}
            min={0}
            max={100}
            format={(n) => `${n}%`}
            onChange={(v) => void updateConfig({ habit_rate_threshold: v })}
          />
        )}
        <SwitchRow
          label="Done subtasks sink to the bottom"
          checked={config.subtasks_done_last}
          onChange={(v) => void updateConfig({ subtasks_done_last: v })}
        />
      </Section>
      <Section title="Day screen">
        <ChoiceRow
          label="Done tasks"
          value={config.done_display}
          options={[
            {
              value: "inline",
              label: "In place",
              hint: "Inside their daily and weekly sections",
            },
            {
              value: "separate",
              label: "Own sections",
              hint: "Postponed and Done in blocks of their own",
            },
          ]}
          onChange={(v) => void updateConfig({ done_display: v })}
        />
        {config.done_display === "separate" && (
          <SwitchRow
            label="Sort Postponed and Done A-Z"
            hint="By category, then title"
            checked={config.closed_sections_sort_alpha}
            onChange={(v) =>
              void updateConfig({ closed_sections_sort_alpha: v })
            }
          />
        )}
        <CadenceOrderRow config={config} />
        <SwitchRow
          label="Daily tasks only on today"
          hint="Days ahead skip daily-cadence tasks"
          checked={config.daily_tasks_today_only}
          onChange={(v) => void updateConfig({ daily_tasks_today_only: v })}
        />
      </Section>
      <Section title="Lists">
        <SwitchRow
          label="Sort lists and their tasks A-Z"
          hint="Off keeps creation and drag order"
          checked={config.lists_sort_alpha}
          onChange={(v) => void updateConfig({ lists_sort_alpha: v })}
        />
      </Section>
    </>
  );
}

/** The day's cadence sections in order, rearranged in a sheet. */
function CadenceOrderRow({ config }: Props) {
  const updateConfig = useAppStore((s) => s.updateConfig);
  const [open, setOpen] = useState(false);
  const order = config.cadence_group_order;
  const label = (id: string) => CADENCE_GROUP_LABELS[id] ?? id;
  const move = (index: number, delta: number) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void updateConfig({ cadence_group_order: next });
  };
  return (
    <>
      <ValueRow
        label="Section order"
        hint={order.map(label).join(" · ")}
        value="Change"
        onClick={() => setOpen(true)}
      />
      {open && (
        <Sheet title="Section order" onClose={() => setOpen(false)}>
          <ol className="divide-y divide-line/60">
            {order.map((id, i) => (
              <li key={id} className="flex min-h-14 items-center gap-1 px-4">
                <span className="w-6 shrink-0 text-sm text-content-muted">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">{label(id)}</span>
                <button
                  type="button"
                  className="h-11 w-11 rounded-lg text-lg disabled:opacity-25"
                  disabled={i === 0}
                  aria-label={`Move ${label(id)} up`}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="h-11 w-11 rounded-lg text-lg disabled:opacity-25"
                  disabled={i === order.length - 1}
                  aria-label={`Move ${label(id)} down`}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
              </li>
            ))}
          </ol>
        </Sheet>
      )}
    </>
  );
}

export function NotificationsPanel({ config }: Props) {
  const updateConfig = useAppStore((s) => s.updateConfig);
  return (
    <Section>
      <SwitchRow
        label="Notifications for due tasks"
        checked={config.notify_system}
        onChange={(v) => void updateConfig({ notify_system: v })}
      />
      {config.notify_system && (
        <NumberRow
          label="Remind ahead of a timed task"
          value={config.notify_lead_minutes}
          presets={[0, 5, 10, 15, 30, 60]}
          min={0}
          max={240}
          format={(n) => (n === 0 ? "At its time" : `${n} min before`)}
          onChange={(v) => void updateConfig({ notify_lead_minutes: v })}
        />
      )}
    </Section>
  );
}

/**
 * The rules every device must agree on (shared.yml): where a capture
 * lands, which tasks get the overdue mark, and the engine's windows.
 */
export function RulesPanel({ config }: Props) {
  const updateConfig = useAppStore((s) => s.updateConfig);
  const lists = useAppStore((s) => s.lists);
  const names = lists
    .filter((l) => !l.archived && !l.auto)
    .map((l) => l.name)
    .sort((a, b) => a.localeCompare(b));
  if (!names.includes(config.capture_list)) names.unshift(config.capture_list);
  return (
    <>
      <Section title="Capture">
        <ChoiceRow
          label="Quick capture goes to"
          value={config.capture_list}
          options={names.map((name) => ({ value: name, label: name }))}
          onChange={(v) => void updateConfig({ capture_list: v })}
        />
      </Section>
      <Section title="Overdue">
        <SwitchRow
          label="Priority tasks get the mark"
          hint="Off: a starred task carries over silently"
          checked={config.priority_overdue}
          onChange={(v) => void updateConfig({ priority_overdue: v })}
        />
        <SwitchRow
          label="General tasks get the mark"
          hint="Off: a one-off General task moves to today silently"
          checked={config.general_overdue}
          onChange={(v) => void updateConfig({ general_overdue: v })}
        />
      </Section>
      <Section
        title="Engine"
        footer="These rules are the same on every device that syncs this vault."
      >
        <NumberRow
          label="Catch up missed rules"
          hint="Missed firings in this window come back as one task"
          value={config.catchup_days}
          presets={[1, 3, 7, 14, 30]}
          min={1}
          max={365}
          format={days}
          onChange={(v) => void updateConfig({ catchup_days: v })}
        />
        <SwitchRow
          label="Catch up crons by calendar day"
          hint="A missed time of day still counts as that day"
          checked={config.cron_ignore_time}
          onChange={(v) => void updateConfig({ cron_ignore_time: v })}
        />
        <NumberRow
          label="Keep done one-off tasks"
          value={config.retention_days}
          presets={[0, 30, 90, 180, 365]}
          min={0}
          max={36500}
          format={(n) => (n === 0 ? "Forever" : days(n))}
          onChange={(v) => void updateConfig({ retention_days: v })}
        />
        <SwitchRow
          label="Clear done list tasks overnight"
          checked={config.clear_done_list_tasks}
          onChange={(v) => void updateConfig({ clear_done_list_tasks: v })}
        />
        <SwitchRow
          label="Clear done subtasks overnight"
          checked={config.clear_done_subtasks}
          onChange={(v) => void updateConfig({ clear_done_subtasks: v })}
        />
      </Section>
    </>
  );
}
