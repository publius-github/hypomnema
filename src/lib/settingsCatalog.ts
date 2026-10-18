import type { AppConfig } from "../types";

/**
 * The map of the Settings page: which tab and group every config field
 * lives in, and the words that find it.
 *
 * Settings is deliberately short: it holds what a person sets up once
 * to make the app theirs - theme and fonts, which pages show, how tasks
 * are grouped and sorted, recurring rules, capture, data and sync. Fine
 * tuning (spacing, opacities, timings, sync cadence, file-mirror
 * details) and every color stay at sane defaults and are edited in the
 * files instead: app.yml for the per-device knobs and the synced
 * colors.yml for the color scheme, both open in Notes > Config.
 *
 * This file is the single source of truth: a group's title and its
 * fields are read from here by `SettingsGroup` (so a tab never repeats
 * a key list), and the search box spans the whole catalog.
 * `settingsCatalog.test.ts` pins it against `AppConfig` - a new field
 * must either land in a group or be named in EXCLUDED_KEYS with a
 * reason.
 */

export const SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "tasks", label: "Tasks" },
  { id: "recurring", label: "Recurring & calendar" },
  { id: "capture", label: "Capture & alerts" },
  { id: "data", label: "Data" },
  { id: "sync", label: "Sync" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

export type SettingsGroupId =
  | "general.theme"
  | "general.fonts"
  | "general.navigation"
  | "general.updates"
  | "tasks.cards"
  | "tasks.columns"
  | "recurring.buckets"
  | "recurring.generation"
  | "recurring.calendar"
  | "capture.capture"
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
  /**
   * Shown only with "Show advanced settings" (`settings_advanced`), or
   * once something in it differs from its default, or when a search
   * lands in it - fine-tuning a first look at the page can do without.
   */
  advanced?: boolean;
};

