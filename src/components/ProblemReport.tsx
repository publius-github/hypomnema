import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { errorMessage, invoke } from "../lib/ipc";

const NEW_ISSUE_URL =
  "https://github.com/publius-github/hypomnema/issues/new?template=bug_report.yml";

/**
 * "Something is wrong" tools, shared by About and the crash screen: copy
 * the diagnostics (version, platform, the log's tail) to the clipboard,
 * show the log file, open a prefilled bug report. Nothing is sent by the
 * app itself - the user reads what they copied and pastes it.
 */
export default function ProblemReport({ version }: { version: string }) {
  const [isMobile, setIsMobile] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void invoke("platform_is_mobile")
      .then(setIsMobile)
      .catch(() => {});
  }, []);

  const copy = async () => {
    try {
      const text = await invoke("diagnostics");
      await navigator.clipboard.writeText(text);
      setNote("Diagnostics copied - check them, then paste into the report.");
    } catch (e) {
      setNote(`Could not copy: ${errorMessage(e)}`);
    }
  };

  const reveal = async () => {
    try {
      await invoke("log_reveal");
      setNote(null);
    } catch (e) {
      setNote(errorMessage(e));
    }
  };

  const report = async () => {
    const url = version
      ? `${NEW_ISSUE_URL}&version=${encodeURIComponent(version)}`
      : NEW_ISSUE_URL;
    try {
      await openUrl(url);
    } catch (e) {
      setNote(`Could not open the browser: ${errorMessage(e)}`);
    }
  };

  return (
    <div className="text-xs text-content-muted">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <button className="underline hover:text-content" onClick={() => void copy()}>
          Copy diagnostics
        </button>
        {!isMobile && (
          <button className="underline hover:text-content" onClick={() => void reveal()}>
            Show log file
          </button>
        )}
        <button className="underline hover:text-content" onClick={() => void report()}>
          Report a problem
        </button>
      </div>
      {note && <p className="mt-1">{note}</p>}
    </div>
  );
}
