import MarkdownEditor from "../../components/MarkdownEditor";
import { useAppStore } from "../../store";
import type { OpenDoc } from "./util";

/** The right side of the Notes section: open-file header with the save
 *  status, config validation errors, and the CodeMirror editor. */
export default function EditorPane({
  current,
  saved,
  configErrors,
  lineNumbers,
  onChange,
}: {
  current: OpenDoc;
  saved: boolean;
  configErrors: { line: number | null; message: string }[];
  lineNumbers: boolean;
  onChange: (content: string) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 text-sm">
        <span className="truncate text-base font-semibold">
          {current.kind === "config" ? `config/${current.path}` : current.path}
        </span>
        {/* the gesture is not guessable, and a link that looks
            dead is the same as no link */}
        <span className="ml-auto shrink-0 text-xs text-content-muted">
          Ctrl/Cmd+click a link to open it
        </span>
        <span
          className={`text-xs ${
            configErrors.length > 0 ? "text-danger" : "text-content-muted"
          }`}
        >
          {configErrors.length > 0
            ? "Invalid, not saved"
            : saved
              ? "Saved"
              : "Saving..."}
        </span>
      </div>
      {configErrors.length > 0 && (
        <div className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-xs text-danger">
          {configErrors.map((err, i) => (
            <div key={i}>
              {err.line !== null ? `line ${err.line}: ` : ""}
              {err.message}
            </div>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <MarkdownEditor
          docKey={`${current.kind}:${current.path}`}
          value={current.content}
          onChange={onChange}
          mode={
            current.path.toLowerCase().endsWith(".md")
              ? "markdown"
              : /\.ya?ml$/i.test(current.path)
                ? "yaml"
                : "plain"
          }
          showLineNumbers={
            (current.kind === "config" && !current.path.endsWith(".md")) ||
            lineNumbers
          }
          onWikiLink={(name) =>
            void useAppStore.getState().openKbNoteByName(name)
          }
        />
      </div>
    </>
  );
}
