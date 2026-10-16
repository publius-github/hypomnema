import { useEffect, useState } from "react";
import { invoke } from "../lib/ipc";
import { useAppStore } from "../store";
import type { Task } from "../types";

/**
 * The task a view's dialog has open. The store's snapshot covers the
 * visible days and lists only, and the open task may leave that window
 * while its dialog is up (moved to a far date, a page turned): then it
 * is fetched on its own so the dialog keeps its task, and a task that no
 * longer exists closes the dialog.
 */
export function useEditingTask() {
  const tasks = useAppStore((s) => s.tasks);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [fetchedTask, setFetchedTask] = useState<Task | null>(null);

  useEffect(() => {
    if (editingTaskId === null) {
      setFetchedTask(null);
      return;
    }
    const inStore = useAppStore
      .getState()
      .tasks.some((t) => t.id === editingTaskId);
    if (inStore) return;
    let cancelled = false;
    invoke("task_get", { id: editingTaskId })
      .then((t) => {
        if (!cancelled) setFetchedTask(t);
      })
      .catch(() => {
        if (!cancelled) setEditingTaskId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [editingTaskId, tasks]);

  const editingTask =
    tasks.find((t) => t.id === editingTaskId) ??
    (fetchedTask && fetchedTask.id === editingTaskId ? fetchedTask : null);
  return { editingTaskId, setEditingTaskId, editingTask };
}
