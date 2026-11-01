import { useState } from "react";
import { useAppStore } from "../store";
import { useChecklistProgress } from "../hooks/useColumnSections";
import { ConfirmModal } from "./dialogs";
import Icon from "./icons";
import { DONE_SUB_PLATE } from "../lib/tasks";
import type { List } from "../types";

/**
 * A checklist's strip under its header, on the desktop column and the
 * phone's list screen: how much is ticked off (bar and n/m), a toggle
 * that hides the ticked items - what is left to pack - and Uncheck all,
 * the reset before the next round. The reset offers Undo through the
 * toast; with the toast turned off it asks first instead.
 */
export default function ChecklistStrip({
  list,
  phone = false,
}: {
  list: List;
  phone?: boolean;
}) {
  const { done, total } = useChecklistProgress(list);
  const hidden = useAppStore((s) => s.hideChecked.includes(list.id));
  const toggleHideChecked = useAppStore((s) => s.toggleHideChecked);
  const setListStatuses = useAppStore((s) => s.setListStatuses);
  const undoable = useAppStore((s) => (s.config?.undo_toast_seconds ?? 0) > 0);
  const [confirmReset, setConfirmReset] = useState(false);
  if (total === 0) return null;

  const complete = done === total;
  const reset = () => {
    if (undoable) void setListStatuses(list.id, false);
    else setConfirmReset(true);
  };
  const hideLabel = hidden ? "Show checked items" : "Hide checked items";
  const button = phone
    ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-content-muted disabled:opacity-40"
    : "shrink-0 text-content-muted hover:text-content disabled:opacity-40";
  const icon = phone ? "h-5 w-5" : "h-3.5 w-3.5";

  return (
    <div
      className={`flex items-center ${
        phone ? "gap-2 border-b border-line px-4 py-1" : "gap-2 px-2.5 pb-1.5"
      }`}
    >
      <div
        role="progressbar"
        aria-label="Checked off"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line"
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${(done / total) * 100}%`,
            // the subtasks' folded Done plate tone: the full done green
            // is too loud for a bar that sits on every checklist
            backgroundColor: DONE_SUB_PLATE.color,
          }}
        />
      </div>
      <span
        className={`shrink-0 tabular-nums ${phone ? "text-sm" : "text-xs"} ${
          complete ? "font-semibold" : "text-content-muted"
        }`}
        style={complete ? { color: DONE_SUB_PLATE.color } : undefined}
        title={`${done} of ${total} checked`}
      >
        {done}/{total}
      </span>
      <button
        className={`${button} ${hidden ? "text-accent" : ""}`}
        title={hideLabel}
        aria-label={hideLabel}
        aria-pressed={hidden}
        onClick={() => toggleHideChecked(list.id)}
      >
        <Icon name={hidden ? "eyeOff" : "eye"} className={icon} />
      </button>
      <button
        className={button}
        title="Uncheck all: reset the list for the next round"
        aria-label="Uncheck all"
        disabled={done === 0}
        onClick={reset}
      >
        <Icon name="reset" className={icon} />
      </button>
      {confirmReset && (
        <ConfirmModal
          title={`Uncheck all of "${list.name}"?`}
          message={`${done} checked ${done === 1 ? "item goes" : "items go"} back to unchecked.`}
          confirmLabel="Uncheck all"
          onConfirm={() => {
            setConfirmReset(false);
            void setListStatuses(list.id, false);
          }}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
