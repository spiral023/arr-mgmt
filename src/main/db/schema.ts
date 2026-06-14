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
  "perf_samples",
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

/** Phase of work a performance sample belongs to. */
export type PerfPhase = "grab" | "search" | "analysis";

/**
 * The specific sub-operation timed within a phase. For grabs:
 * - `season_refetch`: one season-level indexer query shared across all episodes of a season (Sonarr)
 * - `refetch`: per-item indexer re-query (Radarr movies, or Sonarr fallback when the season query missed)
 * - `grab_post`: the grab POST issued after a successful re-match
 * - `grab_total`: end-to-end time for one candidate
 */
export type PerfOperation = "grab_total" | "season_refetch" | "refetch" | "grab_post";

export type PerfOutcome = "success" | "failed" | "skipped";

export type PerfSampleInsert = {
  jobId?: string | null;
  app?: string | null;
  phase: PerfPhase;
  operation: PerfOperation;
  childArrId?: number | null;
  strategy?: string | null;
  outcome: PerfOutcome;
  durationMs: number;
  detail?: string | null;
  createdAt: Date;
};
