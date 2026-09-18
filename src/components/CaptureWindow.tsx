import { useEffect, useRef, useState } from "react";
import { errorMessage, invoke } from "../lib/ipc";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { warn } from "../lib/log";
import { errorKind } from "../lib/ipc";

/**
 * Body of the quick-capture window: one input, Enter files the title
 * into the capture list via capture_task, Escape hides the window.
 * Deliberately store-free - the main window owns all state; this one
 * only fires a command and goes away (the backend emits vault-updated
 * so the main window picks the task up).
 */
export default function CaptureWindow() {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // the main window owns applyTheme; this window only needs the
    // dark/light class so the surface tokens resolve
    const applyThemeClass = async () => {
      try {
        const config = await invoke("config_get");
        document.documentElement.classList.toggle(
          "dark",
          config.theme !== "light",
        );
      } catch (e) {
        // no vault yet: keep the default dark chrome
        if (errorKind(e) !== "no_vault") warn("capture theme", e);
      }
    };
    void applyThemeClass();
    const unlisten = listen("capture-shown", () => {
      setTitle("");
      setError(null);
      void applyThemeClass();
      inputRef.current?.focus();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const hide = () => {
    setTitle("");
    setError(null);
    void getCurrentWindow().hide();
  };

  const submit = async () => {
    const text = title.trim();
    if (!text) return;
    try {
      await invoke("capture_task", { title: text });
      hide();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div
      className="flex h-screen w-screen flex-col gap-2 border border-line bg-surface p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
      }}
    >
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          ref={inputRef}
          className="input w-full"
          placeholder="Capture a task..."
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="btn-primary px-3" type="submit">
          Add
        </button>
      </form>
      <span className="text-xs text-content-muted">
        {error ?? "Enter adds to the capture list - Esc closes"}
      </span>
    </div>
  );
}
