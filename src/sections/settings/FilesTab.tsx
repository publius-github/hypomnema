import { open } from "@tauri-apps/plugin-dialog";
import { Field, NumberInput, Toggle } from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
import { useAppStore } from "../../store";

export default function FilesTab() {
  const vaultPath = useAppStore((s) => s.vaultPath);
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  if (!config) return null;

  return (
    <>
      <SettingsGroup title="Vault & folders" alwaysOpen>
        <section className="flex flex-col gap-1">
          <span className="text-sm font-medium">Vault</span>
          <span className="select-text text-sm text-content-muted">
            {vaultPath}
          </span>
        </section>

        <section className="flex flex-col gap-1">
          <span className="text-sm font-medium">Notes folder</span>
          <p className="text-xs text-content-muted">
            A .hypomnemaignore file in this folder hides files from the
            Notes tree, gitignore-style: one pattern per line, e.g.
            *.db, drafts/ (folders end with /), sub/file.md; # starts a
            comment.
          </p>
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
            .hypomnema/config/templates/journal.md.
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
      </SettingsGroup>

      <SettingsGroup title="Notes" keys={["notes_timestamps"]}>
        <Toggle
          checked={config.notes_timestamps}
          label="Created and Last edited lines on notes"
          hint="Markdown notes saved from the Notes editor carry two lines at the top - Created: and Last edited:, date and time - kept up to date by the app. A note with a YAML frontmatter block gets them inside it. Created can be corrected by hand; Last edited moves whenever the text below it changes. A note without them takes its file dates on its first save; edits made in other editors are not stamped."
          onChange={(v) => void updateConfig({ notes_timestamps: v })}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Snapshots & mirror"
        keys={[
          "state_snapshot",
          "tasks_mirror",
          "tasks_mirror_agenda",
          "tasks_mirror_ids",
          "tasks_mirror_today",
          "tasks_mirror_today_days",
        ]}
      >
        <Toggle
          checked={config.state_snapshot}
          label="Text snapshot of the database"
          hint="Keeps vault/.hypomnema/state/ up to date with everything the database holds (tasks, lists, engine ledgers) as plain JSONL files. A vault opened without its app.db - a fresh sync copy, or after deleting the cache - rebuilds the database from them automatically."
          onChange={(v) => void updateConfig({ state_snapshot: v })}
        />

        <Toggle
          checked={config.tasks_mirror}
          label="Mirror tasks to Markdown files"
          hint="Keeps vault/.hypomnema/tasks/ in two-way sync: one file per list plus scheduled.md with the dated tasks. Edit them in any editor for bulk changes; lines without a ^id become new tasks, deleting a line deletes the task. Imports merge against the last exported state, so a file arriving from a file sync (Dropbox etc.) never rolls back newer app-side edits or deletes tasks it did not know about."
          onChange={(v) => void updateConfig({ tasks_mirror: v })}
        />

        {config.tasks_mirror && (
          <div className="flex flex-col gap-3 pl-6">
            <Toggle
              checked={config.tasks_mirror_agenda}
              label="Agenda file with generated tasks"
              hint="agenda.md lists recurring/scheduled/birthday instances from today onward, grouped by day. Checking a box, setting a time or the ! priority mark syncs back; title and date edits do not (the YAML rules own them), and deleting lines changes nothing. A new line without an id becomes a manual task on that day - handy as the phone-editing surface over a file sync."
              onChange={(v) => void updateConfig({ tasks_mirror_agenda: v })}
            />

            <Toggle
              checked={config.tasks_mirror_ids}
              label="Write the ^id sync key on every line"
              hint="The trailing number is what ties a line to its task across edits. Turning it off keeps the files clean to read, and a line is then matched by its text instead: retyping a title replaces the task rather than renaming it."
              onChange={(v) => void updateConfig({ tasks_mirror_ids: v })}
            />

            <Toggle
              checked={config.tasks_mirror_today}
              label="Read-only today.md day sheet"
              hint="A phone-readable summary of the day next to the other mirror files: focus phrase, reminders, schedule blocks, overdue and today's tasks grouped by category. Regenerated on every change; edits to it are ignored."
              onChange={(v) => void updateConfig({ tasks_mirror_today: v })}
            />

            {config.tasks_mirror_today && (
              <div className="pl-6">
                <Field label="Days covered by today.md (1-7)">
                  <NumberInput
                    value={config.tasks_mirror_today_days}
                    min={1}
                    onCommit={(n) =>
                      void updateConfig({
                        tasks_mirror_today_days: Math.min(7, n),
                      })
                    }
                  />
                </Field>
              </div>
            )}
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="Backups" keys={["backup_keep"]}>
        <Field label="Backups to keep (0 = disabled)">
          <NumberInput
            value={config.backup_keep}
            min={0}
            onCommit={(n) => void updateConfig({ backup_keep: n })}
          />
        </Field>
        <span className="text-xs text-content-muted">
          Daily snapshots of the task database plus a copy of each config
          file before the app rewrites it, stored under backups/ in the
          vault.
        </span>
      </SettingsGroup>
    </>
  );
}
