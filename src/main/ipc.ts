import { ipcMain, shell } from "electron";
import { analyzeSonarrSeries } from "./arr/analysis-service";
import { RadarrClient } from "./arr/radarr-client";
import { selectSonarrSeriesForAnalysis } from "./arr/sonarr-analysis-plan";
import { SonarrClient } from "./arr/sonarr-client";
import { getNonFunEpisodeIds, selectBestFunRelease } from "./arr/sonarr-operations";
import { mapConcurrent } from "./async/map-concurrent";
import type { createRepositories } from "./db/repositories";
import type { InstanceStore } from "./instances/instance-store";
import type { JobContext, JobRunner } from "./scheduler/job-runner";
import type {
  ActivityRowView,
  InstanceConfigInput,
  InstanceKind,
  InstanceTestResult,
  JobEventView,
  JobView,
  LibrarySummary,
  QuotaSummary,
  SonarrActionResult,
  SonarrSeriesActionInput,
} from "../shared/ipc-contracts";

export type IpcState = {
  instanceStore: InstanceStore;
  jobRunner: JobRunner;
  repositories: ReturnType<typeof createRepositories>;
};

const ANALYSIS_CONCURRENCY = 4;
const EPISODE_LOAD_CONCURRENCY = 8;
const SEARCH_CONCURRENCY = 12;
const GRAB_CONCURRENCY = 4;
const SEARCH_LIMIT = 2_000;
const GRAB_LIMIT = 400;

