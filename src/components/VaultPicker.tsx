import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store";

export default function VaultPicker() {
  const { selectVault, error, clearError } = useAppStore();

  const pick = async () => {
    clearError();
    const path = await open({
      directory: true,
      title: "Select vault folder",
    });
    if (typeof path === "string") {
      await selectVault(path);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <h1 className="text-2xl font-semibold">Welcome to Hypomnema</h1>
      <p className="max-w-md text-content-muted">
        Choose a vault folder. It will hold the task database, journal
        entries, and configuration files. Back up or sync this one folder to
        capture everything.
      </p>
      <button
        onClick={() => void pick()}
        className="rounded-lg bg-accent px-5 py-2.5 font-medium text-white hover:opacity-90"
      >
        Select vault folder
      </button>
      {error && <p className="max-w-md text-sm text-red-500">{error}</p>}
    </div>
  );
}
