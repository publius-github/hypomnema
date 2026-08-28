import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store";
import type { ConfigError, DoneDisplay, Theme } from "../types";

const CONFIG_FILES = [
  "recurring.yml",
  "scheduled.yml",
  "birthdays.yml",
  "weekly-focus.yml",
  "day-reminders.yml",
  "day-schedule.yml",
];

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

      <section className="flex flex-col gap-1">
        <span className="text-sm font-medium">Knowledge Base folder</span>
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

      <ConfigFilesEditor />
    </div>
  );
}

function ConfigFilesEditor() {
  const [file, setFile] = useState(CONFIG_FILES[0]);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<ConfigError[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invoke<string>("config_file_get", { file }).then((text) => {
      if (!cancelled) {
        setContent(text);
        setDirty(false);
        setErrors([]);
        setStatus(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const save = async () => {
    try {
      const result = await invoke<ConfigError[]>("config_file_set", {
        file,
        content,
      });
      setErrors(result);
      if (result.length === 0) {
        setDirty(false);
        setStatus("Saved");
      } else {
        setStatus(null);
      }
    } catch (e) {
      useAppStore.setState({ error: String(e) });
    }
  };

  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <span className="text-sm font-medium">Config files</span>
      <p className="text-xs text-content-muted">
        Files are validated before saving; invalid content is not written.
        The YAML file stays the source of truth.
      </p>
      <div className="flex items-center gap-2">
        <select
          className="input"
          value={file}
          onChange={(e) => setFile(e.target.value)}
        >
          {CONFIG_FILES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          disabled={!dirty}
          onClick={() => void save()}
        >
          Validate and save
        </button>
        {status && !dirty && (
          <span className="text-xs text-content-muted">{status}</span>
        )}
      </div>
      {errors.length > 0 && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {errors.map((err, i) => (
            <div key={i}>
              {err.line !== null ? `line ${err.line}: ` : ""}
              {err.message}
            </div>
          ))}
        </div>
      )}
      <textarea
        className="input min-h-[220px] resize-y font-mono text-xs"
        spellCheck={false}
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setDirty(true);
        }}
      />
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
