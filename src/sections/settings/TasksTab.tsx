import { Field, NumberInput, TextInput, Toggle } from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
import { useAppStore } from "../../store";

/** Behavior of task cards and list columns; their look and geometry
 *  live under Appearance and Layout. */
export default function TasksTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
    <>
      <SettingsGroup
        title="Task behavior"
        keys={[
          "done_hold_seconds",
          "undo_toast_seconds",
          "subtasks_done_last",
          "priority_overdue",
        ]}
      >
        <Field label="Hold before a done/postponed task moves to its section, seconds (0 = immediately)">
          <NumberInput
            value={config.done_hold_seconds}
            min={0}
            onCommit={(n) =>
              void updateConfig({ done_hold_seconds: Math.min(30, n) })
            }
          />
        </Field>

        <Field label="Undo toast after deleting a task or archiving a list, seconds (0 = no undo offer)">
          <NumberInput
            value={config.undo_toast_seconds}
            min={0}
            onCommit={(n) =>
              void updateConfig({ undo_toast_seconds: Math.min(30, n) })
            }
          />
        </Field>

        <Toggle
          checked={config.subtasks_done_last}
          label="Done subtasks sink to the bottom"
          hint="Checked subtasks move below the open ones in the card and the task dialog."
          onChange={(v) => void updateConfig({ subtasks_done_last: v })}
        />

        <Toggle
          checked={config.priority_overdue}
          label="Priority tasks get the overdue mark"
          hint="A starred task left unfinished past its day is marked OVERDUE like any other task; off = it carries over silently."
          onChange={(v) => void updateConfig({ priority_overdue: v })}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Card markers"
        keys={["cron_weekday_labels", "cron_everyday_label"]}
      >
        <Toggle
          checked={config.cron_weekday_labels}
          label="Weekday marker from cron on tasks"
          hint="Recurring tasks whose cron pins concrete weekdays show a [SAT#1]-style marker before the title (dashboard, calendar and projections)."
          onChange={(v) => void updateConfig({ cron_weekday_labels: v })}
        />

        {config.cron_weekday_labels && (
          <div className="pl-6">
            <Toggle
              checked={config.cron_everyday_label}
              label="[EVERYDAY] marker on daily rules"
              hint="Rules free on both day fields (e.g. 0 9 * * *) wear an [EVERYDAY] marker instead of going unlabeled."
              onChange={(v) => void updateConfig({ cron_everyday_label: v })}
            />
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="List behavior"
        keys={[
          "lists_sort_alpha",
          "list_tasks_sort_alpha",
          "clear_done_list_tasks",
        ]}
      >
        <Toggle
          checked={config.lists_sort_alpha}
          label="Sort lists alphabetically"
          hint="List columns order by name instead of creation order. Favorite lists always come first."
          onChange={(v) => void updateConfig({ lists_sort_alpha: v })}
        />

        <Toggle
          checked={config.list_tasks_sort_alpha}
          label="Sort tasks inside lists alphabetically"
          hint="Backlog tasks in a list column order by title instead of manual drag order; timed tasks still pin to the top."
          onChange={(v) => void updateConfig({ list_tasks_sort_alpha: v })}
        />

        <Toggle
          checked={config.clear_done_list_tasks}
          label="Clear done list tasks at day rollover"
          hint="Tasks checked off in a list column are removed from the database once their completion day has passed - the list is a working queue, not history."
          onChange={(v) => void updateConfig({ clear_done_list_tasks: v })}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Quick capture & tray"
        keys={["capture_list", "capture_shortcut", "tray_icon", "close_to_tray"]}
      >
        <Field label="Quick-capture list (created on first capture; empty = Inbox)">
          <TextInput
            value={config.capture_list}
            placeholder="Inbox"
            onCommit={(v) => void updateConfig({ capture_list: v })}
          />
        </Field>

        <Field label="Global capture shortcut (empty = disabled)">
          <TextInput
            value={config.capture_shortcut}
            placeholder="Ctrl+Alt+Space"
            onCommit={(v) => void updateConfig({ capture_shortcut: v })}
          />
        </Field>

        <Toggle
          checked={config.tray_icon}
          label="Tray icon"
          hint="Show / Quick capture / Quit in the system tray; a left click brings the main window up."
          onChange={(v) =>
            void updateConfig(
              v ? { tray_icon: v } : { tray_icon: v, close_to_tray: false },
            )
          }
        />

        {config.tray_icon && (
          <div className="pl-6">
            <Toggle
              checked={config.close_to_tray}
              label="Close to tray"
              hint="Closing the main window hides it instead of quitting, so the capture shortcut and due-task notifications keep working. Quit from the tray menu."
              onChange={(v) => void updateConfig({ close_to_tray: v })}
            />
          </div>
        )}
      </SettingsGroup>
    </>
  );
}
