import { useCallback, useEffect, useState } from "react";
import { invoke } from "../../lib/ipc";
import { useAppStore } from "../../store";
import { ConfirmModal } from "../../components/dialogs";
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

export default function MaintenanceTab() {
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
      useAppStore.getState().setError(String(e));
    }
  }, []);

  const loadBackups = useCallback(async () => {
    try {
      setBackups(await invoke("backups_list"));
    } catch (e) {
      useAppStore.getState().setError(String(e));
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
      useAppStore.getState().setError(String(e));
    }
  };

  const restore = async (id: number) => {
    try {
      await invoke("list_unarchive", { id });
      await loadArchived();
      await useAppStore.getState().refresh();
    } catch (e) {
      useAppStore.getState().setError(String(e));
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
        const config = await invoke("backup_restore_db", {
          id: entry.id,
        });
        useAppStore.setState({ config });
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
      useAppStore.getState().setError(String(e));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
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
                onClick={() => void restore(list.id)}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
      {backups && (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <BackupList
            title="Database snapshots"
            hint="One VACUUM INTO copy of app.db per day, kept per Files > Backups. Restoring replaces every task, list and history entry with this snapshot's - the current database is copied aside first, so this can itself be undone by restoring the pre-restore snapshot it creates."
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
    </section>
  );
}
