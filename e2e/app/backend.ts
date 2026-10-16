// An in-memory stand-in for the Rust core, so the real frontend bundle
// can run in a plain browser under Playwright. It answers the
// `#[tauri::command]`s through Tauri's own IPC mock, keeps tasks, lists
// and notes as state so a flow (add, complete, delete, undo) behaves the
// way the app does, and throws on any command it does not know - a new
// invoke the e2e suite has not met yet fails loudly instead of resolving
// to undefined.
//
// What it does not do is the core's business logic: no task
// generation, carry-over or sync. Those are covered by the Rust tests;
// this suite covers what the window does with the answers.

import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

import { defaultConfig, emptyOutcome } from "../../src/test/fixtures";
import type { AppConfig, KbNode, List, ListGroup, NewTask, Task, TaskPatch } from "../../src/types";

type Args = Record<string, unknown>;

const params = new URLSearchParams(window.location.search);
const VAULT = "C:\\Users\\e2e\\Hypomnema";

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const state = {
  vault: params.has("novault") ? null : VAULT,
  config: {
    ...defaultConfig,
    theme: params.get("theme") === "light" ? "light" : "dark",
    kb_path: VAULT,
  } as AppConfig,
  lists: [] as List[],
  groups: [] as ListGroup[],
  tasks: [] as Task[],
  notes: new Map<string, string>(),
  journal: new Map<string, string>(),
  nextId: 1,
};

function makeList(name: string, patch: Partial<List> = {}): List {
  return {
    id: state.nextId++,
    name,
    sort_order: state.lists.length,
    color: null,
    archived: false,
    auto: false,
    favorite: false,
    description: "",
    kind: "todo",
    group_id: null,
    ...patch,
  };
}

function makeTask(fields: NewTask & Partial<Task>): Task {
  return {
    id: state.nextId++,
    description_md: "",
    list_id: null,
    scheduled_date: null,
    time: null,
    status: "todo",
    color: null,
    sort_order: state.tasks.length,
    parent_task_id: null,
    created_at: new Date().toISOString(),
    completed_at: null,
    overdue: false,
    origin: "manual",
    cadence: null,
    origin_date: null,
    priority: false,
    rule_key: null,
    period_key: null,
    dow_label: null,
    ...fields,
  } as Task;
}

function seed() {
  if (params.has("empty")) return;
  const inbox = makeList("Inbox", { auto: true });
  const home = makeList("Home", { color: "#5194e6" });
  const work = makeList("Work");
  state.lists.push(inbox, home, work);
  state.tasks.push(
    makeTask({ title: "Plan the week", scheduled_date: isoDate(0), time: "09:00" }),
    makeTask({
      title: "Water the plants",
      scheduled_date: isoDate(0),
      origin: "recurring",
      cadence: "daily",
      rule_key: "r1",
      period_key: isoDate(0),
    }),
    makeTask({ title: "Review pull requests", scheduled_date: isoDate(1), priority: true }),
    makeTask({ title: "{Errands} Buy coffee", list_id: home.id }),
    makeTask({ title: "Fix the leaking tap", list_id: home.id }),
    makeTask({ title: "Write the release notes", list_id: work.id }),
    makeTask({ title: "Answer the backlog of mail", list_id: inbox.id }),
    makeTask({
      title: "Book the dentist",
      scheduled_date: isoDate(-1),
      status: "done",
      completed_at: new Date().toISOString(),
    }),
  );
  state.notes.set(
    "Welcome.md",
    "# Welcome\n\nNotes are plain Markdown files. Link them with [[Ideas]].\n",
  );
  state.notes.set("Ideas.md", "# Ideas\n\n- a calmer weekly review\n");
  state.journal.set(isoDate(-1), "Shipped the first public build.\n");
}

function findTask(id: unknown): Task {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`no task ${String(id)}`);
  return task;
}

function findList(id: unknown): List {
  const list = state.lists.find((l) => l.id === id);
  if (!list) throw new Error(`no list ${String(id)}`);
  return list;
}

function kbTree(): KbNode[] {
  return [...state.notes.keys()].sort().map((path) => ({
    name: path,
    path,
    is_dir: false,
    children: [],
  }));
}

const noErrors = { errors: [] };

