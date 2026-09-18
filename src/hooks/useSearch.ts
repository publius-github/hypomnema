import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage, invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import type { JournalSearchHit, KbSearchHit, Task } from "../types";

export interface SearchResults {
  query: string;
  setQuery: (q: string) => void;
  tasks: Task[];
  notes: KbSearchHit[];
  journal: JournalSearchHit[];
  /** false until the first non-empty query has answered */
  searched: boolean;
  /** search the current query again (after an action changed a hit) */
  rerun: () => void;
}

/**
 * One query over tasks, notes and journal, debounced, shared by the
 * desktop palette and the phone's search screen. Responses can
 * interleave even with the debounce, so only the newest request may set
 * the result lists. Tasks failing is an error worth surfacing; notes and
 * journal quietly return nothing when unavailable (KB not configured
 * yet). `onResults` runs after every landed search (the desktop resets
 * its keyboard highlight there).
 */
export function useSearch(onResults?: () => void): SearchResults {
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<KbSearchHit[]>([]);
  const [journal, setJournal] = useState<JournalSearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const searchSeq = useRef(0);
  const onResultsRef = useRef(onResults);
  onResultsRef.current = onResults;

  const runSearch = useCallback(async (q: string) => {
    const seq = ++searchSeq.current;
    if (!q) {
      setTasks([]);
      setNotes([]);
      setJournal([]);
      setSearched(false);
      return;
    }
    const [taskHits, noteHits, journalHits] = await Promise.all([
      invoke("tasks_search", { query: q }).catch((e) => {
        useAppStore.getState().setError(errorMessage(e));
        return [] as Task[];
      }),
      invoke("kb_search", { query: q }).catch(() => [] as KbSearchHit[]),
      invoke("journal_search", { query: q }).catch(
        () => [] as JournalSearchHit[],
      ),
    ]);
    if (seq !== searchSeq.current) return;
    setTasks(taskHits);
    setNotes(noteHits);
    setJournal(journalHits);
    setSearched(true);
    onResultsRef.current?.();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const rerun = useCallback(() => void runSearch(query.trim()), [query, runSearch]);

  return { query, setQuery, tasks, notes, journal, searched, rerun };
}
