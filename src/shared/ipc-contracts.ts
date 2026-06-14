export type IpcChannel =
  | "settings:get"
  | "settings:update"
  | "instances:list"
  | "instances:save"
  | "instances:test"
  | "library:summary"
  | "library:sonarr"
  | "library:radarr"
  | "activity:recent"
  | "jobs:list"
  | "jobs:events"
  | "jobs:enqueue"
  | "jobs:cancel"
  | "quota:summary"
  | "sonarr:search"
  | "sonarr:grab"
  | "sonarr:openSeries";

export type SonarrSeriesActionInput = {
  seriesIds: number[];
};

export type SonarrActionResult = {
  ok: boolean;
  message: string;
  jobId?: string;
  searchedEpisodes?: number;
  candidatesFound?: number;
  grabbed?: number;
  failed?: number;
};

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
