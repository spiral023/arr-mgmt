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
  | "jobs:resume";

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
  kind: "analysis" | "search" | "grab" | "combined";
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
  cooldownHours: { episodeSearch: number; movieSearch: number };
  fun: { displayName: string; prefixes: string[] };
  notifications: {
    jobFinished: boolean;
    quotaExhausted: boolean;
    candidatesFound: boolean;
  };
  quota: { searchLimit: number; grabLimit: number; windowHours: number };
  tray: { keepRunningOnClose: boolean; showControls: boolean };
};

export type AppSettingsInput = Partial<{
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
