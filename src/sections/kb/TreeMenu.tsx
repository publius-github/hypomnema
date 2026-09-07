import { useEffect, useRef, useState } from "react";

export type MenuItem =
  | { separator: true }
  | {
      label: string;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      onClick: () => void;
    };

/**
 * IDE-style context menu for the file tree. Positioned at the cursor
 * and flipped back inside the window when it would overflow; any click
 * or Escape closes it, and picking an item runs its action first.
 */
export default function TreeMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onMouseDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        className="fixed z-50 min-w-[190px] rounded-md border border-line bg-surface py-1 shadow-xl"
        style={{ left: pos.left, top: pos.top }}
      >
        {items.map((item, i) =>
          "separator" in item ? (
            <div key={i} className="my-1 h-px bg-line" />
          ) : (
            <button
              key={i}
              disabled={item.disabled}
              className={`flex w-full items-center gap-4 px-3 py-1 text-left text-sm disabled:opacity-40 ${
                item.danger
                  ? "text-danger hover:bg-danger/10"
                  : "text-content hover:bg-line/40"
              }`}
              onClick={() => {
                onClose();
                item.onClick();
              }}
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && (
                <span className="shrink-0 text-[11px] text-content-muted">
                  {item.hint}
                </span>
              )}
            </button>
          ),
        )}
      </div>
    </>
  );
}
