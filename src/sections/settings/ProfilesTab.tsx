import { useEffect, useState } from "react";
import { ConfirmModal } from "../../components/dialogs";
import { useAppStore } from "../../store";
import {
  SETTINGS_TABS,
  profileGroups,
  type SettingsGroupId,
  type SettingsTab,
} from "../../lib/settingsCatalog";

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
 * Settings profiles: named snapshots of the visual settings - never
 * paths, recurring parameters or data handling. The built-in Default
 * resets everything visual to factory values; app.yml is backed up
 * before any apply.
 *
 * The scope cuts across the tabs (a group can be visual in part and
 * behavioral in the rest), so the page spells it out instead of leaving
 * the user to infer it: the covered groups are listed here, each one is
 * marked in place on its own tab, and both read the Rust PROFILE_KEYS
 * through `profile_scope`.
 */
export default function ProfilesTab({
  onJump,
}: {
  onJump: (tab: SettingsTab, group: SettingsGroupId) => void;
}) {
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
  const profileKeys = useAppStore((s) => s.profileKeys);
  const covered = profileGroups(profileKeys);

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
        A profile is a named snapshot of the visual settings. Applying one
        replaces every setting it covers wholesale (a backup copy of
        app.yml lands in backups/config/ first); folders, data handling,
        recurring parameters, notifications and the interaction timings
        are never part of a profile.
      </p>

      {covered.length > 0 && (
        <section className="flex flex-col gap-1 rounded-md border border-line px-3 py-2">
          <span className="text-xs font-medium text-content-muted">
            A profile covers
          </span>
          <div className="flex flex-wrap gap-1">
            {covered.map((group) => (
              <button
                key={group.id}
                className="btn-ghost px-2 py-0.5 text-xs"
                title={
                  group.partial
                    ? "Part of this group is visual and covered; the rest is behavior and stays as it is."
                    : "Every field in this group is saved and replaced by a profile."
                }
                onClick={() => onJump(group.tab, group.id)}
              >
                {SETTINGS_TABS.find((t) => t.id === group.tab)?.label} ›{" "}
                {group.title}
                {group.partial && (
                  <span className="ml-1 text-content-muted">(partly)</span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

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
              "Snapshots the settings listed above under this name.")}
        </span>
      </div>

      {confirm?.kind === "apply" && (
        <ConfirmModal
          title={
            confirm.name === "Default"
              ? "Reset all visual settings to their defaults?"
              : `Apply profile "${confirm.name}"?`
          }
          message="Replaces every setting a profile covers. A backup copy of app.yml is written to backups/config/ first."
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
