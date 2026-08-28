export type Theme = "dark" | "light";
export type DoneDisplay = "inline" | "separate";

export interface AppConfig {
  theme: Theme;
  grid_columns: number;
  done_display: DoneDisplay;
  retention_days: number;
  catchup_days: number;
  kb_path: string;
  journal_template: string;
}

export type Section =
  | "dashboard"
  | "upcoming"
  | "journal"
  | "kb"
  | "settings";
