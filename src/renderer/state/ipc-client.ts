import type {
  ActivityRowView,
  InstanceConfigInput,
  InstanceConfigView,
  InstanceTestResult,
  IpcChannel,
  JobEventView,
  JobView,
  LibrarySummary,
  QuotaSummary,
  SonarrActionResult,
  SonarrSeriesTableRow,
  SonarrSeriesActionInput,
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

export function getLibrarySummary(): Promise<LibrarySummary> {
  return invokeIpc<LibrarySummary>("library:summary");
}

export function getSonarrRows(): Promise<SonarrSeriesTableRow[]> {
  return invokeIpc<SonarrSeriesTableRow[]>("library:sonarr");
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

export function getRecentActivity(): Promise<ActivityRowView[]> {
  return invokeIpc<ActivityRowView[]>("activity:recent");
}

export function searchSonarrSeries(seriesIds: number[]): Promise<SonarrActionResult> {
  return invokeIpc<SonarrActionResult>("sonarr:search", { seriesIds } satisfies SonarrSeriesActionInput);
}

export function grabSonarrSeries(seriesIds: number[]): Promise<SonarrActionResult> {
  return invokeIpc<SonarrActionResult>("sonarr:grab", { seriesIds } satisfies SonarrSeriesActionInput);
}

export function openSonarrSeries(seriesId: number, titleSlug?: string): Promise<{ ok: boolean }> {
  return invokeIpc<{ ok: boolean }>("sonarr:openSeries", { seriesId, titleSlug });
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
  if (channel === "instances:test") {
    return { ok: false, message: "IPC is only available in the Electron app." } as T;
  }
  if (channel === "library:sonarr") {
    return [] as T;
  }
  if (channel === "jobs:list" || channel === "jobs:events" || channel === "activity:recent") {
    return [] as T;
  }
  if (channel === "library:summary") {
    return { totalSeries: 0, totalMovies: 0, totalFiles: 0, totalSizeBytes: 0, funFiles: 0, funShare: 0 } as T;
  }
  if (channel === "quota:summary") {
    return {
      search: { used: 0, remaining: 2000, limit: 2000 },
      grab: { used: 0, remaining: 400, limit: 400 },
    } as T;
  }
  return {} as T;
}
