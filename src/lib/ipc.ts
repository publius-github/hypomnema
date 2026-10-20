// The one place the frontend talks to the Rust core. `Commands` names
// every `#[tauri::command]` with its argument object (Tauri camelCases
// the Rust parameter names) and its result type, so a typo in a command
// name or a missing argument is a compile error instead of a runtime
// rejection. Result types are the ts-rs bindings from `src/types.ts`;
// keep this map in step with `generate_handler!` in src-tauri/src/lib.rs.

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

import type {
  AppConfig,
  BacklinksResult,
  BackupsOverview,
  BirthdayEntry,
  BirthdaysResult,
  ConfigError,
  ConflictDiff,
  ConflictEntry,
  DailyStreak,
  DashboardContext,
  DayReminder,
  DeletedTasks,
  DirListing,
  GooglePull,
  GoogleStatus,
  EngineOutcome,
  HabitRate,
  JournalEntry,
  JournalSearchHit,
  KbNode,
  KbSearchHit,
  KbStatus,
  List,
  ListGroup,
  LockState,
  NewTask,
  OutlookEvent,
  RecurringResult,
  RecurringRule,
  RemindersOverview,
  ScheduleBlock,
  ScheduledEvent,
  SyncStanding,
  SyncSummary,
  Task,
  TaskPatch,
  UpcomingResult,
  WidgetLaunch,
} from "../types";

export interface Commands {
  app_lock_disable: { args: { passphrase: string }; result: LockState };
  app_lock_enable: { args: { passphrase: string }; result: LockState };
  app_lock_now: { args: void; result: LockState };
  app_lock_state: { args: void; result: LockState };
  app_unlock: { args: { passphrase: string }; result: LockState };
  backup_restore_config: { args: { id: string }; result: void };
  backup_restore_db: { args: { id: string }; result: AppConfig };
  backups_list: { args: void; result: BackupsOverview };
  birthday_add: { args: { entry: BirthdayEntry }; result: void };
  birthday_edit: {
    args: { original: BirthdayEntry; replacement: BirthdayEntry | null };
    result: void;
  };
  birthdays_list: { args: void; result: BirthdaysResult };
  calendar_outlook: {
    args: { from: string; to: string };
    result: OutlookEvent[];
  };
  capture_task: { args: { title: string }; result: Task };
  config_default: { args: void; result: AppConfig };
  config_file_get: { args: { file: string }; result: string };
  config_file_set: {
    args: { file: string; content: string };
    result: ConfigError[];
  };
  config_get: { args: void; result: AppConfig };
  config_set: { args: { config: AppConfig }; result: void };
  daily_streaks: { args: void; result: DailyStreak[] };
  dashboard_context: { args: { dates: string[] }; result: DashboardContext };
  diagnostics: { args: void; result: string };
  day_reminder_add: { args: { entry: DayReminder }; result: void };
  day_reminder_edit: {
    args: { index: number; original: DayReminder; replacement: DayReminder | null };
    result: void;
  };
  engine_run: { args: void; result: EngineOutcome };
  google_pull_vault: { args: void; result: GooglePull | null };
  google_sign_in: { args: void; result: GoogleStatus };
  google_sign_in_cancel: { args: void; result: void };
  google_sign_out: { args: void; result: GoogleStatus };
  google_status: { args: void; result: GoogleStatus };
  focus_phrase_add: { args: { phrase: string }; result: void };
  focus_phrase_edit: {
    args: { index: number; original: string; replacement: string | null };
    result: void;
  };
  habit_rates: { args: void; result: HabitRate[] };
  inbox_list: { args: void; result: List };
  journal_list: { args: void; result: string[] };
  journal_open: { args: { date: string }; result: JournalEntry };
  journal_save: {
    args: { date: string; content: string; base: string | null };
    result: string;
  };
  journal_search: { args: { query: string }; result: JournalSearchHit[] };
  kb_abs_path: { args: { path: string }; result: string };
  kb_backlinks: { args: { path: string }; result: BacklinksResult };
  kb_copy: { args: { from: string; toDir: string }; result: string };
  kb_create: { args: { path: string }; result: string };
  kb_delete: { args: { path: string }; result: void };
  kb_mkdir: { args: { path: string }; result: string };
  kb_read: { args: { path: string }; result: string };
  kb_rename: { args: { from: string; to: string }; result: void };
  kb_reveal: { args: { path: string }; result: void };
  kb_search: { args: { query: string }; result: KbSearchHit[] };
  kb_status: { args: void; result: KbStatus };
  kb_tree: { args: void; result: KbNode[] };
  kb_write: {
    args: { path: string; content: string; base: string | null };
    result: string;
  };
  list_archive: { args: { id: number }; result: void };
  list_create: { args: { name: string; color: string | null }; result: List };
  list_group_create: { args: { name: string }; result: ListGroup };
  list_group_delete: { args: { id: number }; result: void };
  list_group_set_meta: {
    args: { id: number; name: string; color: string | null };
    result: void;
  };
  list_groups_all: { args: void; result: ListGroup[] };
  list_rename: { args: { id: number; name: string }; result: void };
  list_set_all_statuses: {
    args: { id: number; done: boolean };
    result: number;
  };
  list_set_favorite: { args: { id: number; favorite: boolean }; result: void };
  list_set_group: {
    args: { id: number; groupId: number | null };
    result: void;
  };
  list_set_meta: {
    args: {
      id: number;
      color: string | null;
      description: string;
      kind: string;
    };
    result: void;
  };
  list_unarchive: { args: { id: number }; result: void };
  lists_all: { args: void; result: List[] };
  lists_archived: { args: void; result: List[] };
  log_reveal: { args: void; result: void };
  log_write: { args: { level: LogLevel; message: string }; result: void };
  open_external: { args: { url: string }; result: void };
  platform_is_mobile: { args: void; result: boolean };
  recurring_add: { args: { rule: RecurringRule }; result: void };
  recurring_edit: {
    args: { index: number; original: RecurringRule; replacement: RecurringRule | null };
    result: void;
  };
  recurring_list: { args: void; result: RecurringResult };
  reminders_overview: { args: void; result: RemindersOverview };
  schedule_block_add: { args: { block: ScheduleBlock }; result: void };
  schedule_block_edit: {
    args: { index: number; original: ScheduleBlock; replacement: ScheduleBlock | null };
    result: void;
  };
  scheduled_add: { args: { event: ScheduledEvent }; result: void };
  scheduled_edit: {
    args: { original: ScheduledEvent; replacement: ScheduledEvent | null };
    result: void;
  };
  storage_access: { args: void; result: boolean };
  storage_access_request: { args: void; result: void };
  sync_conflict_diff: {
    args: { path: string; copy: string };
    result: ConflictDiff;
  };
  sync_conflict_resolve: {
    args: { path: string; copy: string; keepCopy: boolean };
    result: void;
  };
  sync_conflicts_clear: { args: void; result: void };
  sync_conflicts_list: { args: void; result: ConflictEntry[] };
  sync_reset_space: { args: void; result: void };
  sync_now: { args: void; result: SyncSummary };
  sync_standing: { args: void; result: SyncStanding };
  task_create: { args: { new: NewTask }; result: Task };
  task_delete: { args: { id: number }; result: DeletedTasks };
  task_get: { args: { id: number }; result: Task };
  task_restore: { args: { deleted: DeletedTasks }; result: Task[] };
  task_update: { args: { id: number; patch: TaskPatch }; result: Task };
  tasks_delete_done: { args: void; result: number };
  tasks_reorder: {
    args: { listId: number; orderedIds: number[] };
    result: void;
  };
  tasks_search: { args: { query: string }; result: Task[] };
  tasks_snapshot: {
    args: { startDate: string; endDate: string };
    result: Task[];
  };
  third_party_licenses: { args: void; result: string };
  upcoming_events: { args: void; result: UpcomingResult };
  vault_browse: { args: { path: string | null }; result: DirListing };
  vault_export: { args: { target: string | null }; result: string };
  vault_browse_mkdir: {
    args: { parent: string; name: string };
    result: string;
  };
  vault_local_path: { args: void; result: string };
  vault_select: { args: { path: string }; result: AppConfig };
  vault_create_example: { args: { path: string }; result: AppConfig };
  vault_status: { args: void; result: string | null };
  vault_use_local: { args: void; result: string };
  vault_use_path: { args: { path: string }; result: string };
  widget_launch_target: { args: void; result: WidgetLaunch | null };
}

