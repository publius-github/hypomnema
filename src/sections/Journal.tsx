import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { todayISO } from "../lib/tasks";
import MarkdownEditor from "../components/MarkdownEditor";

interface OpenDoc {
  kind: "entry" | "template";
  date: string; // entry date, or "template"
  content: string;
}

export default function Journal() {
  const setError = useCallback(
    (e: unknown) => useAppStore.setState({ error: String(e) }),
    [],
  );
  const [dates, setDates] = useState<string[]>([]);
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  const [saved, setSaved] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDates = useCallback(async () => {
    try {
      setDates(await invoke<string[]>("journal_list"));
    } catch (e) {
      setError(e);
    }
  }, [setError]);

  const openEntry = useCallback(
    async (date: string) => {
      try {
        const entry = await invoke<{ date: string; content: string }>(
          "journal_open",
          { date },
        );
        setDoc({ kind: "entry", date: entry.date, content: entry.content });
        setSaved(true);
        await loadDates();
      } catch (e) {
        setError(e);
      }
    },
    [loadDates, setError],
  );

  const openTemplate = useCallback(async () => {
    try {
      const content = await invoke<string>("journal_template_get");
      setDoc({ kind: "template", date: "template", content });
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  }, [setError]);

  useEffect(() => {
    void openEntry(todayISO());
    // open Today once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // autosave with debounce; flush on unmount
  const scheduleSave = (content: string) => {
    if (!doc) return;
    setDoc({ ...doc, content });
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const target = doc;
    saveTimer.current = setTimeout(() => {
      void persist(target.kind, target.date, content);
    }, 800);
  };

  const persist = async (
    kind: OpenDoc["kind"],
    date: string,
    content: string,
  ) => {
    try {
      if (kind === "template") {
        await invoke("journal_template_set", { content });
      } else {
        await invoke("journal_save", { date, content });
      }
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const today = todayISO();

  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-surface-alt/50">
        <div className="flex flex-col gap-1 p-3">
          <button
            className="rounded-md bg-accent px-3 py-1.5 text-left text-sm font-medium text-white hover:opacity-90"
            onClick={() => void openEntry(today)}
          >
            Today
          </button>
          <button
            className="rounded-md px-3 py-1.5 text-left text-sm text-content-muted hover:bg-line/40 hover:text-content"
            onClick={() => void openTemplate()}
          >
            Edit template
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <div className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-content-muted">
            Entries
          </div>
          {dates.map((date) => (
            <button
              key={date}
              className={`block w-full rounded px-2 py-1 text-left text-sm ${
                doc?.kind === "entry" && doc.date === date
                  ? "bg-accent/15 text-accent"
                  : "text-content-muted hover:bg-line/40 hover:text-content"
              }`}
              onClick={() => void openEntry(date)}
            >
              {date}
              {date === today && " (today)"}
            </button>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {doc ? (
          <>
            <div className="flex items-center justify-between border-b border-line px-4 py-2 text-sm">
              <span className="font-medium">
                {doc.kind === "template" ? "Journal template" : doc.date}
              </span>
              <span className="text-xs text-content-muted">
                {saved ? "Saved" : "Saving..."}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <MarkdownEditor
                docKey={`${doc.kind}:${doc.date}`}
                value={doc.content}
                onChange={scheduleSave}
              />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-content-muted">
            Loading...
          </div>
        )}
      </div>
    </div>
  );
}
