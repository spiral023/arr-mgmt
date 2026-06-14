export const tableNames = [
  "instances",
  "media_items",
  "media_files",
  "release_candidates",
  "jobs",
  "job_events",
  "activity_log",
  "schedules",
  "settings",
  "coverage_snapshots",
] as const;

export type TableName = (typeof tableNames)[number];

export type QuotaType = "none" | "search" | "grab";
export type ActivityStatus = "started" | "success" | "failed" | "skipped" | "blocked_by_budget";
export type ActivityAction =
  | "analysis"
  | "search"
  | "grab"
  | "manual_grab_entry"
  | "notification";

export type ActivityInsert = {
  instanceId?: number | null;
  mediaItemId?: number | null;
  childArrId?: number | null;
  action: ActivityAction;
  quotaType: QuotaType;
  status: ActivityStatus;
  message?: string | null;
  payloadJson?: string | null;
  createdAt: Date;
};
