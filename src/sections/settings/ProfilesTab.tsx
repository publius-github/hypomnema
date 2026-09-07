import { useEffect, useState } from "react";
import { ConfirmModal } from "../../components/dialogs";
import { useAppStore } from "../../store";

/** Client-side mirror of the Rust name rules - the backend still has
 *  the final say. */
function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name";
  if (trimmed.length > 64) return "Too long (max 64)";
  if (trimmed.startsWith(".")) return "Cannot start with a dot";
  if (!/^[A-Za-z0-9 _.-]+$/.test(trimmed))
    return "Only letters, digits, space, _ - .";
  if (trimmed.toLowerCase() === "default")
    return '"Default" is the built-in profile';
  return null;
}

/**
 * Settings profiles: named snapshots of the visual settings (appearance
 * and layout - never paths, engine or data handling). The built-in
 * Default resets everything visual to factory values; app.yml is backed
 * up before any apply.
 */
export default function ProfilesTab() {
  const profiles = useAppStore((s) => s.profiles);
  const loadProfiles = useAppStore((s) => s.loadProfiles);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const deleteProfile = useAppStore((s) => s.deleteProfile);
  const applyProfile = useAppStore((s) => s.applyProfile);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<
    | { kind: "apply"; name: string }
    | { kind: "delete"; name: string }
    | { kind: "overwrite"; name: string }
    | null
  >(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const save = async (profileName: string) => {
    setConfirm(null);
    if (await saveProfile(profileName)) {
      setName("");
      setStatus(`Saved "${profileName}"`);
    }
  };

  const requestSave = () => {
    const trimmed = name.trim();
    if (nameProblem(trimmed)) return;
    if (profiles.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
      setConfirm({ kind: "overwrite", name: trimmed });
    } else {
      void save(trimmed);
    }
  };

  return (
    <>
      <p className="text-xs text-content-muted">
        A profile is a named snapshot of the visual settings - everything
        under Appearance and Layout. Applying one replaces those settings
        wholesale (a backup copy of app.yml lands in backups/config/
        first); behavior, folders, engine and notification settings are
        never part of a profile.
      </p>

      <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2">
        <span className="min-w-0 flex-1 text-sm">
          Default
          <span className="ml-2 text-xs text-content-muted">
            built-in factory look
          </span>
        </span>
        <button
          className="btn-ghost px-3 py-1 text-xs"
          onClick={() => setConfirm({ kind: "apply", name: "Default" })}
        >
          Reset to Default
        </button>
      </div>

      {profiles.map((profile) => (
        <div
          key={profile}
          className="flex items-center gap-2 rounded-md border border-line px-3 py-2"
        >
          <span className="min-w-0 flex-1 truncate text-sm">{profile}</span>
          <button
            className="btn-ghost px-3 py-1 text-xs"
            onClick={() => setConfirm({ kind: "apply", name: profile })}
          >
            Apply
          </button>
          <button
            className="btn-ghost px-3 py-1 text-xs text-content-muted hover:text-danger"
            onClick={() => setConfirm({ kind: "delete", name: profile })}
          >
            Delete
          </button>
        </div>
      ))}

      <div className="flex flex-col gap-1 pt-2">
        <span className="text-sm font-medium">Save current as profile</span>
        <div className="flex items-center gap-2">
          <input
            className="input w-64"
            placeholder="Profile name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setStatus(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") requestSave();
            }}
          />
          <button
            className="btn-primary px-3"
            disabled={nameProblem(name) !== null}
            onClick={requestSave}
          >
            Save
          </button>
        </div>
        <span className="text-xs text-content-muted">
          {name.trim() && nameProblem(name)
            ? nameProblem(name)
            : (status ??
              "Snapshots the current Appearance and Layout settings under this name.")}
        </span>
      </div>

      {confirm?.kind === "apply" && (
        <ConfirmModal
          title={
            confirm.name === "Default"
              ? "Reset all visual settings to their defaults?"
              : `Apply profile "${confirm.name}"?`
          }
          message="Replaces every Appearance and Layout setting. A backup copy of app.yml is written to backups/config/ first."
          onConfirm={() => {
            setConfirm(null);
            void applyProfile(confirm.name);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "delete" && (
        <ConfirmModal
          title={`Delete profile "${confirm.name}"?`}
          message="The saved snapshot is removed; current settings stay as they are."
          onConfirm={() => {
            setConfirm(null);
            void deleteProfile(confirm.name);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.kind === "overwrite" && (
        <ConfirmModal
          title={`Overwrite profile "${confirm.name}"?`}
          message="A profile with this name already exists and will be replaced by the current settings."
          onConfirm={() => void save(confirm.name)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