const handlers: Record<string, (args: Args) => unknown> = {
  // vault and configuration
  vault_status: () => state.vault,
  vault_select: (a) => {
    state.vault = String(a.path);
    seed();
    return state.config;
  },
  vault_browse: () => ({
    path: "C:\\Users\\e2e",
    parent: null,
    entries: [],
    readable: true,
    writable: true,
    has_vault: false,
    shortcuts: [],
  }),
  platform_is_mobile: () => params.has("mobile"),
  config_get: () => state.config,
  config_default: () => defaultConfig,
  config_set: (a) => {
    state.config = a.config as AppConfig;
  },
  config_file_get: () => "",
  config_file_set: () => [],
  engine_run: () => emptyOutcome,

  // tasks and lists
  lists_all: () => state.lists.filter((l) => !l.archived),
  lists_archived: () => state.lists.filter((l) => l.archived),
  list_groups_all: () => state.groups,
  inbox_list: () => state.lists.find((l) => l.auto) ?? state.lists[0],
  tasks_snapshot: () => state.tasks,
  tasks_search: (a) => {
    const q = String(a.query).toLowerCase();
    return state.tasks.filter((t) => t.title.toLowerCase().includes(q));
  },
  task_get: (a) => findTask(a.id),
  task_create: (a) => {
    const task = makeTask(a.new as NewTask);
    state.tasks.push(task);
    return task;
  },
  task_update: (a) => {
    const task = findTask(a.id);
    const patch = a.patch as TaskPatch;
    Object.assign(task, patch);
    if (patch.status) {
      task.completed_at = patch.status === "done" ? new Date().toISOString() : null;
    }
    return task;
  },
  task_delete: (a) => {
    const removed = state.tasks.filter((t) => t.id === a.id || t.parent_task_id === a.id);
    state.tasks = state.tasks.filter((t) => !removed.includes(t));
    return { tasks: removed, rule_run: null };
  },
  task_restore: (a) => {
    const back = (a.deleted as { tasks: Task[] }).tasks;
    state.tasks.push(...back);
    return back;
  },
  tasks_reorder: (a) => {
    (a.orderedIds as number[]).forEach((id, i) => {
      findTask(id).sort_order = i;
    });
  },
  tasks_delete_done: () => {
    const before = state.tasks.length;
    state.tasks = state.tasks.filter((t) => t.status !== "done");
    return before - state.tasks.length;
  },
  capture_task: (a) => {
    const task = makeTask({ title: String(a.title) });
    state.tasks.push(task);
    return task;
  },
  list_create: (a) => {
    const list = makeList(String(a.name), { color: (a.color as string | null) ?? null });
    state.lists.push(list);
    return list;
  },
  list_rename: (a) => {
    findList(a.id).name = String(a.name);
  },
  list_set_favorite: (a) => {
    findList(a.id).favorite = Boolean(a.favorite);
  },
  list_set_meta: (a) => {
    Object.assign(findList(a.id), { color: a.color ?? null });
  },
  list_set_group: (a) => {
    findList(a.id).group_id = (a.groupId as number | null) ?? null;
  },
  list_set_all_statuses: (a) => {
    const tasks = state.tasks.filter((t) => t.list_id === a.id);
    tasks.forEach((t) => {
      t.status = a.done ? "done" : "todo";
    });
    return tasks.length;
  },
  list_archive: (a) => {
    findList(a.id).archived = true;
  },
  list_unarchive: (a) => {
    findList(a.id).archived = false;
  },
  list_group_create: (a) => {
    const group = { id: state.nextId++, name: String(a.name), sort_order: 0, color: null };
    state.groups.push(group);
    return group;
  },
  list_group_set_meta: () => undefined,
  list_group_delete: (a) => {
    state.groups = state.groups.filter((g) => g.id !== a.id);
  },

  // views the core computes
  dashboard_context: (a) => ({
    focus: "Ship the open-source release",
    days: (a.dates as string[]).map((date) => ({ date, reminders: [] })),
    blocks: [],
    errors: [],
  }),
  calendar_outlook: () => [],
  habit_rates: () => [],
  daily_streaks: () => [],
  upcoming_events: () => ({ events: [], ...noErrors }),
  recurring_list: () => ({ rules: [], ...noErrors }),
  birthdays_list: () => ({ birthdays: [], ...noErrors }),
  reminders_overview: () => ({
    focus: "Ship the open-source release",
    rotation: "weekly",
    phrases: ["Ship the open-source release"],
    reminders: [],
    blocks: [],
    today: isoDate(0),
    today_reminders: [],
    errors: [],
  }),

  // journal and notes
  journal_list: () => [...state.journal.keys()].sort(),
  journal_open: (a) => ({ date: a.date, content: state.journal.get(String(a.date)) ?? "" }),
  journal_save: (a) => {
    state.journal.set(String(a.date), String(a.content));
    return String(a.content);
  },
  journal_search: () => [],
  kb_status: () => ({ root: VAULT, configured: "", unreachable: false }),
  kb_tree: () => kbTree(),
  kb_read: (a) => state.notes.get(String(a.path)) ?? "",
  kb_write: (a) => {
    state.notes.set(String(a.path), String(a.content));
    return String(a.content);
  },
  kb_create: (a) => {
    state.notes.set(String(a.path), "");
    return String(a.path);
  },
  kb_backlinks: () => ({ links: [], mentions: [], journal: [], tasks: [] }),
  kb_search: () => [],

  // sync, backups, about
  google_status: () => ({ available: false, signed_in: false, email: null, name: null }),
  sync_standing: () => ({ pending: 0, last_pass_at: null, last_error: null }),
  sync_conflicts_list: () => [],
  backups_list: () => ({ db: [], config: [] }),
  third_party_licenses: () => "e2e: no license text",
  diagnostics: () => "e2e diagnostics",
  log_write: () => undefined,
  vault_local_path: () => VAULT,
};

/** Plugin commands the window makes on its own (theme, notifications,
 *  updater, app version): answered with what an idle desktop says. */
function plugin(cmd: string): unknown {
  if (cmd === "plugin:app|version") return "0.0.0-e2e";
  if (cmd === "plugin:notification|is_permission_granted") return false;
  return null;
}

/** Every command the page made, for tests that assert a call happened. */
const calls: { cmd: string; args: Args }[] = [];
(window as unknown as { __e2eCalls: typeof calls }).__e2eCalls = calls;

if (state.vault) seed();
mockWindows("main");
mockIPC(
  (cmd, payload) => {
    const args = (payload ?? {}) as Args;
    calls.push({ cmd, args });
    if (cmd.startsWith("plugin:")) return plugin(cmd);
    const handler = handlers[cmd];
    if (!handler) throw new Error(`e2e backend: no handler for command "${cmd}"`);
    return handler(args);
  },
  { shouldMockEvents: true },
);
