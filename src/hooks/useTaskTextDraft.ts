import { useEffect, useRef, useState } from "react";

import type { Task, TaskPatch } from "../types";

export interface TaskTextDraft {
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  /** writes the title if it changed and is not blank */
  commitTitle: () => void;
  /** writes the description if it changed */
  commitDescription: () => void;
  /** both, for a close */
  commit: () => void;
  /** forget the pending text: the task is being deleted or handed off */
  discard: () => void;
}

/**
 * Title and description drafts for a task editor, shared by the desktop
 * dialog and the phone's editor screen. Text commits on blur and on
 * close rather than per keystroke - a half-typed value committing as it
 * goes reset the field mid-typing on the desktop, and a phone keyboard
 * makes that worse. The editor can also unmount without any close
 * action (the task leaves the snapshot window, the app is backgrounded),
 * so whatever is still pending commits from the unmount path too; a
 * commit records what it wrote, so the unmount pass never repeats it,
 * and `discard` (a delete, a hand-off to the config file) cancels it.
 * Generated tasks are locked: their text is the config file's to change.
 */
export function useTaskTextDraft(
  task: Task,
  updateTask: (id: number, patch: TaskPatch) => Promise<unknown> | void,
): TaskTextDraft {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description_md);
  const locked = task.origin !== "manual";

  // what the editor holds, what the task last had, and what a commit
  // already wrote - readable from the unmount cleanup without a
  // dependency on the render that set it. The task's own values are
  // refreshed every render (an edit made elsewhere moves the base); the
  // committed values only by a commit, so a stale task prop cannot make
  // the unmount pass repeat a write that already went out.
  const pending = useRef({
    id: task.id,
    title,
    description,
    baseTitle: task.title,
    baseDescription: task.description_md,
    committedTitle: null as string | null,
    committedDescription: null as string | null,
    discarded: false,
  });
  pending.current = {
    ...pending.current,
    id: task.id,
    title,
    description,
    baseTitle: task.title,
    baseDescription: task.description_md,
  };

  const commitTitle = () => {
    const p = pending.current;
    if (locked || p.discarded) return;
    const trimmed = p.title.trim();
    if (trimmed && trimmed !== p.baseTitle && trimmed !== p.committedTitle) {
      p.committedTitle = trimmed;
      void updateTask(p.id, { title: trimmed });
    }
  };
  const commitDescription = () => {
    const p = pending.current;
    if (locked || p.discarded) return;
    if (
      p.description !== p.baseDescription &&
      p.description !== p.committedDescription
    ) {
      p.committedDescription = p.description;
      void updateTask(p.id, { description_md: p.description });
    }
  };
  const commit = () => {
    commitTitle();
    commitDescription();
  };
  const discard = () => {
    pending.current.discarded = true;
  };

  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => () => commitRef.current(), []);

  return {
    title,
    setTitle,
    description,
    setDescription,
    commitTitle,
    commitDescription,
    commit,
    discard,
  };
}
