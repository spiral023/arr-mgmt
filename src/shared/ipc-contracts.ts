export type IpcChannel =
  | "settings:get"
  | "settings:update"
  | "instances:list"
  | "instances:save"
  | "instances:test"
  | "library:summary"
  | "library:sonarr"
  | "library:radarr"
  | "stats:summary"
  | "activity:recent"
  | "jobs:list"
  | "jobs:events"
  | "jobs:enqueue"
  | "jobs:cancel"
  | "quota:summary"
  | "sonarr:search"
  | "sonarr:grab"
  | "sonarr:openSeries"
  | "radarr:search"
  | "radarr:grab"
  | "radarr:openMovie"
  | "onboarding:complete";

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

export type ActivityRowView = {
  action: string;
  app: string;
  at: string;
  item: string;
  quota: string;
  status: string;
};

export type RendererApi = {
  invoke: <T = unknown>(channel: IpcChannel, payload?: unknown) => Promise<T>;
  onJobEvent: (callback: (payload: unknown) => void) => () => void;
};

declare global {
  interface Window {
    arrOps: RendererApi;
  }
}