export type CommandName = keyof Commands;

type ArgsOf<K extends CommandName> = Commands[K]["args"];

export type LogLevel = "error" | "warn" | "info";

/**
 * Appends a line to this device's diagnostic log (hypomnema.log, see
 * src-tauri/src/applog.rs). Fire and forget: a log write that fails must
 * never turn into a second error.
 */
export function logToFile(level: LogLevel, message: string): void {
  try {
    void Promise.resolve(tauriInvoke("log_write", { level, message })).catch(
      () => {},
    );
  } catch {
    // no IPC at all (a test without the mock) - nothing to log to
  }
}

/** Typed `invoke`: `invoke("task_get", { id })` resolves to a `Task`.
 * Every rejection but "no vault yet" also lands in the diagnostic log, so
 * a bug report can show what failed even when the banner was dismissed. */
export function invoke<K extends CommandName>(
  cmd: K,
  ...args: ArgsOf<K> extends void ? [] : [ArgsOf<K>]
): Promise<Commands[K]["result"]> {
  return tauriInvoke<Commands[K]["result"]>(
    cmd,
    args[0] as Record<string, unknown> | undefined,
  ).catch((e: unknown) => {
    if (cmd !== "log_write" && errorKind(e) !== "no_vault") {
      logToFile("warn", `${cmd} failed: ${errorMessage(e)}`);
    }
    throw e;
  });
}

/// What a rejected command carries: the Rust `Error` serializes itself as
/// this object (src-tauri/src/error.rs), so the UI can branch on `kind`
/// instead of matching English text.
export interface IpcError {
  kind:
    | "io"
    | "db"
    | "config"
    | "state"
    | "no_vault"
    | "sync_conflict"
    | "remote_wiped"
    | "sign_in_expired";
  message: string;
  path?: string;
}

export function isIpcError(e: unknown): e is IpcError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as IpcError).kind === "string" &&
    typeof (e as IpcError).message === "string"
  );
}

/** The `kind` of a rejection when it came from the Rust core, else null. */
export function errorKind(e: unknown): IpcError["kind"] | null {
  return isIpcError(e) ? e.kind : null;
}

/**
 * The one way a rejection becomes banner text. `String(e)` on the object
 * the core now sends would read "[object Object]"; a thrown `Error`
 * (the test mocks, a plugin) keeps its message; anything else is
 * stringified as before.
 */
export function errorMessage(e: unknown): string {
  if (isIpcError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
