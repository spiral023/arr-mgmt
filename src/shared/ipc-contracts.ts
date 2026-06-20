import type { ScheduleAction, ScheduleIntervalKind } from "./domain";

export type { ScheduleAction, ScheduleIntervalKind };

export type IpcChannel =
  | "settings:get"
  | "settings:update"
  | "schedules:list"
  | "schedules:save"
  | "schedules:delete"
  | "instances:list"
  | "instances:save"
  | "instances:test"
  | "library:summary"
  | "library:sonarr"
  | "library:radarr"
  | "library:itemDetails"
  | "stats:summary"
  | "activity:recent"
  | "jobs:list"
  | "jobs:events"
  | "jobs:enqueue"
  | "jobs:cancel"
  | "quota:summary"
  | "quota:manualGrab"
  | "sonarr:search"
  | "sonarr:grab"
  | "sonarr:openSeries"
  | "radarr:search"
  | "radarr:grab"
  | "radarr:openMovie"
  | "onboarding:complete"
  | "jobs:runCombined"
  | "jobs:resume"
  | "automation:listGoals"
  | "automation:getGoal"
  | "automation:saveGoal"
  | "automation:deleteGoal"
  | "automation:reorderGoals"
  | "automation:pauseGoal"
  | "automation:resumeGoal"
  | "automation:runGoal"
  | "automation:runEligible"
  | "automation:listEvents";

export type SonarrSeriesActionInput = {
  seriesIds: number[];
};

export type RadarrMovieActionInput = {
  movieIds: number[];
};

export type ArrActionResult = {
  ok: boolean;
  message: string;
  jobId?: string;
  searchedEpisodes?: number;
  candidatesFound?: number;
  grabbed?: number;
  failed?: number;
};

export type SonarrActionResult = ArrActionResult;
export type RadarrActionResult = ArrActionResult;

export type InstanceKind = "sonarr" | "radarr";

export type InstanceConfigInput = {
  kind: InstanceKind;
  name: string;
  baseUrl: string;
  apiKey?: string;
  enabled?: boolean;
};

export type InstanceConfigView = {
  kind: InstanceKind;
  name: string;
  baseUrl: string;
  enabled: boolean;
  hasApiKey: boolean;
};

export type InstanceTestResult = {
  ok: boolean;
  message: string;
  version?: string;
};

export type SonarrSeriesTableRow = {
  id: string;
  arrId: number;
  title: string;
  titleSlug?: string;
  monitored: boolean;
  episodes: number;
  files: number;
  totalSizeBytes: number;
  funFiles: number;
  funShare: number;
  nonFunFiles: number;
  pendingFunCandidates: number;
  isExcluded: boolean;
  hasFiles: boolean;
  lastAnalyzed: string;
  lastSearched: string;
  lastGrabbed: string;
  status: "ready" | "searchable" | "cooldown" | "failed";
  qualityProfileName?: string;
};

export type RadarrMovieTableRow = {
  id: string;
  arrId: number;
  title: string;
  year?: number;
  monitored: boolean;
  hasFiles: boolean;
  files: number;
  sizeBytes: number;
  funFiles: number;
  funShare: number;
  nonFunFiles: number;
  pendingFunCandidates: number;
  isExcluded: boolean;
  releaseGroup: string | null;
  isFun: boolean;
  lastAnalyzed: string;
  lastSearched: string;
  lastGrabbed: string;
  status: "ready" | "searchable" | "cooldown" | "failed";
  qualityProfileName?: string;
};

export type MediaItemDetailsInput = {
  kind: "series" | "movie";
  arrId: number;
};

export type NonFunFileView = {
  childArrId: number;
  seasonNumber: number | null;
  episodeNumber: number | null;
  relativePath: string | null;
  releaseGroup: string | null;
  quality: string | null;
  sizeBytes: number;
};

