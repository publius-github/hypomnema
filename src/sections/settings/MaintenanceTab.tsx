import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store";
import { ConfirmModal } from "../../components/dialogs";
import { Field, NumberInput } from "../../components/form";
import type { List } from "../../types";

export default function MaintenanceTab() {
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const [status, setStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [archived, setArchived] = useState<List[]>([]);

  const loadArchived = useCallback(async () => {
    try {
      setArchived(await invoke<List[]>("lists_archived"));
    } catch (e) {
      useAppStore.getState().setError(String(e));
    }
  }, []);

  useEffect(() => {
    void loadArchived();
  }, [loadArchived]);

  const deleteDone = async () => {
    setConfirming(false);
    try {
      const deleted = await invoke<number>("tasks_delete_done");
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

  return (
    <section className="flex flex-col gap-4">
      {config && (
        <Field label="Backups to keep (0 = disabled)">
          <NumberInput
            value={config.backup_keep}
            min={0}
            onCommit={(n) => void updateConfig({ backup_keep: n })}
          />
          <span className="text-xs text-content-muted">
            Daily snapshots of the task database plus a copy of each config
            file before the app rewrites it, stored under backups/ in the
            vault.
          </span>
        </Field>
      )}
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
      {confirming && (
        <ConfirmModal
          title="Delete every task marked done?"
          message="This cannot be undone."
          onConfirm={() => void deleteDone()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
