import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "../lib/ipc";
import { COPYRIGHT, LICENSE_URL } from "../lib/legal";
import AppLogo from "./AppLogo";
import ProblemReport from "./ProblemReport";

export default function AboutModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="About Hypomnema"
        className="w-80 rounded-xl border border-line bg-surface-alt p-6 shadow-xl"
      >
        <AboutContent />
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

/** The app's version, read once from the binary. */
export function useAppVersion(): string {
  const [version, setVersion] = useState("");
  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);
  return version;
}

/** The About text itself: the desktop dialog and the phone's Settings
 * panel show the same thing. */
export function AboutContent() {
  const version = useAppVersion();
  return (
    <>
      <div className="flex flex-col items-center text-center">
        <AppLogo size={88} />
        <h2 className="mt-3 font-serif text-3xl leading-tight">Hypomnema</h2>
        <p className="mt-1 text-[11px] uppercase tracking-[0.3em] text-content-muted">
          Your mind, organized.
        </p>
        <p className="mt-1 text-xs text-content-muted">
          {version ? `Version ${version}` : ""}
        </p>
      </div>
      <p className="mt-3 text-sm text-content-muted">
        Hypomnema (Greek ὑπόμνημα) is the
        notebook the ancient Greeks kept at hand: notes, reminders, and
        reflections collected for one's own use. This one is the same
        idea in software - a weekly planner with recurring rules, a
        daily journal, and Markdown notes in a single window.
      </p>
      <p className="mt-2 text-sm text-content-muted">
        Everything lives in your vault folder as plain files and a local
        database. Nothing is sent to the developer - no account, no
        telemetry. Google Drive sync, when you turn it on, moves the vault
        between your own devices through your own Drive; the desktop app
        also asks GitHub whether an update is out.
      </p>
      <div className="mt-3 border-t border-line pt-3">
        <ProblemReport version={version} />
      </div>
      <LegalNotice />
    </>
  );
}

/** Copyright, the GPL's no-warranty notice and the third-party license
 * texts - the "appropriate legal notices" an interactive program shows. */
function LegalNotice() {
  const [licenses, setLicenses] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const show = () => {
    setError(false);
    void invoke("third_party_licenses")
      .then(setLicenses)
      .catch(() => setError(true));
  };
  return (
    <div className="mt-3 border-t border-line pt-3 text-xs text-content-muted">
      <p>{COPYRIGHT}</p>
      <p className="mt-1">
        Free software under the GNU General Public License v3 (
        <span className="select-text">{LICENSE_URL}</span>), provided
        with ABSOLUTELY NO WARRANTY.
      </p>
      {licenses === null ? (
        <button
          className="mt-2 underline hover:text-content"
          onClick={show}
        >
          {error ? "Could not load - retry" : "Third-party licenses"}
        </button>
      ) : (
        <pre className="mt-2 max-h-64 select-text overflow-auto whitespace-pre-wrap wrap-break-word rounded-sm border border-line p-2 text-[10px] leading-snug">
          {licenses}
        </pre>
      )}
    </div>
  );
}
