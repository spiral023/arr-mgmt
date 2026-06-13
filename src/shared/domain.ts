export type ArrInstanceKind = "sonarr" | "radarr";

export type MediaKind = "series" | "movie";

export type ScheduleAction = "analysis" | "search" | "grab";

export type ActivityAction = ScheduleAction | "manual_grab_entry" | "notification";

export type QuotaActionType = "search" | "grab";

export type QuotaType = "none" | QuotaActionType;

export type ScheduleIntervalKind = "minutes" | "hours" | "days" | "daily_time";

export type DateInput = Date | string | number;

export const QUOTA_ACTION_TYPES: readonly QuotaActionType[] = ["search", "grab"];

export const SCHEDULE_INTERVAL_KINDS: readonly ScheduleIntervalKind[] = [
  "minutes",
  "hours",
  "days",
  "daily_time",
];
