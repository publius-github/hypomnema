export type Theme = "dark" | "light";
export type DoneDisplay = "inline" | "separate";

export interface AppConfig {
  theme: Theme;
  grid_columns: number;
  done_display: DoneDisplay;
  retention_days: number;
  catchup_days: number;
  cron_ignore_time: boolean;
  kb_path: string;
  journal_template: string;
}

export type Section =
  | "dashboard"
  | "upcoming"
  | "recurring"
  | "journal"
  | "kb"
  | "settings";

export type TaskStatus = "todo" | "done" | "postponed";

export interface ConfigError {
  file: string;
  line: number | null;
  message: string;
}

export interface ScheduleBlock {
  from: string;
  to: string;
  label: string;
}

export interface DayContext {
  date: string;
  reminders: string[];
}

export interface DashboardContext {
  focus: string | null;
  days: DayContext[];
  blocks: ScheduleBlock[];
  errors: ConfigError[];
}

export interface RecurringRule {
  schedule: string;
  description: string;
  items: string[];
}

export interface UpcomingEvent {
  date: string;
  title: string;
  time: string | null;
}

export interface BirthdayView {
  name: string;
  date: string;
  year: number | null;
  next_occurrence: string;
  days_until: number;
  turns: number | null;
}

export interface EngineOutcome {
  generated: number;
  carried_over: number;
  pruned: number;
  removed: number;
  errors: ConfigError[];
}

export interface List {
  id: number;
  name: string;
  sort_order: number;
  color: string | null;
  archived: boolean;
}

export interface Task {
  id: number;
  title: string;
  description_md: string;
  list_id: number | null;
  scheduled_date: string | null;
  time: string | null;
  status: TaskStatus;
  color: string | null;
  sort_order: number;
  parent_task_id: number | null;
  created_at: string;
  completed_at: string | null;
  overdue: boolean;
  origin: string;
}

export interface NewTask {
  title: string;
  description_md?: string;
  list_id?: number | null;
  scheduled_date?: string | null;
  time?: string | null;
  color?: string | null;
  parent_task_id?: number | null;
}

// A field set to null clears the column; an absent field is untouched.
export interface TaskPatch {
  title?: string;
  description_md?: string;
  list_id?: number | null;
  scheduled_date?: string | null;
  time?: string | null;
  status?: TaskStatus;
  color?: string | null;
  sort_order?: number;
}
