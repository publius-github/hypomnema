import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A scroll thumb for a phone screen.
 *
 * The Android WebView draws no scrollbar of its own, so in a long note
 * there is nothing to say where in the document the screen is. This wraps
 * a scrolling child, finds it by `selector` (the reader's CodeMirror
 * scroller is created after a lazy chunk loads, so it is looked for as
 * the subtree changes) and draws a thumb over the right edge: it shows
 * while scrolling and fades after a moment, and can be dragged to jump.
 *
 * It also remembers where each scroller was left: `memory` maps a key to
 * the last scrollTop, which is put back when the scroller is found again,
 * e.g. after a trip to another tab unmounted the screen.
 */

const MIN_THUMB = 32;
const HIDE_AFTER_MS = 1200;

export type ScrollMemory = Map<string, number>;

export default function ScrollThumb({
  selector,
  memoryKey,
  memory,
  children,
  className = "",
}: {
  /** CSS selector of the scrolling element inside the wrapper. */
  selector: string;
  memoryKey?: string;
  memory?: ScrollMemory;
  children: ReactNode;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(
    null,
  );
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const dragging = useRef(false);

  const memoryRef = useRef({ memoryKey, memory });
  memoryRef.current = { memoryKey, memory };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const measure = () => {
      const el = scrollerRef.current;
      if (!el) return;
      const range = el.scrollHeight - el.clientHeight;
      if (range <= 1 || el.clientHeight === 0) {
        setThumb(null);
        return;
      }
      const track = el.clientHeight;
      const height = Math.max(MIN_THUMB, (track * track) / el.scrollHeight);
      setThumb({ top: (el.scrollTop / range) * (track - height), height });
    };

    const reveal = () => {
      setVisible(true);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        if (!dragging.current) setVisible(false);
      }, HIDE_AFTER_MS);
    };

    const onScroll = (event: Event) => {
      const el = scrollerRef.current;
      if (!el || event.target !== el) return;
      const { memoryKey: key, memory: store } = memoryRef.current;
      if (key && store) store.set(key, el.scrollTop);
      measure();
      reveal();
    };

    // The scroller's height settles after first paint (CodeMirror
    // estimates line heights and corrects them), so the saved position is
    // retried for a few frames until it sticks.
    const restore = (el: HTMLElement) => {
      const { memoryKey: key, memory: store } = memoryRef.current;
      const want = key && store ? store.get(key) : undefined;
      if (!want) return;
      let tries = 0;
      const step = () => {
        if (scrollerRef.current !== el) return;
        el.scrollTop = want;
        if (Math.abs(el.scrollTop - want) > 1 && ++tries < 20) {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    };

    // absent in the test DOM; the thumb then follows scrolling only
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const find = () => {
      const el = wrap.querySelector<HTMLElement>(selector);
      if (el === scrollerRef.current) return;
      resizeObserver?.disconnect();
      scrollerRef.current = el;
      if (!el) {
        setThumb(null);
        return;
      }
      resizeObserver?.observe(el);
      for (const child of Array.from(el.children)) resizeObserver?.observe(child);
      measure();
      restore(el);
    };

    // scroll events do not bubble; the capture phase sees every scroller
    wrap.addEventListener("scroll", onScroll, true);
    const mutations = new MutationObserver(find);
    mutations.observe(wrap, { childList: true, subtree: true });
    find();

    return () => {
      wrap.removeEventListener("scroll", onScroll, true);
      mutations.disconnect();
      resizeObserver?.disconnect();
      window.clearTimeout(hideTimer.current);
    };
  }, [selector]);

  const drag = useRef<{ y: number; top: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!el) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, top: el.scrollTop };
    dragging.current = true;
    setVisible(true);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!el || !drag.current || !thumb) return;
    const range = el.scrollHeight - el.clientHeight;
    const travel = el.clientHeight - thumb.height;
    if (travel <= 0) return;
    el.scrollTop = drag.current.top + ((event.clientY - drag.current.y) / travel) * range;
  };
  const onPointerUp = () => {
    drag.current = null;
    dragging.current = false;
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setVisible(false), HIDE_AFTER_MS);
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      {children}
      {thumb && (
        // a 24px-wide touch target with a 4px thumb drawn inside it
        <div
          aria-hidden
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            top: thumb.top,
            height: thumb.height,
            touchAction: "none",
          }}
          className={`absolute right-0 flex w-6 justify-end pr-0.5 transition-opacity duration-300 ${
            visible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <div className="h-full w-1 rounded-full bg-content-muted/70" />
        </div>
      )}
    </div>
  );
}
