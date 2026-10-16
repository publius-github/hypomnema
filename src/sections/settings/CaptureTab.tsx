import { Field, NumberInput, TextInput, Toggle } from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
import { useAppStore } from "../../store";

/**
 * The ways the app reaches out of its window: getting a task in without
 * opening it, staying alive in the tray, and telling you a task is due.
 * The shortcut and the tray are desktop-only (docs/windows/
 * ARCHITECTURE.md); the capture list is used on every target.
 */
export default function CaptureTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
    <>
      <SettingsGroup id="capture.capture">
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
        <span className="-mt-1 text-xs text-content-muted">
          Works while the app runs, even minimized to the tray. A
          combination another app already holds fails at registration and
          shows in the error banner; the setting still saves.
        </span>

        <Toggle
          checked={config.tray_icon}
          label="Keep running in the tray"
          hint="A tray icon with Show / Quick capture / Quit, and closing the main window hides it there instead of quitting - the capture shortcut and due-task notifications keep working. Quit from the tray menu."
          onChange={(v) => void updateConfig({ tray_icon: v })}
        />
      </SettingsGroup>

      <SettingsGroup id="capture.alerts">
        <p className="text-xs text-content-muted">
          A timed task coming due always raises an in-app toast. The
          setting below adds OS-level notifications on top.
        </p>

        <Toggle
          checked={config.notify_system}
          label="System notifications for due tasks"
          hint="A timed task coming due raises an OS notification in addition to the in-app toast, so it is visible when the window is minimized or behind others."
          onChange={(v) => void updateConfig({ notify_system: v })}
        />

        <Field label="Remind ahead of a timed task, minutes (0 = at its time)">
          <NumberInput
            value={config.notify_lead_minutes}
            min={0}
            onCommit={(n) =>
              void updateConfig({
                notify_lead_minutes: Math.min(240, Math.max(0, n)),
              })
            }
          />
        </Field>
      </SettingsGroup>
    </>
  );
}
