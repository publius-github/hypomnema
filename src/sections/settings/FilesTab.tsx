import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../store";

export default function FilesTab() {
  const vaultPath = useAppStore((s) => s.vaultPath);
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
    <>

        <section className="flex flex-col gap-1">
          <span className="text-sm font-medium">Vault</span>
          <span className="select-text text-sm text-content-muted">
            {vaultPath}
          </span>
        </section>

        <section className="flex flex-col gap-1">
          <span className="text-sm font-medium">Notes folder</span>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 select-text truncate text-sm text-content-muted">
              {config.kb_path || "Not set"}
            </span>
            <button
              className="btn-ghost px-3 py-1 text-xs"
              onClick={async () => {
                const path = await open({
                  directory: true,
                  title: "Select KB folder",
                });
                if (typeof path === "string") {
                  await updateConfig({ kb_path: path });
                }
              }}
            >
              Change
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-1">
          <span className="text-sm font-medium">Journal template</span>
          <p className="text-xs text-content-muted">
            The template for new journal entries lives in
            config/templates/journal.md.
          </p>
          <button
            className="btn-ghost w-fit px-3 py-1 text-xs"
            onClick={() =>
              useAppStore.getState().openConfigFile("templates/journal.md")
            }
          >
            Edit in Notes
          </button>
        </section>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={config.kb_line_numbers}
            onChange={(e) =>
              void updateConfig({ kb_line_numbers: e.target.checked })
            }
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">
              Line numbers in the Notes editor
            </span>
            <span className="text-xs text-content-muted">
              Config files always show them; this turns them on for notes
              too.
            </span>
          </span>
        </label>

        <section className="flex flex-col gap-1">
          <span className="text-sm font-medium">Config files</span>
          <p className="text-xs text-content-muted">
            recurring.yml, scheduled.yml and the other config files are
            edited in Notes under the Config group, with validation on save.
            Quick links to the files without a form UI:
          </p>
          <div className="flex flex-wrap gap-2">
            {["weekly-focus.yml", "day-reminders.yml", "day-schedule.yml"].map(
              (file) => (
                <button
                  key={file}
                  className="btn-ghost px-3 py-1 text-xs"
                  onClick={() => useAppStore.getState().openConfigFile(file)}
                >
                  {file}
                </button>
              ),
            )}
            <button
              className="btn-ghost px-3 py-1 text-xs"
              onClick={() => useAppStore.getState().setSection("kb")}
            >
              All in Notes
            </button>
          </div>
        </section>
    </>
  );
}
