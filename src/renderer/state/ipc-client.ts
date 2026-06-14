import type {
  ActivityRowView,
  AppSettingsInput,
  InstanceConfigInput,
  InstanceConfigView,
  InstanceTestResult,
  IpcChannel,
  JobEventView,
  JobView,
  LibrarySummary,
  ManualGrabInput,
  MediaItemDetails,
  MediaItemDetailsInput,
  QuotaSummary,
  RadarrActionResult,
  RadarrMovieActionInput,
  RadarrMovieTableRow,
  ScheduleDeleteInput,
  ScheduleInput,
  ScheduleView,
  SonarrActionResult,
  SonarrSeriesTableRow,
  SonarrSeriesActionInput,
  SettingsViewModel,
  StatsSummary,
} from "../../shared/ipc-contracts";

export async function invokeIpc<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  if (!window.arrOps) {
    return getBrowserFallback<T>(channel);
  }
  return window.arrOps.invoke<T>(channel, payload);
}

export function listInstances(): Promise<InstanceConfigView[]> {
  return invokeIpc<InstanceConfigView[]>("instances:list");
}

export function saveInstance(input: InstanceConfigInput): Promise<InstanceConfigView> {
  return invokeIpc<InstanceConfigView>("instances:save", input);
}

export function testInstance(input: InstanceConfigInput): Promise<InstanceTestResult> {
  return invokeIpc<InstanceTestResult>("instances:test", input);
}

export function analyzeSonarr(seriesIds?: number[]): Promise<unknown> {
  return invokeIpc("jobs:enqueue", {
    name: seriesIds && seriesIds.length > 0 ? "Analyze selected Sonarr series" : "Analyze Sonarr",
    target: "sonarr",
    seriesIds,
  });
}

export function analyzeSonarrSample(): Promise<unknown> {
  return invokeIpc("jobs:enqueue", {
    name: "Analyze one Sonarr series",
    target: "sonarr",
    sampleSize: 1,
  });
}

export function analyzeRadarr(movieIds?: number[]): Promise<unknown> {
  return invokeIpc("jobs:enqueue", {
    name: movieIds && movieIds.length > 0 ? "Analyze selected Radarr movies" : "Analyze Radarr",
    target: "radarr",
    movieIds,
  });
}

export function analyzeRadarrSample(): Promise<unknown> {
  return invokeIpc("jobs:enqueue", {
    name: "Analyze one Radarr movie",
    target: "radarr",
    sampleSize: 1,
  });
}

export function getLibrarySummary(): Promise<LibrarySummary> {
  return invokeIpc<LibrarySummary>("library:summary");
}

export function getSonarrRows(): Promise<SonarrSeriesTableRow[]> {
  return invokeIpc<SonarrSeriesTableRow[]>("library:sonarr");
}

export function getRadarrRows(): Promise<RadarrMovieTableRow[]> {
  return invokeIpc<RadarrMovieTableRow[]>("library:radarr");
}

export function getItemDetails(kind: "series" | "movie", arrId: number): Promise<MediaItemDetails> {
  return invokeIpc<MediaItemDetails>("library:itemDetails", { kind, arrId } satisfies MediaItemDetailsInput);
}

export function listJobs(): Promise<JobView[]> {
  return invokeIpc<JobView[]>("jobs:list");
}

export function listJobEvents(jobId?: string): Promise<JobEventView[]> {
  return invokeIpc<JobEventView[]>("jobs:events", jobId ? { jobId } : undefined);
}

export function cancelJob(jobId: string): Promise<{ ok: boolean }> {
  return invokeIpc<{ ok: boolean }>("jobs:cancel", { jobId });
}

export function getQuotaSummary(): Promise<QuotaSummary> {
  return invokeIpc<QuotaSummary>("quota:summary");
}

export function recordManualGrab(input: ManualGrabInput): Promise<QuotaSummary> {
  return invokeIpc<QuotaSummary>("quota:manualGrab", input);
}

export function getRecentActivity(): Promise<ActivityRowView[]> {
  return invokeIpc<ActivityRowView[]>("activity:recent");
}

export function getStatsSummary(): Promise<StatsSummary> {
  return invokeIpc<StatsSummary>("stats:summary");
}

export function searchSonarrSeries(seriesIds: number[]): Promise<SonarrActionResult> {
  return invokeIpc<SonarrActionResult>("sonarr:search", { seriesIds } satisfies SonarrSeriesActionInput);
}

export function grabSonarrSeries(seriesIds: number[]): Promise<SonarrActionResult> {
  return invokeIpc<SonarrActionResult>("sonarr:grab", { seriesIds } satisfies SonarrSeriesActionInput);
}

export function searchRadarrMovies(movieIds: number[]): Promise<RadarrActionResult> {
  return invokeIpc<RadarrActionResult>("radarr:search", { movieIds } satisfies RadarrMovieActionInput);
}

export function grabRadarrMovies(movieIds: number[]): Promise<RadarrActionResult> {
  return invokeIpc<RadarrActionResult>("radarr:grab", { movieIds } satisfies RadarrMovieActionInput);
}

export function openSonarrSeries(seriesId: number, titleSlug?: string): Promise<{ ok: boolean }> {
  return invokeIpc<{ ok: boolean }>("sonarr:openSeries", { seriesId, titleSlug });
}

export function openRadarrMovie(movieId: number): Promise<{ ok: boolean }> {
  return invokeIpc<{ ok: boolean }>("radarr:openMovie", { movieId });
}

