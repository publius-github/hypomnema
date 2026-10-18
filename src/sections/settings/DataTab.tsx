import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Field, NumberInput, Toggle } from "../../components/form";
import SettingsGroup from "../../components/SettingsGroup";
import { ConfirmModal } from "../../components/dialogs";
import { errorMessage, invoke } from "../../lib/ipc";
import { useAppStore } from "../../store";
import type { BackupEntry, BackupsOverview, List } from "../../types";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type RestoreTarget = { kind: "db" | "config"; entry: BackupEntry };

function BackupList({
  title,
  hint,
  entries,
  onRestore,
  disabled,
}: {
  title: string;
  hint: string;
  entries: BackupEntry[];
  onRestore: (entry: BackupEntry) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-content-muted">{title}</span>
      <p className="text-xs text-content-muted">{hint}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-content-muted">No snapshots yet.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              <span className="shrink-0 text-xs text-content-muted">
                {entry.modified}
              </span>
              <span className="w-16 shrink-0 text-right text-xs text-content-muted">
                {formatSize(entry.size)}
              </span>
              <button
                className="btn-ghost shrink-0 px-2 py-0.5 text-xs disabled:opacity-50"
                disabled={disabled}
                onClick={() => onRestore(entry)}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Everything the vault holds and what the app does to it: where the
 * files are, how notes and the journal are written, which extra files
 * it keeps, how many copies - and, in the same place, restoring those
 * copies and clearing out done tasks, automatically or by hand.
 * The retention knob and the restore list used to sit two tabs apart,
 * with the one pointing at the other in prose.
 */
export default function DataTab() {
  const vaultPath = useAppStore((s) => s.vaultPath);
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const [status, setStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [archived, setArchived] = useState<List[]>([]);
  const [backups, setBackups] = useState<BackupsOverview | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(
    null,
  );
  const [restoring, setRestoring] = useState(false);

  const loadArchived = useCallback(async () => {
    try {
      setArchived(await invoke("lists_archived"));
    } catch (e) {
      useAppStore.getState().setError(errorMessage(e));
    }
  }, []);

  const loadBackups = useCallback(async () => {
    try {
      setBackups(await invoke("backups_list"));
    } catch (e) {
      useAppStore.getState().setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void loadArchived();
    void loadBackups();
  }, [loadArchived, loadBackups]);

  const deleteDone = async () => {
    setConfirming(false);
    try {
      const deleted = await invoke("tasks_delete_done");
      setStatus(`Deleted ${deleted} done task(s)`);
      await useAppStore.getState().refresh();
    } catch (e) {
      useAppStore.getState().setError(errorMessage(e));
    }
  };

  const unarchive = async (id: number) => {
    try {
      await invoke("list_unarchive", { id });
      await loadArchived();
      await useAppStore.getState().refresh();
    } catch (e) {
      useAppStore.getState().setError(errorMessage(e));
    }
  };

  const confirmRestore = async () => {
    if (!restoreTarget) return;
    const { kind, entry } = restoreTarget;
    setRestoreTarget(null);
    setRestoring(true);
    try {
      if (kind === "db") {
        // the whole database is being swapped: reload config, then rerun
        // the engine and refetch every view, same as opening a vault
        const restored = await invoke("backup_restore_db", { id: entry.id });
        useAppStore.setState({ config: restored });
        await useAppStore.getState().runEngine();
        await useAppStore.getState().refresh();
        setStatus(`Restored database from ${entry.label}`);
      } else {
        // a plain file write; the config watcher picks it up and
        // reloads it the same way any external edit does
        await invoke("backup_restore_config", { id: entry.id });
        setStatus(`Restored ${entry.label} - changes apply in a moment`);
      }
      await loadBackups();
    } catch (e) {
      useAppStore.getState().setError(errorMessage(e));
    } finally {
      setRestoring(false);
    }
  };

  if (!config) return null;

  return (
    <>
      <SettingsGroup id="data.vault">
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
      </SettingsGroup>

      <SettingsGroup id="data.notes">
        <Toggle
          checked={config.kb_line_numbers}
          label="Line numbers in the Notes editor"
          hint="Config files always show them; this covers regular notes."
          onChange={(v) => void updateConfig({ kb_line_numbers: v })}
        />
        <Toggle
          checked={config.notes_timestamps}
          label="Created and Last edited lines on notes"
          hint="Markdown notes saved from the Notes editor carry two lines at the top - Created: and Last edited:, date and time - kept up to date by the app. A note with a YAML frontmatter block gets them inside it. Created can be corrected by hand; Last edited moves whenever the text below it changes. A note without them takes its file dates on its first save; edits made in other editors are not stamped."
          onChange={(v) => void updateConfig({ notes_timestamps: v })}
        />
        <Toggle
          checked={config.journal_day_tasks}
          label="Tasks of the day in the Journal"
          hint="A strip under the Journal entry's header lists that day's tasks - what got done and what stayed open - so an entry can be written against the day as it went."
          onChange={(v) => void updateConfig({ journal_day_tasks: v })}
        />
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

      <SettingsGroup id="data.mirror">
        <Toggle
          checked={config.tasks_mirror}
          label="Mirror tasks to Markdown files"
          hint="Keeps vault/.hypomnema/tasks/ in two-way sync: one file per list plus scheduled.md with the dated tasks. Edit them in any editor for bulk changes; lines without a ^id become new tasks, deleting a line deletes the task. Imports merge against the last exported state, so a file arriving from a folder-sync client never rolls back newer app-side edits or deletes tasks it did not know about."
          onChange={(v) => void updateConfig({ tasks_mirror: v })}
        />

        {config.tasks_mirror && (
          <div className="flex flex-col gap-3 pl-6">
            <Toggle
              checked={config.tasks_mirror_today}
              label="Read-only today.md day sheet"
              hint="A phone-readable summary of the day next to the other mirror files: focus phrase, reminders, schedule blocks, overdue and today's tasks grouped by category. Regenerated on every change; edits to it are ignored."
              onChange={(v) => void updateConfig({ tasks_mirror_today: v })}
            />

          </div>
        )}
      </SettingsGroup>

      <SettingsGroup id="data.backups">
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

        {backups && (
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <BackupList
              title="Database snapshots"
              hint="One VACUUM INTO copy of app.db per day. Restoring replaces every task, list and history entry with this snapshot's - the current database is copied aside first, so this can itself be undone by restoring the pre-restore snapshot it creates."
              entries={backups.db}
              disabled={restoring}
              onRestore={(entry) => setRestoreTarget({ kind: "db", entry })}
            />
            <BackupList
              title="Config file backups"
              hint="A copy of each config/settings file is kept before the app rewrites it. Restoring one puts that file's old content back in place."
              entries={backups.config}
              disabled={restoring}
              onRestore={(entry) => setRestoreTarget({ kind: "config", entry })}
            />
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup id="data.cleanup">
        <Field label="Retention of done one-off tasks, days (0 = keep forever)">
          <NumberInput
            value={config.retention_days}
            min={0}
            onCommit={(n) => void updateConfig({ retention_days: n })}
          />
        </Field>

        <Toggle
          checked={config.clear_done_list_tasks}
          label="Clear done list tasks at day rollover"
          hint="Tasks checked off in a list column are removed from the database once their completion day has passed - the list is a working queue, not history."
          onChange={(v) => void updateConfig({ clear_done_list_tasks: v })}
        />

        <div className="flex items-center gap-2">
          <button
            className="btn-danger w-fit px-3 py-1 text-xs"
            onClick={() => setConfirming(true)}
          >
            Delete all done tasks
          </button>
          {status && (
            <span className="text-xs text-content-muted">{status}</span>
          )}
        </div>

        {archived.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-content-muted">Archived lists</span>
            {archived.map((list) => (
              <div key={list.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{list.name}</span>
                <button
                  className="btn-ghost px-2 py-0.5 text-xs"
                  onClick={() => void unarchive(list.id)}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </SettingsGroup>

      {confirming && (
        <ConfirmModal
          title="Delete every task marked done?"
          message="This cannot be undone."
          onConfirm={() => void deleteDone()}
          onCancel={() => setConfirming(false)}
        />
      )}
      {restoreTarget && (
        <ConfirmModal
          title={
            restoreTarget.kind === "db"
              ? `Restore the database from ${restoreTarget.entry.label}?`
              : `Restore ${restoreTarget.entry.label} from ${restoreTarget.entry.modified}?`
          }
          message={
            restoreTarget.kind === "db"
              ? "Every task, list and history entry created after this snapshot will be gone. The current database is kept as its own snapshot first."
              : "The file currently on disk is kept as its own backup first."
          }
          confirmLabel="Restore"
          onConfirm={() => void confirmRestore()}
          onCancel={() => setRestoreTarget(null)}
        />
      )}
    </>
  );
}