export type ReleaseCandidateView = {
  id: number;
  childArrId: number;
  title: string;
  releaseGroup: string | null;
  quality: string | null;
  indexer: string | null;
  sizeBytes: number;
  approved: boolean | null;
  foundAt: string;
};

export type MediaItemDetails = {
  kind: "series" | "movie";
  arrId: number;
  nonFunFiles: NonFunFileView[];
  candidates: ReleaseCandidateView[];
};

export type JobStatus = "queued" | "running" | "blocked_by_budget" | "completed" | "failed" | "cancelled";

export type JobView = {
  id: string;
  name: string;
  kind: "analysis" | "search" | "grab" | "combined" | "automation";
  target: "all" | "sonarr" | "radarr" | "selected";
  status: JobStatus;
  progressCurrent: number;
  progressTotal: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type JobEventView = {
  jobId: string;
  level: "info" | "warning" | "error";
  message: string;
  createdAt: string;
};

export type LibrarySummary = {
  totalSeries: number;
  totalMovies: number;
  totalFiles: number;
  totalSizeBytes: number;
  funFiles: number;
  funShare: number;
  sonarrFunShare: number;
  radarrFunShare: number;
  sonarrPendingFunCandidates: number;
  radarrPendingFunCandidates: number;
  successfulGrabs: number;
};

export type CoverageHistoryPoint = {
  date: string;
  sonarrFunShare: number;
  radarrFunShare: number;
  totalFunShare: number;
};

export type DailyActivityPoint = {
  date: string;
  analyses: number;
  searches: number;
  grabs: number;
  failed: number;
};

export type StatsSummary = {
  coverageHistory: CoverageHistoryPoint[];
  dailyActivity: DailyActivityPoint[];
  totals: {
    searches: number;
    grabs: number;
    analyses: number;
    failed: number;
  };
};

export type QuotaSummary = {
  search: { used: number; remaining: number; limit: number };
  grab: { used: number; remaining: number; limit: number };
};

export type AppSettings = {
  automation: { quotaSafetyPercent: number };
  cooldownHours: { episodeSearch: number; movieSearch: number };
  fun: { displayName: string; prefixes: string[] };
  notifications: {
    jobFinished: boolean;
    quotaExhausted: boolean;
    candidatesFound: boolean;
  };
  quota: { searchLimit: number; grabLimit: number; windowHours: number };
  tray: { keepRunningOnClose: boolean; openAtLogin: boolean; showControls: boolean };
};

export type AppSettingsInput = Partial<{
  automation: Partial<AppSettings["automation"]>;
  cooldownHours: Partial<AppSettings["cooldownHours"]>;
  fun: Partial<AppSettings["fun"]>;
  notifications: Partial<AppSettings["notifications"]>;
  quota: Partial<AppSettings["quota"]>;
  tray: Partial<AppSettings["tray"]>;
}>;

export type SettingsViewModel = {
  appSettings: AppSettings;
  instances: InstanceConfigView[];
  onboardingCompleted: boolean;
};

export type ManualGrabInput = {
  count: number;
  note: string;
};

export type ScheduleTargetScope = "all" | "sonarr" | "radarr";

export type ScheduleInput = {
  id?: number;
  name: string;
  enabled: boolean;
  actions: ScheduleAction[];
  targetScope: ScheduleTargetScope;
  intervalKind: ScheduleIntervalKind;
  intervalValue?: number;
  timeOfDay?: string;
};

export type ScheduleView = ScheduleInput & {
  id: number;
  nextRunAt: string;
  lastRunAt?: string;
};

export type AutomationScope = "sonarr" | "radarr" | "both";
export type AutomationActionMode = "search_only" | "search_and_grab";
export type AutomationExecutionStrategy = "grab_immediately" | "search_then_grab";
export type AutomationOrdering = "oldest_search_first" | "lowest_fun_share_first" | "largest_impact_first" | "alphabetical";
export type AutomationManualStatus = "active" | "paused_by_user";
export type AutomationRunTrigger = "startup" | "schedule" | "manual" | "resume";
export type AutomationRunStatus =
  | "running"
  | "completed"
  | "waiting_for_quota"
  | "target_reached"
  | "blocked_by_error"
  | "cancelled";
export type AutomationGoalStatus =
  | "enabled"
  | "running"
  | "paused"
  | "waiting_for_quota"
  | "waiting_for_schedule"
  | "blocked_by_error"
  | "target_reached";

export type AutomationTriState = "yes" | "no" | "either";
export type AutomationRecencyFilter =
  | { mode: "any" }
  | { mode: "never" }
  | { mode: "older_than"; days: number }
  | { mode: "within_last"; days: number };

export type AutomationGoalFilters = {
  monitored: AutomationTriState;
  hasFile: AutomationTriState;
  qualityProfiles: string[];
  funShare: { operator: "lt" | "lte" | "gt" | "gte"; value: number } | null;
  analyzed: AutomationRecencyFilter;
  searched: AutomationRecencyFilter;
  grabbed: AutomationRecencyFilter;
};

export type AutomationGoalInput = {
  id?: number;
  name: string;
  enabled: boolean;
  scope: AutomationScope;
  targetFunShare: number;
  filters: AutomationGoalFilters;
  actionMode: AutomationActionMode;
  executionStrategy: AutomationExecutionStrategy;
  ordering: AutomationOrdering;
  minSearchIntervalHours: number;
  runOnStartup: boolean;
  schedule: Pick<ScheduleInput, "enabled" | "intervalKind" | "intervalValue" | "timeOfDay"> | null;
};

export type AutomationGoalView = AutomationGoalInput & {
  id: number;
  priority: number;
  manualStatus: AutomationManualStatus;
  status: AutomationGoalStatus;
  currentFunShare: number;
  matchingFiles: number;
  remainingNonFunFiles: number;
  pendingCandidates: number;
  lastRunAt?: string;
  nextEligibleRunAt?: string;
  lastError?: string;
};

export type AutomationWorkItemStatus =
  | "pending"
  | "searching"
  | "candidate_found"
  | "grabbed"
  | "satisfied"
  | "cooldown"
  | "out_of_scope"
  | "failed";

export type AutomationWorkItemView = {
  id: number;
  goalId: number;
  instanceId: number;
  mediaItemId: number;
  mediaFileId: number | null;
  childArrId: number;
  kind: "episode" | "movie";
  title: string;
  sortKey: string;
  isFun: boolean;
  status: AutomationWorkItemStatus;
  lastAnalyzedAt: string | null;
  lastSearchedAt: string | null;
  lastGrabbedAt: string | null;
  searchAttemptCount: number;
  lastError: string | null;
  updatedAt: string;
};

export type AutomationRunView = {
  id: number;
  goalId: number;
  trigger: AutomationRunTrigger;
  status: AutomationRunStatus;
  progressCurrent: number;
  progressTotal: number;
  startedAt: string;
  jobId?: string;
  finishedAt?: string;
};

export type AutomationEventView = {
  id: number;
  goalId: number;
  runId?: number;
  level: "info" | "warning" | "error";
  message: string;
  createdAt: string;
};

export type AutomationGoalIdInput = { goalId: number };
export type AutomationReorderInput = { goalIds: number[] };

export type ScheduleDeleteInput = {
  id: number;
};

export type ActivityRowView = {
  action: string;
  app: string;
  at: string;
  item: string;
  quota: string;
  status: string;
};

export type RunCombinedInput = {
  target: "sonarr" | "radarr" | "all" | "selected";
  seriesIds?: number[];
  movieIds?: number[];
};

export type ResumeJobInput = { jobId: string };

export type RendererApi = {
  invoke: <T = unknown>(channel: IpcChannel, payload?: unknown) => Promise<T>;
  onJobEvent: (callback: (payload: unknown) => void) => () => void;
};

declare global {
  interface Window {
    arrOps: RendererApi;
  }
}