export function getSettings(): Promise<SettingsViewModel> {
  return invokeIpc<SettingsViewModel>("settings:get");
}

export function updateAppSettings(input: AppSettingsInput): Promise<SettingsViewModel["appSettings"]> {
  return invokeIpc<SettingsViewModel["appSettings"]>("settings:update", input);
}

export function listSchedules(): Promise<ScheduleView[]> {
  return invokeIpc<ScheduleView[]>("schedules:list");
}

export function saveSchedule(input: ScheduleInput): Promise<ScheduleView> {
  return invokeIpc<ScheduleView>("schedules:save", input);
}

export function deleteSchedule(input: ScheduleDeleteInput): Promise<{ ok: boolean }> {
  return invokeIpc<{ ok: boolean }>("schedules:delete", input);
}

export function completeOnboarding(): Promise<{ ok: boolean }> {
  return invokeIpc("onboarding:complete");
}

export function subscribeToJobEvents(callback: (payload: unknown) => void): () => void {
  if (!window.arrOps) {
    return () => undefined;
  }
  return window.arrOps.onJobEvent(callback);
}

function getBrowserFallback<T>(channel: IpcChannel): T {
  if (channel === "instances:list") {
    return [
      { kind: "sonarr", name: "Sonarr", baseUrl: "http://192.168.0.170:8989", enabled: true, hasApiKey: false },
      { kind: "radarr", name: "Radarr", baseUrl: "http://192.168.0.170:7878", enabled: true, hasApiKey: false },
    ] as T;
  }
  if (channel === "settings:get") {
    return {
      appSettings: {
        cooldownHours: { episodeSearch: 24, movieSearch: 24 },
        fun: { displayName: "FuN*", prefixes: ["fun"] },
        notifications: { candidatesFound: true, jobFinished: true, quotaExhausted: true },
        quota: { searchLimit: 2000, grabLimit: 400, windowHours: 24 },
        tray: { keepRunningOnClose: true, showControls: true },
      },
      instances: [
        { kind: "sonarr", name: "Sonarr", baseUrl: "http://192.168.0.170:8989", enabled: true, hasApiKey: false },
        { kind: "radarr", name: "Radarr", baseUrl: "http://192.168.0.170:7878", enabled: true, hasApiKey: false },
      ],
      onboardingCompleted: true,
    } as T;
  }
  if (channel === "schedules:list") {
    return [] as T;
  }
  if (channel === "schedules:save") {
    return {
      id: 1,
      name: "Nightly FuN completion",
      enabled: true,
      actions: ["analysis", "search"],
      targetScope: "all",
      intervalKind: "daily_time",
      timeOfDay: "03:30",
      nextRunAt: new Date().toISOString(),
    } as T;
  }
  if (channel === "schedules:delete") {
    return { ok: true } as T;
  }
  if (channel === "instances:test") {
    return { ok: false, message: "IPC is only available in the Electron app." } as T;
  }
  if (channel === "library:sonarr") {
    return [
      {
        arrId: 1203,
        episodes: 8,
        files: 8,
        funFiles: 3,
        funShare: 0.375,
        hasFiles: true,
        id: "series-1203",
        lastAnalyzed: "2026-06-13 21:10",
        lastGrabbed: "-",
        lastSearched: "2026-06-13 21:12",
        monitored: true,
        nonFunFiles: 5,
        pendingFunCandidates: 2,
        status: "searchable",
        title: "Criminal Record",
        titleSlug: "criminal-record",
        totalSizeBytes: 24_000_000_000,
      },
    ] as T;
  }
  if (channel === "library:radarr") {
    return [
      {
        arrId: 8222,
        files: 1,
        funFiles: 0,
        funShare: 0,
        hasFiles: true,
        id: "movie-8222",
        isFun: false,
        lastAnalyzed: "2026-06-13 21:53",
        lastGrabbed: "-",
        lastSearched: "2026-06-13 20:29",
        monitored: true,
        nonFunFiles: 1,
        pendingFunCandidates: 1,
        releaseGroup: "TSCC",
        sizeBytes: 8_900_000_000,
        status: "searchable",
        title: "Nicht noch ein Teenie-Film",
        year: 2001,
      },
    ] as T;
  }
  if (channel === "jobs:list" || channel === "jobs:events" || channel === "activity:recent") {
    return [] as T;
  }
  if (channel === "library:itemDetails") {
    return { kind: "series", arrId: 0, nonFunFiles: [], candidates: [] } as T;
  }
  if (channel === "library:summary") {
    return {
      totalSeries: 0,
      totalMovies: 0,
      totalFiles: 0,
      totalSizeBytes: 0,
      funFiles: 0,
      funShare: 0,
      sonarrFunShare: 0,
      radarrFunShare: 0,
      sonarrPendingFunCandidates: 0,
      radarrPendingFunCandidates: 0,
      successfulGrabs: 0,
    } as T;
  }
  if (channel === "stats:summary") {
    return { coverageHistory: [], dailyActivity: [], totals: { analyses: 0, searches: 0, grabs: 0, failed: 0 } } as T;
  }
  if (channel === "quota:summary") {
    return {
      search: { used: 0, remaining: 2000, limit: 2000 },
      grab: { used: 0, remaining: 400, limit: 400 },
    } as T;
  }
  if (channel === "quota:manualGrab") {
    return {
      search: { used: 0, remaining: 2000, limit: 2000 },
      grab: { used: 1, remaining: 399, limit: 400 },
    } as T;
  }
  return {} as T;
}
