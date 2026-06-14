import { ipcMain, shell } from "electron";
import { analyzeRadarrMovies, analyzeSonarrSeries } from "./arr/analysis-service";
import { RadarrClient } from "./arr/radarr-client";
import { selectSonarrSeriesForAnalysis } from "./arr/sonarr-analysis-plan";
import { SonarrClient } from "./arr/sonarr-client";
import { getNonFunEpisodeIds, getNonFunMovieIds, selectBestFunRelease } from "./arr/sonarr-operations";
import { mapConcurrent } from "./async/map-concurrent";
import type { createRepositories } from "./db/repositories";
import type { InstanceStore } from "./instances/instance-store";
import type { JobContext, JobRunner } from "./scheduler/job-runner";
import { QuotaService } from "./scheduler/quota-service";
import type { Scheduler } from "./scheduler/scheduler";
import { getAppSettings, updateAppSettings } from "./settings/app-settings";
import { calculateNextRunAt } from "../shared/schedule";
import type {
  ActivityRowView,
  AppSettingsInput,
  InstanceConfigInput,
  InstanceKind,
  InstanceTestResult,
  JobEventView,
  JobView,
  LibrarySummary,
  ManualGrabInput,
  MediaItemDetailsInput,
  QuotaSummary,
  RadarrActionResult,
  RadarrMovieActionInput,
  ScheduleDeleteInput,
  ScheduleInput,
  ScheduleView,
  SettingsViewModel,
  SonarrActionResult,
  SonarrSeriesActionInput,
} from "../shared/ipc-contracts";

export type IpcState = {
  instanceStore: InstanceStore;
  jobRunner: JobRunner;
  repositories: ReturnType<typeof createRepositories>;
  scheduler: Scheduler;
};

