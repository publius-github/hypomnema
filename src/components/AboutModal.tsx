import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

export default function AboutModal({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-xl border border-line bg-surface-alt p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">app-pkb</h2>
        <p className="mt-0.5 text-xs text-content-muted">
          {version ? `Version ${version}` : ""}
        </p>
        <p className="mt-3 text-sm text-content-muted">
          Local-first personal productivity app: weekly task planner with
          recurring rules, daily journal, and a Markdown knowledge base in
          one window. All data lives in your vault folder as plain files
          and a local database; nothing leaves your machine.
        </p>
        <button
          className="mt-4 w-full rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
