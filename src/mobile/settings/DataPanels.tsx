import { useCallback, useEffect, useState } from "react";
import { errorMessage, invoke } from "../../lib/ipc";
import { useAppStore } from "../../store";
import { ConfirmModal } from "../../components/dialogs";
import { useBackStep } from "../back";
import MobileVaultFolder from "../MobileVaultFolder";
import type { BackupEntry, BackupsOverview, List } from "../../types";
import { ActionRow, Section } from "./rows";

/**
 * The desktop Data tab's cleanup and restores, sized for a thumb: delete-done sweep,
 * archived-list restore, and the restore lists for both backup kinds.
 * Destructive actions confirm through the in-app ConfirmModal (the
 * WebView's native confirm is unstyled and, on Android, easy to dismiss
 * by accident); the dialog names what it is about to do.
 */
export function MaintenancePanel() {
  const setError = useAppStore((s) => s.setError);
  const [archived, setArchived] = useState<List[]>([]);
  const [backups, setBackups] = useState<BackupsOverview | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    label: string;
    run: () => void;
  } | null>(null);

  const load = useCallback(() => {
    void invoke("lists_archived")
      .then(setArchived)
      .catch((e) => setError(errorMessage(e)));
    void invoke("backups_list")
      .then(setBackups)
      .catch((e) => setError(errorMessage(e)));
  }, [setError]);

  useEffect(load, [load]);

  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    try {
      await run();
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteDone = () =>
    setConfirm({
      title: "Delete every task marked done?",
      message: "This cannot be undone.",
      label: "Delete",
      run: () =>
        void act(async () => {
          const deleted = await invoke("tasks_delete_done");
          setStatus(`Deleted ${deleted} done task(s)`);
          await useAppStore.getState().refresh();
        }),
    });

  const restoreList = (id: number) =>
    void act(async () => {
      await invoke("list_unarchive", { id });
      await useAppStore.getState().refresh();
    });

  const restoreDb = (entry: BackupEntry) =>
    setConfirm({
      title: `Restore the database from ${entry.label}?`,
      message:
        "Everything created after it will be gone. The current database is kept as its own snapshot first.",
      label: "Restore",
      run: () =>
        void act(async () => {
          // the whole database is being swapped: reload config, then rerun
          // the engine and refetch every view, same as opening a vault
          const config = await invoke("backup_restore_db", {
            id: entry.id,
          });
          useAppStore.setState({ config });
          await useAppStore.getState().runEngine();
          await useAppStore.getState().refresh();
          setStatus(`Restored database from ${entry.label}`);
        }),
    });

  const restoreConfig = (entry: BackupEntry) =>
    setConfirm({
      title: `Restore ${entry.label} from ${entry.modified}?`,
      message: "The file currently on disk is kept as its own backup first.",
      label: "Restore",
      run: () =>
        void act(async () => {
          await invoke("backup_restore_config", { id: entry.id });
          setStatus(`Restored ${entry.label} - changes apply in a moment`);
        }),
    });

  const restoreLabel = (
    <span className="text-sm text-accent">Restore</span>
  );

  const backupSection = (
    title: string,
    entries: BackupEntry[],
    onRestore: (entry: BackupEntry) => void,
  ) => (
    <Section title={title}>
      {entries.length === 0 ? (
        <p className="px-4 py-3 text-sm text-content-muted">
          No snapshots yet.
        </p>
      ) : (
        entries.map((entry) => (
          <ActionRow
            key={entry.id}
            label={entry.label}
            hint={entry.modified}
            disabled={busy}
            trailing={restoreLabel}
            onClick={() => onRestore(entry)}
          />
        ))
      )}
    </Section>
  );

  return (
    <>
      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            confirm.run();
          }}
        />
      )}
      {status && (
        <p className="px-4 pt-4 text-sm text-content-muted" role="status">
          {status}
        </p>
      )}
      <Section title="Cleanup">
        <ActionRow
          label="Delete all done tasks"
          danger
          disabled={busy}
          trailing={null}
          onClick={deleteDone}
        />
      </Section>
      {archived.length > 0 && (
        <Section title="Archived lists">
          {archived.map((list) => (
            <ActionRow
              key={list.id}
              label={list.name}
              disabled={busy}
              trailing={restoreLabel}
              onClick={() => restoreList(list.id)}
            />
          ))}
        </Section>
      )}
      {backups && (
        <>
          {backupSection("Database snapshots", backups.db, restoreDb)}
          {backupSection("Config file backups", backups.config, restoreConfig)}
        </>
      )}
    </>
  );
}

export function VaultPanel({ vaultPath }: { vaultPath: string | null }) {
  const [folder, setFolder] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  // hardware back closes the vault-folder chooser before leaving the panel
  useBackStep(folder, () => setFolder(false));
  // The app's own folder on Android goes with the app when it is
  // uninstalled; a copy in Downloads does not. Said next to the button
  // that makes one, where the question "and if I delete the app?" is
  // actually asked.
  const exportVault = async () => {
    setExporting(true);
    setExported(null);
    setExportError(null);
    try {
      setExported(await invoke("vault_export", { target: null }));
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };
  return (
    <>
      <Section
        title="Location"
        footer="The vault lives on this device. Its database is rebuilt here from the text files and is never uploaded."
      >
        <p className="break-all px-4 py-3 text-sm">{vaultPath ?? "none"}</p>
        <ActionRow
          label="Move to another folder"
          onClick={() => setFolder(true)}
        />
      </Section>
      <Section
        title="Copy"
        footer={
          exportError ? (
            <span className="text-danger" role="alert">
              {exportError}
            </span>
          ) : exported ? (
            <span role="status">Saved as {exported}</span>
          ) : undefined
        }
      >
        <ActionRow
          label={exporting ? "Saving..." : "Save a copy to Downloads"}
          hint="A vault in the app's own folder is deleted with the app"
          disabled={exporting || !vaultPath}
          trailing={null}
          onClick={() => void exportVault()}
        />
      </Section>
      {folder && (
        <MobileVaultFolder
          onChosen={() => setFolder(false)}
          onCancel={() => setFolder(false)}
        />
      )}
    </>
  );
}
