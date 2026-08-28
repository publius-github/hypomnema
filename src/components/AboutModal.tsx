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
        <h2 className="text-lg font-semibold">Hypomnema</h2>
        <p className="mt-0.5 text-xs text-content-muted">
          {version ? `Version ${version}` : ""}
        </p>
        <p className="mt-3 text-sm text-content-muted">
          Hypomnema (Greek ὑπόμνημα) is the
          notebook the ancient Greeks kept at hand: notes, reminders, and
          reflections collected for one's own use. This one is the same
          idea in software - a weekly planner with recurring rules, a
          daily journal, and Markdown notes in a single window.
        </p>
        <p className="mt-2 text-sm text-content-muted">
          Everything lives in your vault folder as plain files and a local
          database; nothing leaves your machine.
        </p>
        <button
          className="btn-primary mt-4 w-full"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