const ANALYSIS_CONCURRENCY = 4;
const RADARR_ANALYSIS_CONCURRENCY = 1;
const RADARR_ANALYSIS_YIELD_EVERY = 5;
const EPISODE_LOAD_CONCURRENCY = 8;
const SEARCH_CONCURRENCY = 12;
const GRAB_CONCURRENCY = 4;

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
      const sampleSize =
        typeof payload === "object" && payload !== null && "sampleSize" in payload && Number.isInteger(payload.sampleSize)
          ? Number(payload.sampleSize)
          : undefined;
      return enqueueSonarrAnalysis(state, name, seriesIds, sampleSize);
    }

    if (target === "radarr") {
      const movieIds =
        typeof payload === "object" && payload !== null && "movieIds" in payload && Array.isArray(payload.movieIds)
          ? payload.movieIds.filter((id): id is number => Number.isInteger(id) && id > 0)
          : undefined;
      const sampleSize =
        typeof payload === "object" && payload !== null && "sampleSize" in payload && Number.isInteger(payload.sampleSize)
          ? Number(payload.sampleSize)
          : undefined;
      return enqueueRadarrAnalysis(state, name, movieIds, sampleSize);
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
  ipcMain.handle("library:radarr", () => state.repositories.mediaItems.listRadarrRows().map(formatRadarrRowDates));
  ipcMain.handle("library:itemDetails", (_event, payload: unknown) => {
    const input = assertItemDetailsInput(payload);
    return state.repositories.mediaItems.itemDetails(input.kind, input.arrId);
  });
  ipcMain.handle("stats:summary", () => state.repositories.stats.summary());
  ipcMain.handle("activity:recent", (): ActivityRowView[] => state.repositories.activityLog.listRecent(50).map(formatActivityRow));
  ipcMain.handle("quota:summary", (): QuotaSummary => getQuotaSummary(state));
  ipcMain.handle("quota:manualGrab", (_event, payload: unknown) => {
    const input = assertManualGrabInput(payload);
    createQuotaService(state).recordManualGrab(input.count, input.note);
    return getQuotaSummary(state);
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
  ipcMain.handle("radarr:search", (_event, payload: unknown): RadarrActionResult => {
    const input = assertMovieActionInput(payload);
    const job = enqueueRadarrSearch(state, input);
    return {
      ok: true,
      jobId: job.id,
      message: `Queued search for ${input.movieIds.length} Radarr movies.`,
    };
  });
  ipcMain.handle("radarr:grab", (_event, payload: unknown): RadarrActionResult => {
    const input = assertMovieActionInput(payload);
    const job = enqueueRadarrGrab(state, input);
    return {
      ok: true,
      jobId: job.id,
      message: `Queued grab for ${input.movieIds.length} Radarr movies.`,
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
  ipcMain.handle("radarr:openMovie", async (_event, payload: unknown) => {
    const movieId =
      typeof payload === "object" && payload !== null && "movieId" in payload && Number.isInteger(payload.movieId)
        ? payload.movieId
        : undefined;
    if (!movieId) {
      throw new Error("movieId is required");
    }
    const config = state.instanceStore.getWithApiKey("radarr");
    await shell.openExternal(`${config.baseUrl.replace(/\/+$/, "")}/movie/${movieId}`);
    return { ok: true };
  });
  ipcMain.handle("settings:get", (): SettingsViewModel => ({
    appSettings: getAppSettings(state.repositories),
    instances: state.instanceStore.list(),
    onboardingCompleted: state.repositories.settings.get("onboarding.completed", false),
  }));
  ipcMain.handle("onboarding:complete", () => {
    state.repositories.settings.set("onboarding.completed", true);
    return { ok: true };
  });
  ipcMain.handle("settings:update", (_event, payload: unknown) => updateAppSettings(state.repositories, assertSettingsInput(payload)));
  ipcMain.handle("schedules:list", (): ScheduleView[] => state.repositories.schedules.list());
  ipcMain.handle("schedules:save", (_event, payload: unknown): ScheduleView => {
    const schedule = state.repositories.schedules.upsert({ ...assertScheduleInput(payload), now: new Date() });
    registerSchedule(state, schedule);
    return schedule;
  });
  ipcMain.handle("schedules:delete", (_event, payload: unknown) => {
    const input = assertScheduleDeleteInput(payload);
    state.repositories.schedules.delete(input.id);
    state.scheduler.remove(String(input.id));
    return { ok: true };
  });
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

function enqueueSonarrAnalysis(state: IpcState, name = "Analyze Sonarr", seriesIds?: number[], sampleSize?: number) {
  return state.jobRunner.enqueue({
    name,
    kind: "analysis",
    target: seriesIds && seriesIds.length > 0 ? "selected" : "sonarr",
    progressTotal: seriesIds?.length,
    run: async (context) => analyzeSonarrLibrary(state, context, seriesIds, sampleSize),
  });
}

function enqueueRadarrAnalysis(state: IpcState, name = "Analyze Radarr", movieIds?: number[], sampleSize?: number) {
  return state.jobRunner.enqueue({
    name,
    kind: "analysis",
    target: movieIds && movieIds.length > 0 ? "selected" : "radarr",
    progressTotal: movieIds?.length,
    run: async (context) => analyzeRadarrLibrary(state, context, movieIds, sampleSize),
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

function enqueueRadarrSearch(state: IpcState, input: RadarrMovieActionInput) {
  return state.jobRunner.enqueue({
    name: "Search non-FuN Radarr movies",
    kind: "search",
    target: "selected",
    progressTotal: input.movieIds.length,
    run: async (context) => searchRadarrCandidates(state, input, context),
  });
}

function enqueueRadarrGrab(state: IpcState, input: RadarrMovieActionInput) {
  return state.jobRunner.enqueue({
    name: "Grab Radarr FuN candidates",
    kind: "grab",
    target: "selected",
    progressTotal: input.movieIds.length,
    run: async (context) => grabRadarrCandidates(state, input, context),
  });
}

async function analyzeSonarrLibrary(state: IpcState, context: JobContext, seriesIds?: number[], sampleSize?: number): Promise<void> {
  const config = state.instanceStore.getWithApiKey("sonarr");
  const instanceId = upsertRuntimeInstance(state, "sonarr", config);
  const client = new SonarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const seriesList = await client.getSeries();
  const requestedSeriesIds = seriesIds && seriesIds.length > 0 ? new Set(seriesIds) : undefined;
  const matchingSeries = requestedSeriesIds ? seriesList.filter((series) => requestedSeriesIds.has(series.id)) : seriesList;
  const analyzedArrIds = new Set(state.repositories.mediaItems.listAnalyzedArrIds("series", instanceId));
  const seriesToAnalyze = (requestedSeriesIds ? matchingSeries : selectSonarrSeriesForAnalysis(matchingSeries, analyzedArrIds)).slice(
    0,
    sampleSize && sampleSize > 0 ? sampleSize : undefined,
  );
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
  state.repositories.stats.recordCoverageSnapshot(new Date());
}

async function analyzeRadarrLibrary(state: IpcState, context: JobContext, movieIds?: number[], sampleSize?: number): Promise<void> {
  const config = state.instanceStore.getWithApiKey("radarr");
  const instanceId = upsertRuntimeInstance(state, "radarr", config);
  const client = new RadarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const movies = await client.getMovies();
  const requestedMovieIds = movieIds && movieIds.length > 0 ? new Set(movieIds) : undefined;
  const matchingMovies = requestedMovieIds ? movies.filter((movie) => requestedMovieIds.has(movie.id)) : movies;
  const analyzedArrIds = new Set(state.repositories.mediaItems.listAnalyzedArrIds("movie", instanceId));
  const moviesToAnalyze = (requestedMovieIds ? matchingMovies : matchingMovies.filter((movie) => !analyzedArrIds.has(movie.id))).slice(
    0,
    sampleSize && sampleSize > 0 ? sampleSize : undefined,
  );
  const analyzedAt = new Date();

  context.setProgressTotal(moviesToAnalyze.length);
  context.addEvent("info", `Loaded ${moviesToAnalyze.length} Radarr movies`);

  await mapConcurrent(moviesToAnalyze, RADARR_ANALYSIS_CONCURRENCY, async (movie) => {
    try {
      context.throwIfCancelled();
      const result = analyzeRadarrMovies([movie], analyzedAt);
      const mediaItemId = state.repositories.mediaItems.upsertAnalysis(instanceId, result.items[0]);
      state.repositories.activityLog.insert({
        action: "analysis",
        quotaType: "none",
        status: "success",
        instanceId,
        mediaItemId,
        message: movie.title,
        createdAt: new Date(),
      });
      context.incrementProgress();
    } catch (error) {
      state.repositories.activityLog.insert({
        action: "analysis",
        quotaType: "none",
        status: "failed",
        instanceId,
        message: `${movie.title}: ${error instanceof Error ? error.message : String(error)}`,
        createdAt: new Date(),
      });
      context.incrementProgress({ failed: true });
    }
  }, { yieldEvery: RADARR_ANALYSIS_YIELD_EVERY });
  state.repositories.stats.recordCoverageSnapshot(new Date());
}

async function searchSonarrCandidates(state: IpcState, input: SonarrSeriesActionInput, context: JobContext): Promise<void> {
  const config = state.instanceStore.getWithApiKey("sonarr");
  const instanceId = upsertRuntimeInstance(state, "sonarr", config);
  const client = new SonarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const quota = createQuotaService(state);
  const settings = getAppSettings(state.repositories);
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
    context.throwIfCancelled();
    if (
      state.repositories.activityLog.hasRecentChildActivity({
        action: "search",
        childArrId: task.episodeId,
        instanceId,
        now: new Date(),
        windowHours: settings.cooldownHours.episodeSearch,
      })
    ) {
      state.repositories.activityLog.insert({
        action: "search",
        childArrId: task.episodeId,
        instanceId,
        mediaItemId: task.mediaItemId,
        message: "Skipped by episode search cooldown",
        quotaType: "none",
        status: "skipped",
        createdAt: new Date(),
      });
      context.incrementProgress();
      return;
    }
    const reservation = quota.reserve("search", {
      childArrId: task.episodeId,
      instanceId,
      mediaItemId: task.mediaItemId,
      message: `Search Sonarr episode ${task.episodeId}`,
    });
    if (!reservation.allowed) {
      context.blockByBudget("Search budget exhausted before Sonarr episode search");
    }
    try {
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
      quota.complete(reservation.activityId!, "success", candidate ? "FuN* candidate found" : "No FuN* candidate");
      context.incrementProgress();
    } catch (error) {
      quota.complete(reservation.activityId!, "failed", error instanceof Error ? error.message : String(error));
      context.incrementProgress({ failed: true });
    }
  });
  context.addEvent("info", `Stored ${candidatesFound} FuN* candidates`);
}

async function grabSonarrCandidates(state: IpcState, input: SonarrSeriesActionInput, context: JobContext): Promise<void> {
  const config = state.instanceStore.getWithApiKey("sonarr");
  const instanceId = upsertRuntimeInstance(state, "sonarr", config);
  const client = new SonarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const quota = createQuotaService(state);
  context.addEvent(
    "info",
    `Requested grab for ${input.seriesIds.length} Sonarr series: [${input.seriesIds.join(", ")}]`,
  );
  const candidates = state.repositories.releaseCandidates.listForSeriesIds(input.seriesIds);

  context.setProgressTotal(candidates.length);
  if (candidates.length === 0) {
    context.addEvent(
      "warning",
      "No stored Sonarr FuN* candidates matched the requested series — nothing to grab. Run a FuN* search first so candidates are stored.",
    );
    return;
  }
  context.addEvent("info", `Grabbing ${candidates.length} stored FuN* candidates with concurrency ${GRAB_CONCURRENCY}`);

  await mapConcurrent(candidates, GRAB_CONCURRENCY, async (candidate) => {
    context.throwIfCancelled();
    const release = candidate.release;
    const releaseLabel = release.title ?? `candidate #${candidate.id}`;
    context.addEvent(
      "info",
      `Grabbing "${releaseLabel}" (seriesArrId=${candidate.childArrId}, indexer=${release.indexer ?? "?"}, ` +
        `approved=${release.approved ?? "?"}, downloadAllowed=${release.downloadAllowed ?? "?"}, guid=${release.guid ?? "?"})`,
    );
    const reservation = quota.reserve("grab", {
      childArrId: candidate.childArrId,
      instanceId,
      mediaItemId: candidate.mediaItemId ?? undefined,
      message: releaseLabel,
    });
    if (!reservation.allowed) {
      context.addEvent("warning", `Grab budget exhausted before grabbing "${releaseLabel}"`);
      context.blockByBudget("Grab budget exhausted before Sonarr grab");
    }
    try {
      const fresh = await client.getReleasesForEpisode(candidate.childArrId);
      context.throwIfCancelled();
      const match = release.guid ? fresh.find((item) => item.guid === release.guid) : undefined;
      if (!match) {
        throw new Error(
          `Release no longer offered by the indexer (guid=${release.guid ?? "?"}). Sonarr only keeps a release grabbable for a short time after a search — re-run a FuN* search, then grab promptly.`,
        );
      }
      await client.grabRelease(match);
      context.throwIfCancelled();
      state.repositories.releaseCandidates.delete(candidate.id);
      quota.complete(reservation.activityId!, "success", releaseLabel);
      context.addEvent("info", `Grabbed "${releaseLabel}" (re-fetched release, POST /release) and removed it from the candidate store`);
      context.incrementProgress();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      quota.complete(reservation.activityId!, "failed", message);
      context.addEvent("error", `Failed to grab "${releaseLabel}": ${message}`);
      context.incrementProgress({ failed: true });
    }
  });
}

async function searchRadarrCandidates(state: IpcState, input: RadarrMovieActionInput, context: JobContext): Promise<void> {
  const config = state.instanceStore.getWithApiKey("radarr");
  const instanceId = upsertRuntimeInstance(state, "radarr", config);
  const client = new RadarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const quota = createQuotaService(state);
  const settings = getAppSettings(state.repositories);
  const movieSet = new Set(input.movieIds);
  const movies = (await client.getMovies()).filter((movie) => movieSet.has(movie.id));
  const movieTasks = getNonFunMovieIds(movies).map((movieId) => ({
    mediaItemId: state.repositories.mediaItems.findIdByArrId("movie", movieId, instanceId),
    movieId,
  }));
  let candidatesFound = 0;

  context.setProgressTotal(movieTasks.length);
  context.addEvent("info", `Searching ${movieTasks.length} non-FuN Radarr movies with concurrency ${SEARCH_CONCURRENCY}`);

  await mapConcurrent(movieTasks, SEARCH_CONCURRENCY, async (task) => {
    context.throwIfCancelled();
    if (
      state.repositories.activityLog.hasRecentChildActivity({
        action: "search",
        childArrId: task.movieId,
        instanceId,
        now: new Date(),
        windowHours: settings.cooldownHours.movieSearch,
      })
    ) {
      state.repositories.activityLog.insert({
        action: "search",
        childArrId: task.movieId,
        instanceId,
        mediaItemId: task.mediaItemId,
        message: "Skipped by movie search cooldown",
        quotaType: "none",
        status: "skipped",
        createdAt: new Date(),
      });
      context.incrementProgress();
      return;
    }
    const reservation = quota.reserve("search", {
      childArrId: task.movieId,
      instanceId,
      mediaItemId: task.mediaItemId,
      message: `Search Radarr movie ${task.movieId}`,
    });
    if (!reservation.allowed) {
      context.blockByBudget("Search budget exhausted before Radarr movie search");
    }
    try {
      const releases = await client.getReleasesForMovie(task.movieId);
      context.throwIfCancelled();
      const candidate = selectBestFunRelease(releases);
      if (candidate) {
        state.repositories.releaseCandidates.insert({
          instanceId,
          mediaItemId: task.mediaItemId,
          childArrId: task.movieId,
          release: candidate,
          foundAt: new Date(),
        });
        candidatesFound += 1;
      }
      quota.complete(reservation.activityId!, "success", candidate ? "FuN* movie candidate found" : "No FuN* movie candidate");
      context.incrementProgress();
    } catch (error) {
      quota.complete(reservation.activityId!, "failed", error instanceof Error ? error.message : String(error));
      context.incrementProgress({ failed: true });
    }
  });
  context.addEvent("info", `Stored ${candidatesFound} Radarr FuN* candidates`);
}

async function grabRadarrCandidates(state: IpcState, input: RadarrMovieActionInput, context: JobContext): Promise<void> {
  const config = state.instanceStore.getWithApiKey("radarr");
  const instanceId = upsertRuntimeInstance(state, "radarr", config);
  const client = new RadarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const quota = createQuotaService(state);
  context.addEvent(
    "info",
    `Requested grab for ${input.movieIds.length} Radarr movie(s): [${input.movieIds.join(", ")}]`,
  );
  const candidates = state.repositories.releaseCandidates.listForMovieIds(input.movieIds);

  context.setProgressTotal(candidates.length);
  if (candidates.length === 0) {
    context.addEvent(
      "warning",
      "No stored Radarr FuN* candidates matched the requested movies — nothing to grab. Run a FuN* search first so candidates are stored.",
    );
    return;
  }
  context.addEvent("info", `Grabbing ${candidates.length} stored Radarr FuN* candidates with concurrency ${GRAB_CONCURRENCY}`);

  await mapConcurrent(candidates, GRAB_CONCURRENCY, async (candidate) => {
    context.throwIfCancelled();
    const release = candidate.release;
    const releaseLabel = release.title ?? `candidate #${candidate.id}`;
    context.addEvent(
      "info",
      `Grabbing "${releaseLabel}" (movieArrId=${candidate.childArrId}, indexer=${release.indexer ?? "?"}, ` +
        `approved=${release.approved ?? "?"}, downloadAllowed=${release.downloadAllowed ?? "?"}, guid=${release.guid ?? "?"})`,
    );
    const reservation = quota.reserve("grab", {
      childArrId: candidate.childArrId,
      instanceId,
      mediaItemId: candidate.mediaItemId ?? undefined,
      message: releaseLabel,
    });
    if (!reservation.allowed) {
      context.addEvent("warning", `Grab budget exhausted before grabbing "${releaseLabel}"`);
      context.blockByBudget("Grab budget exhausted before Radarr grab");
    }
    try {
      const fresh = await client.getReleasesForMovie(candidate.childArrId);
      context.throwIfCancelled();
      const match = release.guid ? fresh.find((item) => item.guid === release.guid) : undefined;
      if (!match) {
        throw new Error(
          `Release no longer offered by the indexer (guid=${release.guid ?? "?"}). Radarr only keeps a release grabbable for a short time after a search — re-run a FuN* search, then grab promptly.`,
        );
      }
      await client.grabRelease(match);
      context.throwIfCancelled();
      state.repositories.releaseCandidates.delete(candidate.id);
      quota.complete(reservation.activityId!, "success", releaseLabel);
      context.addEvent("info", `Grabbed "${releaseLabel}" (re-fetched release, POST /release) and removed it from the candidate store`);
      context.incrementProgress();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      quota.complete(reservation.activityId!, "failed", message);
      context.addEvent("error", `Failed to grab "${releaseLabel}": ${message}`);
      context.incrementProgress({ failed: true });
    }
  });
}

function getQuotaSummary(state: IpcState): QuotaSummary {
  const settings = getAppSettings(state.repositories);
  const now = new Date();
  const searchUsed = state.repositories.activityLog.countSince("search", now, settings.quota.windowHours);
  const grabUsed = state.repositories.activityLog.countSince("grab", now, settings.quota.windowHours);
  return {
    search: {
      used: searchUsed,
      remaining: Math.max(0, settings.quota.searchLimit - searchUsed),
      limit: settings.quota.searchLimit,
    },
    grab: {
      used: grabUsed,
      remaining: Math.max(0, settings.quota.grabLimit - grabUsed),
      limit: settings.quota.grabLimit,
    },
  };
}

function createQuotaService(state: IpcState): QuotaService {
  const settings = getAppSettings(state.repositories);
  return new QuotaService(state.repositories, {
    searchLimit: settings.quota.searchLimit,
    grabLimit: settings.quota.grabLimit,
    windowHours: settings.quota.windowHours,
    now: () => new Date(),
  });
}

export function registerPersistedSchedules(state: IpcState): void {
  for (const schedule of state.repositories.schedules.list()) {
    registerSchedule(state, schedule);
  }
}

function registerSchedule(state: IpcState, schedule: ScheduleView): void {
  state.scheduler.upsert({
    id: String(schedule.id),
    name: schedule.name,
    enabled: schedule.enabled,
    rule: {
      intervalKind: schedule.intervalKind,
      intervalValue: schedule.intervalValue,
      timeOfDay: schedule.timeOfDay,
    },
    run: async () => {
      const startedAt = new Date();
      await runScheduledWorkflow(state, schedule);
      const nextRunAt = calculateNextRunAt(
        {
          intervalKind: schedule.intervalKind,
          intervalValue: schedule.intervalValue,
          timeOfDay: schedule.timeOfDay,
        },
        startedAt,
      );
      state.repositories.schedules.markRun(schedule.id, startedAt, nextRunAt);
    },
  });
}

async function runScheduledWorkflow(state: IpcState, schedule: ScheduleView): Promise<void> {
  const targets =
    schedule.targetScope === "all"
      ? (["sonarr", "radarr"] as const)
      : ([schedule.targetScope] as const);

  for (const target of targets) {
    if (schedule.actions.includes("analysis")) {
      const job = target === "sonarr" ? enqueueSonarrAnalysis(state, `Scheduled ${schedule.name}: Sonarr analysis`) : enqueueRadarrAnalysis(state, `Scheduled ${schedule.name}: Radarr analysis`);
      await state.jobRunner.waitFor(job.id);
    }

    if (schedule.actions.includes("search")) {
      if (target === "sonarr") {
        const seriesIds = state.repositories.mediaItems.listSonarrRows().filter((row) => row.nonFunFiles > 0).map((row) => row.arrId);
        if (seriesIds.length > 0) {
          const job = enqueueSonarrSearch(state, { seriesIds });
          await state.jobRunner.waitFor(job.id);
        }
      } else {
        const movieIds = state.repositories.mediaItems.listRadarrRows().filter((row) => row.nonFunFiles > 0).map((row) => row.arrId);
        if (movieIds.length > 0) {
          const job = enqueueRadarrSearch(state, { movieIds });
          await state.jobRunner.waitFor(job.id);
        }
      }
    }

    if (schedule.actions.includes("grab")) {
      if (target === "sonarr") {
        const seriesIds = state.repositories.mediaItems.listSonarrRows().filter((row) => row.pendingFunCandidates > 0).map((row) => row.arrId);
        if (seriesIds.length > 0) {
          const job = enqueueSonarrGrab(state, { seriesIds });
          await state.jobRunner.waitFor(job.id);
        }
      } else {
        const movieIds = state.repositories.mediaItems.listRadarrRows().filter((row) => row.pendingFunCandidates > 0).map((row) => row.arrId);
        if (movieIds.length > 0) {
          const job = enqueueRadarrGrab(state, { movieIds });
          await state.jobRunner.waitFor(job.id);
        }
      }
    }
  }
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

function assertItemDetailsInput(payload: unknown): MediaItemDetailsInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid item details payload");
  }
  const value = payload as Partial<MediaItemDetailsInput>;
  if (value.kind !== "series" && value.kind !== "movie") {
    throw new Error("Invalid media item kind");
  }
  if (!Number.isInteger(value.arrId) || (value.arrId as number) <= 0) {
    throw new Error("Invalid arrId");
  }
  return { kind: value.kind, arrId: value.arrId as number };
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

function assertMovieActionInput(payload: unknown): RadarrMovieActionInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid Radarr action payload");
  }
  const value = payload as Partial<RadarrMovieActionInput>;
  if (!Array.isArray(value.movieIds)) {
    throw new Error("movieIds must be an array");
  }
  return {
    movieIds: value.movieIds.filter((id): id is number => Number.isInteger(id) && id > 0),
  };
}

function assertSettingsInput(payload: unknown): AppSettingsInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid settings payload");
  }
  return payload as AppSettingsInput;
}

function assertManualGrabInput(payload: unknown): ManualGrabInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid manual grab payload");
  }
  const value = payload as Partial<ManualGrabInput>;
  const count = Number(value.count);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("Manual grab count must be a positive integer");
  }
  return {
    count,
    note: typeof value.note === "string" && value.note.trim() ? value.note.trim() : "Manual grab entry",
  };
}

