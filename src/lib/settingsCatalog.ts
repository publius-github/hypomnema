import type { AppConfig } from "../types";

/**
 * The map of the Settings page: which tab and group every config field
 * lives in, and the words that find it.
 *
 * Settings are filed by the thing on screen they change - the task
 * card, the day column, the list column, the vault - and inside a group
 * look, geometry and behavior sit together, because that is how a
 * question arrives ("make the Done block quieter"), not split across a
 * look tab and a behavior tab. Chrome that belongs to no single object
 * (theme, fonts) stays global under Appearance.
 *
 * This file is the single source of truth: a group's title and its
 * fields are read from here by `SettingsGroup` (so a tab never repeats
 * a key list), and the search box spans the whole catalog.
 * `settingsCatalog.test.ts` pins it against `AppConfig` - a new field
 * must either land in a group or be named in EXCLUDED_KEYS with a
 * reason.
 */

export const SETTINGS_TABS = [
  { id: "profiles", label: "Profiles" },
  { id: "appearance", label: "Appearance" },
  { id: "views", label: "Views" },
  { id: "cards", label: "Task cards" },
  { id: "columns", label: "Columns" },
  { id: "recurring", label: "Recurring & calendar" },
  { id: "capture", label: "Capture & alerts" },
  { id: "data", label: "Data" },
  { id: "sync", label: "Sync" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

export type SettingsGroupId =
  | "appearance.theme"
  | "appearance.fonts"
  | "appearance.text"
  | "appearance.editor"
  | "views.dashboard"
  | "views.days"
  | "views.lists"
  | "views.listview"
  | "views.settings"
  | "views.navigation"
  | "cards.colors"
  | "cards.chips"
  | "cards.markers"
  | "cards.behavior"
  | "columns.shared"
  | "columns.day"
  | "columns.list"
  | "recurring.buckets"
  | "recurring.generation"
  | "recurring.calendar"
  | "capture.capture"
  | "capture.tray"
  | "capture.alerts"
  | "data.vault"
  | "data.notes"
  | "data.mirror"
  | "data.backups"
  | "data.cleanup"
  | "sync.account"
  | "sync.schedule";

type GroupDef = {
  tab: SettingsTab;
  title: string;
  /** Never collapses: holds paths or actions rather than tunables. */
  always?: boolean;
  /** No "reset to defaults" affordance (paths are not a look). */
  noReset?: boolean;
  /**
   * The whole group is fine-tuning - no switch inside it changes what
   * the app does, only how loud or how far it does it. Such a group
   * wears the customization checkbox on its own header instead of a
   * collapse link.
   */
  knobs?: boolean;
};

export const SETTINGS_GROUPS: Record<SettingsGroupId, GroupDef> = {
  "appearance.theme": { tab: "appearance", title: "Theme & palette" },
  "appearance.fonts": { tab: "appearance", title: "Fonts & sizes" },
  "appearance.text": { tab: "appearance", title: "Text colors", knobs: true },
  "appearance.editor": { tab: "appearance", title: "Markdown editor" },

  "views.dashboard": { tab: "views", title: "Dashboard" },
  "views.days": { tab: "views", title: "Days page" },
  "views.lists": { tab: "views", title: "Lists page" },
  "views.listview": {
    tab: "views",
    title: "List view (Days and Lists)",
    knobs: true,
  },
  "views.settings": { tab: "views", title: "Settings page" },
  "views.navigation": { tab: "views", title: "Navigation" },

  "cards.colors": { tab: "cards", title: "Card colors" },
  "cards.chips": { tab: "cards", title: "Category chips" },
  "cards.markers": { tab: "cards", title: "Card markers" },
  "cards.behavior": { tab: "cards", title: "Card behavior" },

  "columns.shared": { tab: "columns", title: "Day and list columns" },
  "columns.day": { tab: "columns", title: "Day columns" },
  "columns.list": { tab: "columns", title: "List columns" },

  "recurring.buckets": { tab: "recurring", title: "Cadence buckets", knobs: true },
  "recurring.generation": { tab: "recurring", title: "Generation" },
  "recurring.calendar": {
    tab: "recurring",
    title: "Calendar projections",
    knobs: true,
  },

  "capture.capture": { tab: "capture", title: "Quick capture" },
  "capture.tray": { tab: "capture", title: "Tray" },
  "capture.alerts": { tab: "capture", title: "Due-task notifications" },

  "data.vault": {
    tab: "data",
    title: "Vault & folders",
    always: true,
    noReset: true,
  },
  "data.notes": { tab: "data", title: "Notes" },
  "data.mirror": { tab: "data", title: "Snapshots & mirror" },
  "data.backups": { tab: "data", title: "Backups", always: true },
  "data.cleanup": {
    tab: "data",
    title: "Cleanup",
    always: true,
    noReset: true,
  },

  "sync.account": {
    tab: "sync",
    title: "Google account",
    always: true,
    noReset: true,
  },
  "sync.schedule": { tab: "sync", title: "When to sync" },
};

export type CatalogEntry = {
  key: keyof AppConfig;
  /** Short searchable name; the control keeps its own fuller label. */
  label: string;
  group: SettingsGroupId;
  /** Extra words a user might search by instead of the label. */
  terms?: string;
};

export const SETTINGS_CATALOG: CatalogEntry[] = [
  // --- Appearance -------------------------------------------------
  { key: "theme", label: "Theme", group: "appearance.theme", terms: "dark light vscode palette" },
  { key: "accent_color", label: "Accent color", group: "appearance.theme" },
  { key: "surface_color", label: "Background color", group: "appearance.theme" },
  { key: "surface_alt_color", label: "Panel color", group: "appearance.theme" },
  { key: "line_color", label: "Border color", group: "appearance.theme" },

  { key: "ui_font", label: "UI font", group: "appearance.fonts", terms: "typeface family" },
  { key: "editor_font", label: "Editor font", group: "appearance.fonts", terms: "journal notes monospace" },
  { key: "ui_font_size", label: "Base font size", group: "appearance.fonts", terms: "text size scale" },
  { key: "editor_font_size", label: "Editor font size", group: "appearance.fonts" },

  { key: "content_color", label: "Main text color", group: "appearance.text" },
  { key: "content_muted_color", label: "Secondary text color", group: "appearance.text" },
  { key: "weekly_focus_color", label: "Weekly focus color", group: "appearance.text" },
  { key: "reminder_color", label: "Day reminders color", group: "appearance.text" },
  { key: "day_header_color", label: "Day header color", group: "appearance.text", terms: "weekday date" },
  { key: "dow_label_color", label: "Weekday marker color", group: "appearance.text", terms: "sat#1 cron label" },

  { key: "kb_line_numbers", label: "Line numbers in the Notes editor", group: "appearance.editor" },

  // --- Views ------------------------------------------------------
  { key: "list_columns", label: "List columns in the dashboard zone", group: "views.dashboard" },
  { key: "dashboard_split", label: "Dashboard split", group: "views.dashboard", terms: "day grid height divider" },

  { key: "days_page_columns", label: "Day columns on the Days page", group: "views.days" },

  { key: "lists_page_columns", label: "Grid columns on the Lists page", group: "views.lists" },
  { key: "lists_page_align_rows", label: "Align list rows", group: "views.lists" },
  { key: "list_view_plate_scale", label: "Section plate height in list view", group: "views.listview", terms: "header daily monthly done percent font text size" },
  { key: "gap_fill_color", label: "Gap fill color", group: "views.listview", terms: "hatch glow band" },
  { key: "gap_fill_fade", label: "Gap fill edge softness", group: "views.listview", terms: "hatch glow fade blur gradient" },
  { key: "gap_fill_max_thickness", label: "Gap fill maximum thickness", group: "views.listview", terms: "hatch glow band height tall" },
  { key: "list_gap_stripe", label: "Separator stripe height, % of a row", group: "views.listview", terms: "gap spacing glow band stripe category section" },
  { key: "gap_fill_opacity", label: "Gap fill opacity", group: "views.listview", terms: "hatch glow band transparency alpha" },
  { key: "gap_fill_inset", label: "Gap fill inset from the row lines", group: "views.listview", terms: "hatch glow margin padding" },
  { key: "section_cards", label: "Sections as framed panels", group: "views.listview", terms: "card rail frame border" },
  { key: "section_gap", label: "Space between section panels", group: "views.listview", terms: "gap margin" },
  { key: "category_gap_bands", label: "Bands in category breaks", group: "views.listview", terms: "stripe gap" },
  { key: "row_hairlines", label: "Hairlines between rows", group: "views.listview", terms: "border line separator" },
  { key: "category_headers", label: "Category as a block header", group: "views.listview", terms: "chip label group" },
  { key: "category_header_bold", label: "Bold category header", group: "views.listview", terms: "chip label group weight" },
  { key: "section_plate_count", label: "Task count on section plates", group: "views.listview", terms: "counter number" },
  { key: "section_plate_sticky", label: "Sticky section plates", group: "views.listview", terms: "header pin scroll" },
  { key: "fold_postponed", label: "Fold Postponed by default", group: "views.listview", terms: "closed collapse hide" },
  { key: "fold_waiting", label: "Fold Done, waiting by default", group: "views.listview", terms: "closed collapse hide" },
  { key: "fold_done", label: "Fold Done by default", group: "views.listview", terms: "closed collapse hide" },
  { key: "fold_dropped", label: "Fold Not done, dropped by default", group: "views.listview", terms: "closed collapse hide" },
  { key: "closed_row_opacity", label: "Closed row opacity", group: "views.listview", terms: "done dropped dim fade" },
  { key: "lists_group_display", label: "Grouped lists display", group: "views.lists", terms: "folded flat group tile" },

  { key: "settings_width", label: "Settings content width", group: "views.settings", terms: "tab strip wrap" },

  { key: "section_order", label: "Section order in the left bar", group: "views.navigation", terms: "rail sidebar" },
  { key: "section_hidden", label: "Hidden sections", group: "views.navigation", terms: "rail sidebar hide" },

  // --- Task cards -------------------------------------------------
  { key: "cadence_colors", label: "Color tasks by cadence", group: "cards.colors", terms: "stripe" },
  { key: "cadence_color_general", label: "General cadence color", group: "cards.colors", terms: "stripe plate" },
  { key: "cadence_color_daily", label: "Daily cadence color", group: "cards.colors", terms: "stripe" },
  { key: "cadence_color_weekly", label: "Weekly cadence color", group: "cards.colors", terms: "stripe" },
  { key: "cadence_color_monthly", label: "Monthly cadence color", group: "cards.colors", terms: "stripe" },
  { key: "cadence_color_yearly", label: "Yearly cadence color", group: "cards.colors", terms: "stripe" },
  { key: "cadence_color_exact", label: "Exact-date cadence color", group: "cards.colors", terms: "stripe scheduled birthday" },
  { key: "postponed_plate_color", label: "Postponed plate color", group: "cards.colors", terms: "section header closed" },
  { key: "waiting_plate_color", label: "Done, waiting plate color", group: "cards.colors", terms: "section header closed" },
  { key: "done_plate_color", label: "Done plate color", group: "cards.colors", terms: "section header closed" },
  { key: "dropped_plate_color", label: "Not done, dropped plate color", group: "cards.colors", terms: "section header closed" },
  { key: "done_color", label: "Done checkbox color", group: "cards.colors" },
  { key: "waiting_color", label: "Done, waiting mark color", group: "cards.colors" },
  { key: "dropped_color", label: "Not done, dropped mark color", group: "cards.colors", terms: "checkbox red cancel" },

  { key: "category_color", label: "Category label color", group: "cards.chips" },
  { key: "category_color_mode", label: "Category chip coloring", group: "cards.chips", terms: "single varied alternate" },
  { key: "category_avoid_cadence_colors", label: "Varied chips avoid the cadence colors", group: "cards.chips", terms: "palette weekly monthly plate" },
  { key: "category_color_a", label: "Alternating chip color A", group: "cards.chips" },
  { key: "category_color_b", label: "Alternating chip color B", group: "cards.chips" },
  { key: "chip_font_scale", label: "Chip text size", group: "cards.chips", terms: "category list date chip" },

  { key: "cron_weekday_labels", label: "Weekday marker from cron", group: "cards.markers", terms: "sat#1" },
  { key: "cron_everyday_label", label: "[EVERYDAY] marker", group: "cards.markers" },
  { key: "dow_label_opacity", label: "Weekday marker opacity", group: "cards.markers", terms: "sat#1 cron label dim" },
  { key: "habit_rate_chip", label: "Completion rate chip", group: "cards.markers", terms: "habit rate percent" },
  { key: "habit_rate_alert_only", label: "Rate chip only below the threshold", group: "cards.markers", terms: "habit rate percent alert" },
  { key: "habit_rate_threshold", label: "Rate alert threshold", group: "cards.markers", terms: "habit percent" },
  { key: "habit_rate_window", label: "Rate window", group: "cards.markers", terms: "habit last instances" },
  { key: "streak_strip_days", label: "Daily streak marks in History", group: "cards.markers", terms: "habit heatmap strip history" },
  { key: "habit_rate_min_instances", label: "Rate minimum instances", group: "cards.markers", terms: "habit" },
  { key: "habit_rate_alert_color", label: "Rate alert color", group: "cards.markers", terms: "habit" },

  { key: "done_hold_seconds", label: "Hold before a done task moves", group: "cards.behavior", terms: "misclick postponed" },
  { key: "undo_toast_seconds", label: "Undo toast length", group: "cards.behavior", terms: "delete archive" },
  { key: "subtasks_done_last", label: "Done subtasks sink to the bottom", group: "cards.behavior" },
  { key: "priority_overdue", label: "Priority tasks get the overdue mark", group: "cards.behavior", terms: "star" },

  // --- Columns ----------------------------------------------------
  { key: "done_display", label: "Done tasks display", group: "columns.shared", terms: "inline separate block" },
  { key: "closed_sections_sort_alpha", label: "Sort Postponed and Done alphabetically", group: "columns.shared", terms: "waiting order abc" },

  { key: "day_header_centered", label: "Center day headers", group: "columns.day" },
  { key: "daily_tasks_today_only", label: "Daily tasks only on today", group: "columns.day" },
  { key: "cadence_group_order", label: "Day column section order", group: "columns.day", terms: "cadence groups" },

  { key: "lists_sort_alpha", label: "Sort lists alphabetically", group: "columns.list" },
  { key: "list_tasks_sort_alpha", label: "Sort tasks inside lists alphabetically", group: "columns.list" },
  { key: "clear_done_list_tasks", label: "Clear done list tasks at rollover", group: "columns.list" },
  { key: "list_task_lines", label: "Task title lines in a list column", group: "columns.list", terms: "truncate clamp" },
  { key: "list_dialog_task_lines", label: "Task title lines in the list dialog", group: "columns.list", terms: "truncate clamp" },
  { key: "list_exact_stripe", label: "Exact-date stripe inside the list", group: "columns.list", terms: "dated scheduled" },
  { key: "list_date_chip_color", label: "Date chip color inside the list", group: "columns.list", terms: "dated scheduled" },

  // --- Recurring & calendar ---------------------------------------
  { key: "cadence_daily_min_per_year", label: "Daily bucket threshold", group: "recurring.buckets", terms: "firings per year" },
  { key: "cadence_weekly_min_per_year", label: "Weekly bucket threshold", group: "recurring.buckets", terms: "firings per year" },
  { key: "cadence_monthly_min_per_year", label: "Monthly bucket threshold", group: "recurring.buckets", terms: "firings per year" },

  { key: "catchup_days", label: "Recurring catch-up window", group: "recurring.generation", terms: "missed" },
  { key: "cron_ignore_time", label: "Catch up crons by calendar day", group: "recurring.generation", terms: "missed time" },
  { key: "retention_days", label: "Retention of done one-off tasks", group: "recurring.generation", terms: "prune history" },

  { key: "calendar_daily_days", label: "Calendar: daily rules ahead", group: "recurring.calendar", terms: "horizon projection outlook" },
  { key: "calendar_weekly_weeks", label: "Calendar: weekly rules ahead", group: "recurring.calendar", terms: "horizon projection outlook" },
  { key: "calendar_monthly_months", label: "Calendar: monthly rules ahead", group: "recurring.calendar", terms: "horizon projection outlook" },
  { key: "calendar_yearly_years", label: "Calendar: yearly rules ahead", group: "recurring.calendar", terms: "horizon projection outlook" },
  { key: "calendar_dates_years", label: "Calendar: exact dates ahead", group: "recurring.calendar", terms: "horizon birthdays projection" },

  // --- Capture & alerts -------------------------------------------
  { key: "capture_list", label: "Quick-capture list", group: "capture.capture", terms: "inbox" },
  // desktop-only (see docs/windows/ARCHITECTURE.md): the global
  // shortcut and the tray need a window manager the phone has not got
  { key: "capture_shortcut", label: "Global capture shortcut", group: "capture.capture", terms: "hotkey" },
  { key: "tray_icon", label: "Tray icon", group: "capture.tray", terms: "system tray notification area" },
  { key: "close_to_tray", label: "Close to tray", group: "capture.tray", terms: "minimize hide quit" },

  { key: "notify_system", label: "System notifications for due tasks", group: "capture.alerts", terms: "os toast" },
  { key: "notify_snooze_minutes", label: "Snooze length", group: "capture.alerts", terms: "toast due" },
  { key: "notify_lead_minutes", label: "Remind ahead of a timed task", group: "capture.alerts", terms: "reminder early before minutes notification" },
  { key: "notify_toast_seconds", label: "Due-task toast duration", group: "capture.alerts", terms: "reminder notification seconds hide" },

  // --- Data -------------------------------------------------------
  { key: "kb_path", label: "Notes folder", group: "data.vault", terms: "kb vault path" },
  { key: "notes_timestamps", label: "Created and Last edited lines", group: "data.notes", terms: "timestamps frontmatter" },
  { key: "journal_day_tasks", label: "Tasks of the day in the Journal", group: "data.notes", terms: "journal entry done open strip" },

  { key: "state_snapshot", label: "Text snapshot of the database", group: "data.mirror", terms: "jsonl rebuild sync" },
  { key: "tasks_mirror", label: "Mirror tasks to Markdown files", group: "data.mirror", terms: "bulk edit files" },
  { key: "tasks_mirror_agenda", label: "Agenda file with generated tasks", group: "data.mirror" },
  { key: "tasks_mirror_ids", label: "Write the ^id sync key", group: "data.mirror" },
  { key: "tasks_mirror_today", label: "today.md day sheet", group: "data.mirror" },
  { key: "tasks_mirror_today_days", label: "Days covered by today.md", group: "data.mirror" },

  { key: "backup_keep", label: "Backups to keep", group: "data.backups", terms: "snapshots restore" },

  // --- Sync -------------------------------------------------------
  { key: "sync_auto", label: "Sync automatically", group: "sync.schedule", terms: "google drive auto" },
  { key: "sync_interval_minutes", label: "Minutes between passes", group: "sync.schedule", terms: "interval period" },
  { key: "sync_debounce_seconds", label: "Seconds after an edit", group: "sync.schedule", terms: "debounce delay" },
  { key: "sync_on_focus", label: "Sync when the window comes to the front", group: "sync.schedule", terms: "focus" },
  { key: "sync_on_leave", label: "Sync on quit", group: "sync.schedule", terms: "exit close background" },
  { key: "sync_mass_delete_guard_percent", label: "Mass-deletion guard", group: "sync.schedule", terms: "wiped remote safety percent" },
];

/**
 * Fields with no control on this page, each for a reason - the test
 * treats anything else missing from the catalog as an oversight.
 */
export const EXCLUDED_KEYS: { key: keyof AppConfig; why: string }[] = [
  {
    key: "grid_columns",
    why: "set by the Days dropdown on the dashboard/Days header, where the grid it resizes is visible",
  },
  {
    key: "dashboard_today_only",
    why: "toggled on the dashboard header itself - a view mode belongs where the view is, and a second copy here only invites the two to disagree",
  },
  {
    key: "days_today_only",
    why: "the same toggle on the Days page header",
  },
  { key: "mobile_safe_area_top", why: "mobile only - status bar inset floor" },
  { key: "mobile_safe_area_bottom", why: "mobile only - gesture bar inset floor" },
];

const BY_GROUP = SETTINGS_CATALOG.reduce<
  Partial<Record<SettingsGroupId, (keyof AppConfig)[]>>
>((acc, entry) => {
  (acc[entry.group] ??= []).push(entry.key);
  return acc;
}, {});

/** The fields a group holds, in catalog order. */
export function groupKeys(id: SettingsGroupId): (keyof AppConfig)[] {
  return BY_GROUP[id] ?? [];
}

export type SearchHit = CatalogEntry & {
  tab: SettingsTab;
  groupTitle: string;
};

/**
 * Whole-page search: with 100+ fields, remembering which tab holds one
 * is the real cost of the page. Matches the label, the group title and
 * the raw config key (someone reading app.yml searches by key), all on
 * whitespace-separated terms so "done gap" finds the Done gaps.
 */
export function searchSettings(query: string): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return SETTINGS_CATALOG.filter((entry) => {
    const group = SETTINGS_GROUPS[entry.group];
    const haystack =
      `${entry.label} ${entry.key} ${group.title} ${entry.terms ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }).map((entry) => ({
    ...entry,
    tab: SETTINGS_GROUPS[entry.group].tab,
    groupTitle: SETTINGS_GROUPS[entry.group].title,
  }));
}

/**
 * What a settings profile does to a group: `all` = every field is
 * captured and reset by an apply, `some` = part of it, `none` = the
 * group is untouched. Computed from the Rust PROFILE_KEYS, so the page
 * can never claim a scope the backend does not honor.
 */
export function profileCoverage(
  id: SettingsGroupId,
  profileKeys: (keyof AppConfig)[] | null,
): "all" | "some" | "none" | "unknown" {
  if (!profileKeys) return "unknown";
  const keys = groupKeys(id);
  if (keys.length === 0) return "none";
  const covered = keys.filter((key) => profileKeys.includes(key)).length;
  if (covered === 0) return "none";
  return covered === keys.length ? "all" : "some";
}

/**
 * The same list folded by tab - what the Profiles tab renders. A flat
 * run of chips repeats "Appearance >" four times in a row; the tab name
 * belongs on the line, once, with its groups behind it. Tabs come in
 * page order, and a tab a profile never touches is simply absent.
 */
export function profileGroupsByTab(
  profileKeys: (keyof AppConfig)[] | null,
): {
  tab: SettingsTab;
  label: string;
  groups: { id: SettingsGroupId; title: string; partial: boolean }[];
}[] {
  const covered = profileGroups(profileKeys);
  return SETTINGS_TABS.map(({ id, label }) => ({
    tab: id,
    label,
    groups: covered
      .filter((group) => group.tab === id)
      .map(({ id: groupId, title, partial }) => ({
        id: groupId,
        title,
        partial,
      })),
  })).filter((row) => row.groups.length > 0);
}

/** Groups a profile covers, fully or partly - the flat list behind it. */
export function profileGroups(
  profileKeys: (keyof AppConfig)[] | null,
): { id: SettingsGroupId; title: string; tab: SettingsTab; partial: boolean }[] {
  if (!profileKeys) return [];
  return (Object.keys(SETTINGS_GROUPS) as SettingsGroupId[])
    .map((id) => ({ id, coverage: profileCoverage(id, profileKeys) }))
    .filter(({ coverage }) => coverage === "all" || coverage === "some")
    .map(({ id, coverage }) => ({
      id,
      title: SETTINGS_GROUPS[id].title,
      tab: SETTINGS_GROUPS[id].tab,
      partial: coverage === "some",
    }));
}
