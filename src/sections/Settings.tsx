import type { ReactNode } from "react";
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
          {[5, 7, 10].map((n) => (
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
    </div>
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
