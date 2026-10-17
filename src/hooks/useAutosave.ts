import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { serialSaves, type SaveState } from "../sections/kb/util";

/** How long typing has to pause before it is saved, per UI (the phone
 *  editors have always waited a little longer). */
export const AUTOSAVE_DELAY_MS = { desktop: 800, mobile: 1200 } as const;

export interface Autosave<T> {
  saveState: SaveState;
  /** `saveState === "saved"` as of the last render, for listeners that
   *  must not re-subscribe on every keystroke */
  savedRef: RefObject<boolean>;
  /** an edit: marks the editor dirty and saves it once typing pauses */
  schedule: (item: T) => void;
  /** saves the edit still in the debounce now (switching documents,
   *  leaving, Retry); awaited before a read so it never sees the
   *  pre-save file */
  flush: () => Promise<void>;
  /** forgets the waiting edit when `match` says it is the one (a rename
   *  or delete of its file - saving it afterwards would recreate it) */
  drop: (match: (item: T) => boolean) => void;
  /** a document was (re)loaded: nothing of it is unsaved, and a save
   *  still in flight for the previous one must not mark this one saved */
  loaded: () => void;
}

/**
 * The autosave every editor shares (desktop Notes and Journal, their
 * phone screens). Saves run one at a time in order (`serialSaves`), each
 * numbered: a save only marks the editor saved when nothing was typed
 * after the text it carried. A failed save is kept for the next flush
 * unless newer typing already replaced it, and whatever is still waiting
 * is saved when the editor unmounts.
 *
 * `save` writes one edit; it returns false when the edit was refused
 * without failing (invalid YAML: reported, not written), which leaves the
 * editor dirty. It is read through a ref, so it may close over the
 * latest render.
 */
export function useAutosave<T>(
  save: (item: T) => Promise<boolean | void>,
  onError: (e: unknown) => void,
  delayMs: number,
): Autosave<T> {
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const savedRef = useRef(true);
  savedRef.current = saveState === "saved";
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ item: T; gen: number } | null>(null);
  const editGen = useRef(0);
  const queueSave = useRef(serialSaves()).current;
  const saveRef = useRef(save);
  saveRef.current = save;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const flush = useCallback(async () => {
    clearTimer();
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    await queueSave(async () => {
      try {
        const written = await saveRef.current(job.item);
        if (written !== false && job.gen === editGen.current) {
          setSaveState("saved");
        }
      } catch (e) {
        if (!pending.current) pending.current = job;
        if (job.gen === editGen.current) setSaveState("failed");
        onErrorRef.current(e);
      }
    });
  }, [queueSave]);

  const schedule = useCallback(
    (item: T) => {
      setSaveState("dirty");
      pending.current = { item, gen: ++editGen.current };
      clearTimer();
      timer.current = setTimeout(() => void flush(), delayMs);
    },
    [flush, delayMs],
  );

  const drop = useCallback((match: (item: T) => boolean) => {
    if (!pending.current || !match(pending.current.item)) return;
    clearTimer();
    pending.current = null;
  }, []);

  const loaded = useCallback(() => {
    editGen.current++;
    setSaveState("saved");
  }, []);

  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);

  return { saveState, savedRef, schedule, flush, drop, loaded };
}