function assertScheduleInput(payload: unknown): ScheduleInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid schedule payload");
  }
  const value = payload as Partial<ScheduleInput>;
  const actions = Array.isArray(value.actions)
    ? value.actions.filter((action): action is ScheduleInput["actions"][number] => action === "analysis" || action === "search" || action === "grab")
    : [];
  if (actions.length === 0) {
    throw new Error("Schedule needs at least one action");
  }
  if (value.targetScope !== "all" && value.targetScope !== "sonarr" && value.targetScope !== "radarr") {
    throw new Error("Invalid schedule target");
  }
  if (value.intervalKind !== "minutes" && value.intervalKind !== "hours" && value.intervalKind !== "days" && value.intervalKind !== "daily_time") {
    throw new Error("Invalid schedule interval");
  }
  return {
    id: Number.isInteger(value.id) && Number(value.id) > 0 ? Number(value.id) : undefined,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : "Scheduled job",
    enabled: value.enabled ?? true,
    actions,
    targetScope: value.targetScope,
    intervalKind: value.intervalKind,
    intervalValue: Number.isInteger(value.intervalValue) ? Number(value.intervalValue) : undefined,
    timeOfDay: typeof value.timeOfDay === "string" ? value.timeOfDay : undefined,
  };
}

function assertScheduleDeleteInput(payload: unknown): ScheduleDeleteInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid schedule delete payload");
  }
  const value = payload as Partial<ScheduleDeleteInput>;
  if (!Number.isInteger(value.id) || Number(value.id) <= 0) {
    throw new Error("Schedule id is required");
  }
  return { id: Number(value.id) };
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

function formatRadarrRowDates(row: ReturnType<IpcState["repositories"]["mediaItems"]["listRadarrRows"]>[number]) {
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
