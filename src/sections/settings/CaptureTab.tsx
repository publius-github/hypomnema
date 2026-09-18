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
      </SettingsGroup>

      <SettingsGroup id="capture.tray">
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

        <Field label="Snooze length of the due-task toast, minutes">
          <NumberInput
            value={config.notify_snooze_minutes}
            min={1}
            onCommit={(n) =>
              void updateConfig({
                notify_snooze_minutes: Math.min(180, Math.max(1, n)),
              })
            }
          />
        </Field>
      </SettingsGroup>
    </>
  );
}