export function registerIpcHandlers(state: IpcState): void {
  ipcMain.handle("jobs:list", (): JobView[] => state.jobRunner.listJobs());
  ipcMain.handle("jobs:events", (_event, payload: unknown): JobEventView[] => {
    const jobId =
      typeof payload === "object" && payload !== null && "jobId" in payload && typeof payload.jobId === "string"
        ? payload.jobId
        : undefined;
    return state.jobRunner.listEvents(jobId);
  });
  ipcMain.handle("jobs:cancel", (_event, payload: unknown) => {
    const jobId =
      typeof payload === "object" && payload !== null && "jobId" in payload && typeof payload.jobId === "string"
        ? payload.jobId
        : undefined;
    if (!jobId) {
      throw new Error("jobId is required");
    }
    return { ok: state.jobRunner.cancel(jobId) };
  });
  ipcMain.handle("jobs:enqueue", async (_event, payload: unknown) => {
    const name =
      typeof payload === "object" && payload !== null && "name" in payload && typeof payload.name === "string"
        ? payload.name
        : "Manual job";
    const target =
      typeof payload === "object" && payload !== null && "target" in payload && typeof payload.target === "string"
        ? payload.target
        : "";

    if (target === "sonarr") {
      const seriesIds =
        typeof payload === "object" && payload !== null && "seriesIds" in payload && Array.isArray(payload.seriesIds)
          ? payload.seriesIds.filter((id): id is number => Number.isInteger(id) && id > 0)
          : undefined;
      return enqueueSonarrAnalysis(state, name, seriesIds);
    }

    return state.jobRunner.enqueue({
      name,
      kind: "analysis",
      target: "all",
      steps: [async () => undefined],
    });
  });
  ipcMain.handle("library:summary", (): LibrarySummary => state.repositories.mediaItems.summary());
  ipcMain.handle("library:sonarr", () => state.repositories.mediaItems.listSonarrRows().map(formatSonarrRowDates));
  ipcMain.handle("library:radarr", () => []);
  ipcMain.handle("activity:recent", (): ActivityRowView[] => state.repositories.activityLog.listRecent(50).map(formatActivityRow));
  ipcMain.handle("quota:summary", (): QuotaSummary => {
    const now = new Date();
    const searchUsed = state.repositories.activityLog.countSince("search", now, 24);
    const grabUsed = state.repositories.activityLog.countSince("grab", now, 24);
    return {
      search: { used: searchUsed, remaining: Math.max(0, SEARCH_LIMIT - searchUsed), limit: SEARCH_LIMIT },
      grab: { used: grabUsed, remaining: Math.max(0, GRAB_LIMIT - grabUsed), limit: GRAB_LIMIT },
    };
  });
  ipcMain.handle("sonarr:search", (_event, payload: unknown): SonarrActionResult => {
    const input = assertSeriesActionInput(payload);
    const job = enqueueSonarrSearch(state, input);
    return {
      ok: true,
      jobId: job.id,
      message: `Queued search for ${input.seriesIds.length} Sonarr series.`,
    };
  });
  ipcMain.handle("sonarr:grab", (_event, payload: unknown): SonarrActionResult => {
    const input = assertSeriesActionInput(payload);
    const job = enqueueSonarrGrab(state, input);
    return {
      ok: true,
      jobId: job.id,
      message: `Queued grab for ${input.seriesIds.length} Sonarr series.`,
    };
  });
  ipcMain.handle("sonarr:openSeries", async (_event, payload: unknown) => {
    const seriesId =
      typeof payload === "object" && payload !== null && "seriesId" in payload && Number.isInteger(payload.seriesId)
        ? payload.seriesId
        : undefined;
    const titleSlug =
      typeof payload === "object" && payload !== null && "titleSlug" in payload && typeof payload.titleSlug === "string"
        ? payload.titleSlug
        : undefined;
    if (!seriesId) {
      throw new Error("seriesId is required");
    }
    const config = state.instanceStore.getWithApiKey("sonarr");
    const rows = state.repositories.mediaItems.listSonarrRows();
    const rowSlug = rows.find((row) => row.arrId === seriesId)?.titleSlug;
    await shell.openExternal(`${config.baseUrl.replace(/\/+$/, "")}/series/${encodeURIComponent(titleSlug ?? rowSlug ?? String(seriesId))}`);
    return { ok: true };
  });
  ipcMain.handle("settings:get", () => ({
    instances: state.instanceStore.list(),
  }));
  ipcMain.handle("settings:update", (_event, payload: unknown) => payload);
  ipcMain.handle("instances:list", () => state.instanceStore.list());
  ipcMain.handle("instances:save", (_event, payload: unknown) => {
    const input = assertInstanceInput(payload);
    const saved = state.instanceStore.save(input);
    state.repositories.instances.upsert({
      kind: saved.kind,
      name: saved.name,
      baseUrl: saved.baseUrl,
      apiKeyEncrypted: "managed-by-instance-store",
      enabled: saved.enabled,
      now: new Date(),
    });
    return saved;
  });
  ipcMain.handle("instances:test", async (_event, payload: unknown): Promise<InstanceTestResult> => {
    const input = assertInstanceInput(payload);
    try {
      const config = state.instanceStore.getWithApiKey(input.kind, input);
      const client =
        input.kind === "sonarr"
          ? new SonarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey })
          : new RadarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
      const status = await client.getStatus();
      return {
        ok: true,
        message: `${status.appName ?? input.kind} ${status.version ?? ""}`.trim(),
        version: status.version,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function enqueueSonarrAnalysis(state: IpcState, name = "Analyze Sonarr", seriesIds?: number[]) {
  return state.jobRunner.enqueue({
    name,
    kind: "analysis",
    target: seriesIds && seriesIds.length > 0 ? "selected" : "sonarr",
    progressTotal: seriesIds?.length,
    run: async (context) => analyzeSonarrLibrary(state, context, seriesIds),
  });
}

function enqueueSonarrSearch(state: IpcState, input: SonarrSeriesActionInput) {
  return state.jobRunner.enqueue({
    name: "Search non-FuN Sonarr episodes",
    kind: "search",
    target: "selected",
    progressTotal: input.seriesIds.length,
    run: async (context) => searchSonarrCandidates(state, input, context),
  });
}

function enqueueSonarrGrab(state: IpcState, input: SonarrSeriesActionInput) {
  return state.jobRunner.enqueue({
    name: "Grab Sonarr FuN candidates",
    kind: "grab",
    target: "selected",
    progressTotal: input.seriesIds.length,
    run: async (context) => grabSonarrCandidates(state, input, context),
  });
}

async function analyzeSonarrLibrary(state: IpcState, context: JobContext, seriesIds?: number[]): Promise<void> {
  const config = state.instanceStore.getWithApiKey("sonarr");
  const instanceId = upsertRuntimeInstance(state, "sonarr", config);
  const client = new SonarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const seriesList = await client.getSeries();
  const requestedSeriesIds = seriesIds && seriesIds.length > 0 ? new Set(seriesIds) : undefined;
  const matchingSeries = requestedSeriesIds ? seriesList.filter((series) => requestedSeriesIds.has(series.id)) : seriesList;
  const analyzedArrIds = new Set(state.repositories.mediaItems.listAnalyzedArrIds("series", instanceId));
  const seriesToAnalyze = requestedSeriesIds ? matchingSeries : selectSonarrSeriesForAnalysis(matchingSeries, analyzedArrIds);
  const analyzedAt = new Date();

  context.setProgressTotal(seriesToAnalyze.length);
  if (requestedSeriesIds) {
    context.addEvent("info", `Loaded ${seriesToAnalyze.length} selected Sonarr series`);
  } else if (seriesToAnalyze.length < matchingSeries.length) {
    context.addEvent(
      "info",
      `Resuming Sonarr analysis: ${matchingSeries.length - seriesToAnalyze.length} already stored, ${seriesToAnalyze.length} remaining`,
    );
  } else {
    context.addEvent("info", `Loaded ${matchingSeries.length} Sonarr series`);
  }

  await mapConcurrent(seriesToAnalyze, ANALYSIS_CONCURRENCY, async (series) => {
    try {
      context.throwIfCancelled();
      const episodes = await client.getEpisodes(series.id, true);
      context.throwIfCancelled();
      const item = analyzeSonarrSeries(series, episodes, analyzedAt);
      const mediaItemId = state.repositories.mediaItems.upsertAnalysis(instanceId, item);
      state.repositories.activityLog.insert({
        action: "analysis",
        quotaType: "none",
        status: "success",
        instanceId,
        mediaItemId,
        message: series.title,
        createdAt: new Date(),
      });
      context.incrementProgress();
    } catch (error) {
      state.repositories.activityLog.insert({
        action: "analysis",
        quotaType: "none",
        status: "failed",
        instanceId,
        message: `${series.title}: ${error instanceof Error ? error.message : String(error)}`,
        createdAt: new Date(),
      });
      context.incrementProgress({ failed: true });
    }
  });
}

async function searchSonarrCandidates(state: IpcState, input: SonarrSeriesActionInput, context: JobContext): Promise<void> {
  const config = state.instanceStore.getWithApiKey("sonarr");
  const instanceId = upsertRuntimeInstance(state, "sonarr", config);
  const client = new SonarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const seriesEpisodes = await mapConcurrent(input.seriesIds, EPISODE_LOAD_CONCURRENCY, async (seriesId) => {
    context.throwIfCancelled();
    const mediaItemId = state.repositories.mediaItems.findIdByArrId("series", seriesId, instanceId);
    const episodes = await client.getEpisodes(seriesId, true);
    return getNonFunEpisodeIds(episodes).map((episodeId) => ({ episodeId, mediaItemId, seriesId }));
  });
  const episodeTasks = seriesEpisodes.flat();
  let candidatesFound = 0;

  context.setProgressTotal(episodeTasks.length);
  context.addEvent("info", `Searching ${episodeTasks.length} non-FuN episodes with concurrency ${SEARCH_CONCURRENCY}`);

  await mapConcurrent(episodeTasks, SEARCH_CONCURRENCY, async (task) => {
    try {
      context.throwIfCancelled();
      const releases = await client.getReleasesForEpisode(task.episodeId);
      context.throwIfCancelled();
      const candidate = selectBestFunRelease(releases);
      if (candidate) {
        state.repositories.releaseCandidates.insert({
          instanceId,
          mediaItemId: task.mediaItemId,
          childArrId: task.episodeId,
          release: candidate,
          foundAt: new Date(),
        });
        candidatesFound += 1;
      }
      state.repositories.activityLog.insert({
        action: "search",
        quotaType: "search",
        status: "success",
        instanceId,
        mediaItemId: task.mediaItemId,
        childArrId: task.episodeId,
        message: candidate ? "FuN* candidate found" : "No FuN* candidate",
        createdAt: new Date(),
      });
      context.incrementProgress();
    } catch (error) {
      state.repositories.activityLog.insert({
        action: "search",
        quotaType: "search",
        status: "failed",
        instanceId,
        mediaItemId: task.mediaItemId,
        childArrId: task.episodeId,
        message: error instanceof Error ? error.message : String(error),
        createdAt: new Date(),
      });
      context.incrementProgress({ failed: true });
    }
  });
  context.addEvent("info", `Stored ${candidatesFound} FuN* candidates`);
}

async function grabSonarrCandidates(state: IpcState, input: SonarrSeriesActionInput, context: JobContext): Promise<void> {
  const config = state.instanceStore.getWithApiKey("sonarr");
  const instanceId = upsertRuntimeInstance(state, "sonarr", config);
  const client = new SonarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const candidates = state.repositories.releaseCandidates.listForSeriesIds(input.seriesIds);

  context.setProgressTotal(candidates.length);
  context.addEvent("info", `Grabbing ${candidates.length} stored FuN* candidates with concurrency ${GRAB_CONCURRENCY}`);

  await mapConcurrent(candidates, GRAB_CONCURRENCY, async (candidate) => {
    try {
      context.throwIfCancelled();
      await client.grabRelease(candidate.release);
      context.throwIfCancelled();
      state.repositories.releaseCandidates.delete(candidate.id);
      state.repositories.activityLog.insert({
        action: "grab",
        quotaType: "grab",
        status: "success",
        instanceId,
        mediaItemId: candidate.mediaItemId,
        childArrId: candidate.childArrId,
        message: candidate.release.title ?? "FuN* candidate grabbed",
        createdAt: new Date(),
      });
      context.incrementProgress();
    } catch (error) {
      state.repositories.activityLog.insert({
        action: "grab",
        quotaType: "grab",
        status: "failed",
        instanceId,
        mediaItemId: candidate.mediaItemId,
        childArrId: candidate.childArrId,
        message: error instanceof Error ? error.message : String(error),
        createdAt: new Date(),
      });
      context.incrementProgress({ failed: true });
    }
  });
}

function upsertRuntimeInstance(
  state: IpcState,
  kind: InstanceKind,
  config: { name: string; baseUrl: string; apiKey: string },
): number {
  return state.repositories.instances.upsert({
    kind,
    name: config.name,
    baseUrl: config.baseUrl,
    apiKeyEncrypted: "managed-by-instance-store",
    enabled: true,
    now: new Date(),
  });
}

function assertInstanceInput(payload: unknown): InstanceConfigInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid instance payload");
  }
  const value = payload as Partial<InstanceConfigInput>;
  if (value.kind !== "sonarr" && value.kind !== "radarr") {
    throw new Error("Invalid instance kind");
  }
  if (typeof value.name !== "string" || typeof value.baseUrl !== "string") {
    throw new Error("Instance name and base URL are required");
  }
  return {
    kind: value.kind,
    name: value.name,
    baseUrl: value.baseUrl,
    apiKey: typeof value.apiKey === "string" ? value.apiKey : undefined,
    enabled: value.enabled,
  };
}

function assertSeriesActionInput(payload: unknown): SonarrSeriesActionInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid Sonarr action payload");
  }
  const value = payload as Partial<SonarrSeriesActionInput>;
  if (!Array.isArray(value.seriesIds)) {
    throw new Error("seriesIds must be an array");
  }
  return {
    seriesIds: value.seriesIds.filter((id): id is number => Number.isInteger(id) && id > 0),
  };
}

function formatDateTime(value: string | undefined): string {
  if (!value || value === "-") return "-";
  const date = new Date(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function formatSonarrRowDates(row: ReturnType<IpcState["repositories"]["mediaItems"]["listSonarrRows"]>[number]) {
  return {
    ...row,
    lastAnalyzed: formatDateTime(row.lastAnalyzed),
    lastSearched: formatDateTime(row.lastSearched),
    lastGrabbed: formatDateTime(row.lastGrabbed),
  };
}

function formatActivityRow(row: ActivityRowView): ActivityRowView {
  return {
    ...row,
    app: row.app === "sonarr" ? "Sonarr" : row.app === "radarr" ? "Radarr" : "External",
    at: formatDateTime(row.at),
  };
}
