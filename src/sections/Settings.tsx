import { useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store";
import type { DoneDisplay, Theme } from "../types";

export default function Settings() {
  const { vaultPath, config, updateConfig } = useAppStore();

  if (!config) return null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="flex flex-col gap-1">
        <span className="text-sm font-medium">Vault</span>
        <span className="select-text text-sm text-content-muted">
          {vaultPath}
        </span>
      </section>

      <Field label="Theme">
        <select
          className="input"
          value={config.theme}
          onChange={(e) =>
            void updateConfig({ theme: e.target.value as Theme })
          }
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </Field>

      <Field label="Week grid columns (today + following days)">
        <select
          className="input"
          value={config.grid_columns}
          onChange={(e) =>
            void updateConfig({ grid_columns: Number(e.target.value) })
          }
        >
          {[3, 5, 7, 10].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Done tasks display">
        <select
          className="input"
          value={config.done_display}
          onChange={(e) =>
            void updateConfig({
              done_display: e.target.value as DoneDisplay,
            })
          }
        >
          <option value="inline">Inline with active tasks</option>
          <option value="separate">Separate block per day</option>
        </select>
      </Field>

      <Field label="Retention of done one-off tasks, days (0 = keep forever)">
        <input
          className="input"
          type="number"
          min={0}
          value={config.retention_days}
          onChange={(e) =>
            void updateConfig({
              retention_days: Math.max(0, Number(e.target.value) || 0),
            })
          }
        />
      </Field>

      <Field label="Recurring catch-up window, days">
        <input
          className="input"
          type="number"
          min={1}
          value={config.catchup_days}
          onChange={(e) =>
            void updateConfig({
              catchup_days: Math.max(1, Number(e.target.value) || 1),
            })
          }
        />
      </Field>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={config.cron_ignore_time}
          onChange={(e) =>
            void updateConfig({ cron_ignore_time: e.target.checked })
          }
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium">
            Catch up recurring crons by calendar day
          </span>
          <span className="text-xs text-content-muted">
            The firing time is ignored: a rule like 0 0 * * 1 counts as
            missed for the whole Monday, as if it fired at 23:59.
          </span>
        </span>
      </label>

      <section className="flex flex-col gap-1">
        <span className="text-sm font-medium">Notes folder</span>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 select-text truncate text-sm text-content-muted">
            {config.kb_path || "Not set"}
          </span>
          <button
            className="rounded-md border border-line px-3 py-1 text-xs hover:border-accent hover:text-accent"
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
        <button
          className="w-fit rounded-md border border-line px-3 py-1 text-xs hover:border-accent hover:text-accent"
          onClick={() => useAppStore.getState().setSection("journal")}
        >
          Edit in Journal
        </button>
      </section>

      <section className="flex flex-col gap-1 border-t border-line pt-4">
        <span className="text-sm font-medium">Config files</span>
        <p className="text-xs text-content-muted">
          recurring.yml, scheduled.yml and the other config files are edited
          in Notes under the Config group, with validation on save.
        </p>
        <button
          className="w-fit rounded-md border border-line px-3 py-1 text-xs hover:border-accent hover:text-accent"
          onClick={() => useAppStore.getState().setSection("kb")}
        >
          Open in Notes
        </button>
      </section>

      <DebugSection />
    </div>
  );
}

function DebugSection() {
  const [status, setStatus] = useState<string | null>(null);

  const deleteDone = async () => {
    if (!confirm("Delete every task marked done? This cannot be undone.")) {
      return;
    }
    try {
      const deleted = await invoke<number>("tasks_delete_done");
      setStatus(`Deleted ${deleted} done task(s)`);
      await useAppStore.getState().refresh();
    } catch (e) {
      useAppStore.setState({ error: String(e) });
    }
  };

  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <span className="text-sm font-medium">Debug</span>
      <div className="flex items-center gap-2">
        <button
          className="w-fit rounded-md border border-red-500/50 px-3 py-1 text-xs text-red-500 hover:bg-red-500/10"
          onClick={() => void deleteDone()}
        >
          Delete all done tasks
        </button>
        {status && (
          <span className="text-xs text-content-muted">{status}</span>
        )}
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