export const SETTINGS_GROUPS: Record<SettingsGroupId, GroupDef> = {
  "general.theme": { tab: "general", title: "Theme" },
  "general.fonts": { tab: "general", title: "Fonts & sizes" },
  "general.navigation": { tab: "general", title: "Left bar" },
  "general.updates": { tab: "general", title: "Updates" },

  "tasks.cards": { tab: "tasks", title: "Task cards" },
  "tasks.columns": { tab: "tasks", title: "Day and list columns" },

  "recurring.buckets": {
    tab: "recurring",
    title: "Cadence buckets",
    knobs: true,
    advanced: true,
  },
  "recurring.generation": { tab: "recurring", title: "Generation", advanced: true },
  "recurring.calendar": {
    tab: "recurring",
    title: "Calendar projections",
    knobs: true,
    advanced: true,
  },

  "capture.capture": { tab: "capture", title: "Quick capture & tray" },
  "capture.alerts": { tab: "capture", title: "Due-task notifications" },

  "data.vault": {
    tab: "data",
    title: "Vault & folders",
    always: true,
    noReset: true,
  },
  "data.notes": { tab: "data", title: "Journal & notes" },
  "data.mirror": { tab: "data", title: "Markdown mirror", advanced: true },
  "data.backups": { tab: "data", title: "Backups", always: true },
  "data.cleanup": {
    tab: "data",
    title: "Done tasks cleanup",
    always: true,
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
  // --- General -------------------------------------------------
  { key: "theme", label: "Theme", group: "general.theme", terms: "dark light vscode palette" },

  { key: "ui_font", label: "UI font", group: "general.fonts", terms: "typeface family" },
  { key: "editor_font", label: "Editor font", group: "general.fonts", terms: "journal notes monospace" },
  { key: "ui_font_size", label: "Base font size", group: "general.fonts", terms: "text size scale" },
  { key: "editor_font_size", label: "Editor font size", group: "general.fonts" },

  { key: "section_order", label: "Page order in the left bar", group: "general.navigation", terms: "rail sidebar sections" },
  { key: "section_hidden", label: "Hidden pages", group: "general.navigation", terms: "rail sidebar hide sections" },
  // desktop-only: the phone has no updater
  { key: "update_check", label: "Check for updates at startup", group: "general.updates", terms: "updater new version github network" },

  // --- Tasks ---------------------------------------------------
  { key: "category_headers", label: "Category as a block header", group: "tasks.cards", terms: "chip label group bold" },
  { key: "cron_weekday_labels", label: "Weekday markers", group: "tasks.cards", terms: "sat#1 cron everyday label" },
  { key: "habit_rate_display", label: "Completion rate chip", group: "tasks.cards", terms: "habit rate percent alert" },
  { key: "habit_rate_threshold", label: "Rate alert threshold", group: "tasks.cards", terms: "habit percent" },
  { key: "subtasks_done_last", label: "Done subtasks sink to the bottom", group: "tasks.cards" },
  { key: "priority_overdue", label: "Priority tasks get the overdue mark", group: "tasks.cards", terms: "star" },
  { key: "general_overdue", label: "General tasks get the overdue mark", group: "tasks.cards", terms: "one-off manual carry over" },

  { key: "done_display", label: "Done tasks display", group: "tasks.columns", terms: "inline separate block postponed" },
  { key: "closed_sections_sort_alpha", label: "Sort Postponed and Done alphabetically", group: "tasks.columns", terms: "waiting order abc" },
  { key: "cadence_group_order", label: "Day column section order", group: "tasks.columns", terms: "cadence groups" },
  { key: "daily_tasks_today_only", label: "Daily tasks only on today", group: "tasks.columns" },
  { key: "lists_sort_alpha", label: "Sort lists and their tasks alphabetically", group: "tasks.columns", terms: "order abc" },
  { key: "list_task_lines", label: "Task title lines in a list column", group: "tasks.columns", terms: "truncate clamp" },

  // --- Recurring & calendar ------------------------------------
  { key: "cadence_daily_min_per_year", label: "Daily bucket threshold", group: "recurring.buckets", terms: "firings per year" },
  { key: "cadence_weekly_min_per_year", label: "Weekly bucket threshold", group: "recurring.buckets", terms: "firings per year" },
  { key: "cadence_monthly_min_per_year", label: "Monthly bucket threshold", group: "recurring.buckets", terms: "firings per year" },

  { key: "catchup_days", label: "Recurring catch-up window", group: "recurring.generation", terms: "missed" },
  { key: "cron_ignore_time", label: "Catch up crons by calendar day", group: "recurring.generation", terms: "missed time" },

  { key: "calendar_daily_days", label: "Calendar: daily rules ahead", group: "recurring.calendar", terms: "horizon projection outlook" },
  { key: "calendar_weekly_weeks", label: "Calendar: weekly rules ahead", group: "recurring.calendar", terms: "horizon projection outlook" },
  { key: "calendar_monthly_months", label: "Calendar: monthly rules ahead", group: "recurring.calendar", terms: "horizon projection outlook" },
  { key: "calendar_yearly_years", label: "Calendar: yearly rules ahead", group: "recurring.calendar", terms: "horizon projection outlook" },
  { key: "calendar_dates_years", label: "Calendar: exact dates ahead", group: "recurring.calendar", terms: "horizon birthdays projection" },

  // --- Capture & alerts ----------------------------------------
  { key: "capture_list", label: "Quick-capture list", group: "capture.capture", terms: "inbox" },
  // desktop-only (see docs/windows/ARCHITECTURE.md): the global
  // shortcut and the tray need a window manager the phone has not got
  { key: "capture_shortcut", label: "Global capture shortcut", group: "capture.capture", terms: "hotkey" },
  { key: "tray_icon", label: "Keep running in the tray", group: "capture.capture", terms: "system tray close minimize hide" },

  { key: "notify_system", label: "System notifications for due tasks", group: "capture.alerts", terms: "os toast" },
  { key: "notify_lead_minutes", label: "Remind ahead of a timed task", group: "capture.alerts", terms: "reminder early before minutes notification" },

  // --- Data ----------------------------------------------------
  { key: "kb_path", label: "Notes folder", group: "data.vault", terms: "kb vault path" },

  { key: "kb_line_numbers", label: "Line numbers in the Notes editor", group: "data.notes" },
  { key: "notes_timestamps", label: "Created and Last edited lines", group: "data.notes", terms: "timestamps frontmatter" },
  { key: "journal_day_tasks", label: "Tasks of the day in the Journal", group: "data.notes", terms: "journal entry done open strip" },

  { key: "tasks_mirror", label: "Mirror tasks to Markdown files", group: "data.mirror", terms: "bulk edit files" },
  { key: "tasks_mirror_today", label: "today.md day sheet", group: "data.mirror" },

  { key: "backup_keep", label: "Backups to keep", group: "data.backups", terms: "snapshots restore" },

  { key: "clear_done_list_tasks", label: "Clear done list tasks at rollover", group: "data.cleanup" },
  { key: "retention_days", label: "Retention of done one-off tasks", group: "data.cleanup", terms: "prune history" },

  // --- Sync ----------------------------------------------------
  { key: "sync_auto", label: "Sync automatically", group: "sync.schedule", terms: "google drive auto" },
];

const IN_COLORS_YML =
  "a color (or a switch that only picks or tunes colors): lives in the synced config/colors.yml, edited in Notes > Config";

const IN_APP_YML =
  "fine-tuning with a sane default: edited in app.yml (Notes > Config) rather than shown here, so Settings stays short";

/**
 * Fields with no control on this page, each for a reason - the test
 * treats anything else missing from the catalog as an oversight.
 */
export const EXCLUDED_KEYS: { key: keyof AppConfig; why: string }[] = [
  {
    key: "settings_advanced",
    why: "the page's own Show advanced settings switch, at the top of the page rather than in a group it would hide",
  },
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
  {
    key: "days_page_columns",
    why: "set by the Days dropdown on the Days page header",
  },
  {
    key: "list_columns",
    why: "set by the Lists dropdown on the dashboard header, over the list zone it resizes",
  },
  {
    key: "lists_page_columns",
    why: "set by the Lists dropdown on the Lists page header",
  },
  {
    key: "lists_group_display",
    why: "the Groups Folded/Flat switch on the dashboard and Lists page headers",
  },
  {
    key: "dashboard_split",
    why: "dragged on the dashboard's divider",
  },
  {
    key: "folded_sections",
    why: "a click on a section plate folds or opens it, and the app remembers",
  },
  { key: "mobile_safe_area_top", why: "mobile only - status bar inset floor, app.yml" },
  { key: "mobile_safe_area_bottom", why: "mobile only - gesture bar inset floor, app.yml" },
  // the color scheme
  { key: "accent_color", why: IN_COLORS_YML },
  { key: "color_min_contrast", why: IN_COLORS_YML },
  { key: "surface_color", why: IN_COLORS_YML },
  { key: "surface_alt_color", why: IN_COLORS_YML },
  { key: "line_color", why: IN_COLORS_YML },
  { key: "content_color", why: IN_COLORS_YML },
  { key: "content_muted_color", why: IN_COLORS_YML },
  { key: "weekly_focus_color", why: IN_COLORS_YML },
  { key: "cadence_colors", why: IN_COLORS_YML },
  { key: "cadence_color_general", why: IN_COLORS_YML },
  { key: "cadence_color_daily", why: IN_COLORS_YML },
  { key: "cadence_color_weekly", why: IN_COLORS_YML },
  { key: "cadence_color_monthly", why: IN_COLORS_YML },
  { key: "cadence_color_yearly", why: IN_COLORS_YML },
  { key: "cadence_color_exact", why: IN_COLORS_YML },
  { key: "done_color", why: IN_COLORS_YML },
  { key: "waiting_color", why: IN_COLORS_YML },
  { key: "dropped_color", why: IN_COLORS_YML },
  { key: "category_color", why: IN_COLORS_YML },
  { key: "category_color_mode", why: IN_COLORS_YML },
  { key: "category_avoid_cadence_colors", why: IN_COLORS_YML },
  { key: "category_color_a", why: IN_COLORS_YML },
  { key: "category_color_b", why: IN_COLORS_YML },
  { key: "dow_label_color", why: IN_COLORS_YML },
  { key: "dow_label_opacity", why: IN_COLORS_YML },
  { key: "habit_rate_alert_color", why: IN_COLORS_YML },
  { key: "postponed_plate_color", why: IN_COLORS_YML },
  { key: "waiting_plate_color", why: IN_COLORS_YML },
  { key: "done_plate_color", why: IN_COLORS_YML },
  { key: "dropped_plate_color", why: IN_COLORS_YML },
  { key: "reminder_color", why: IN_COLORS_YML },
  { key: "day_header_color", why: IN_COLORS_YML },
  { key: "list_exact_stripe", why: IN_COLORS_YML },
  { key: "list_date_chip_color", why: IN_COLORS_YML },
  // fine-tuning
  { key: "list_view_plate_scale", why: IN_APP_YML },
  { key: "list_gap_stripe", why: IN_APP_YML },
  { key: "row_hairlines", why: IN_APP_YML },
  { key: "section_plate_count", why: IN_APP_YML },
  { key: "section_plate_sticky", why: IN_APP_YML },
  { key: "closed_row_opacity", why: IN_APP_YML },
  { key: "day_header_centered", why: IN_APP_YML },
  { key: "lists_page_align_rows", why: IN_APP_YML },
  { key: "chip_font_scale", why: IN_APP_YML },
  { key: "done_hold_seconds", why: IN_APP_YML },
  { key: "undo_toast_seconds", why: IN_APP_YML },
  { key: "list_dialog_task_lines", why: IN_APP_YML },
  { key: "habit_rate_window", why: IN_APP_YML },
  { key: "habit_rate_min_instances", why: IN_APP_YML },
  { key: "notify_snooze_minutes", why: IN_APP_YML },
  { key: "notify_toast_seconds", why: IN_APP_YML },
  { key: "log_max_kb", why: IN_APP_YML },
  { key: "sync_interval_minutes", why: IN_APP_YML },
  { key: "sync_debounce_seconds", why: IN_APP_YML },
  { key: "sync_on_focus", why: IN_APP_YML },
  { key: "sync_on_leave", why: IN_APP_YML },
  { key: "sync_mass_delete_guard_percent", why: IN_APP_YML },
  { key: "tasks_mirror_ids", why: IN_APP_YML },
  { key: "tasks_mirror_agenda", why: IN_APP_YML },
  { key: "tasks_mirror_today_days", why: IN_APP_YML },
  { key: "streak_strip_days", why: IN_APP_YML },
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

/**
 * Whether a tab has anything to show with the advanced groups hidden:
 * a basic group, or an advanced one `inUse` says is already changed.
 */
export function tabShowsWithoutAdvanced(
  tab: SettingsTab,
  inUse: (id: SettingsGroupId) => boolean,
): boolean {
  return (Object.entries(SETTINGS_GROUPS) as [SettingsGroupId, GroupDef][]).some(
    ([id, g]) => g.tab === tab && (!g.advanced || inUse(id)),
  );
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
