import { Toggle } from "../../components/form";
import { useAppStore } from "../../store";

export default function NotificationsTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
    <>
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
    </>
  );
}
