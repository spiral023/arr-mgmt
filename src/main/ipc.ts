import { ipcMain, shell } from "electron";
import { filterOutExcluded } from "./media-overrides";
import { analyzeRadarrMovies, analyzeSonarrSeries } from "./arr/analysis-service";
import { RadarrClient } from "./arr/radarr-client";
import { selectSonarrSeriesForAnalysis } from "./arr/sonarr-analysis-plan";
import { SonarrClient } from "./arr/sonarr-client";
import { getNonFunEpisodeIds, getNonFunMovieIds, selectBestFunRelease } from "./arr/sonarr-operations";
import type { ArrRelease } from "./arr/arr-types";
import { createAutomationExecutor, type AutomationArrClients } from "./automation/automation-executor";
import { AutomationRunner } from "./automation/automation-runner";
import type { PerfSampleInsert } from "./db/schema";
import { mapConcurrent } from "./async/map-concurrent";
import { mapAdaptive, type AdaptivePoolResult } from "./async/adaptive-pool";
import { isFunReleaseGroup } from "../shared/fun";
import type { createRepositories } from "./db/repositories";
import type { InstanceStore } from "./instances/instance-store";
import type { JobContext, JobRunner } from "./scheduler/job-runner";
import { QuotaService } from "./scheduler/quota-service";
import type { Scheduler } from "./scheduler/scheduler";
import { getAppSettings, updateAppSettings } from "./settings/app-settings";
import { applyLoginStartupSetting, type LoginStartupAdapter } from "./settings/login-startup";
import { calculateNextRunAt } from "../shared/schedule";
import type {
  ActivityRowView,
  AppSettingsInput,
  ArrActionResult,
  AutomationGoalIdInput,
  AutomationGoalInput,
  AutomationGoalView,
  AutomationReorderInput,
  InstanceConfigInput,
  InstanceKind,
  InstanceTestResult,
  JobEventView,
  JobView,
  LibrarySummary,
  ManualGrabInput,
  MediaItemDetailsInput,
  MediaOverrideInput,
  QuotaSummary,
  RadarrActionResult,
  RadarrMovieActionInput,
  RunCombinedInput,
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
  loginStartup?: LoginStartupAdapter;
  repositories: ReturnType<typeof createRepositories>;
  scheduler: Scheduler;
  automationRunner?: AutomationRunner;
};

const ANALYSIS_CONCURRENCY = 4;
const RADARR_ANALYSIS_CONCURRENCY = 1;
const RADARR_ANALYSIS_YIELD_EVERY = 5;
const EPISODE_LOAD_CONCURRENCY = 8;
const SEARCH_CONCURRENCY = 12;
// Grabs are now indexer-bound on the grab POST itself (Sonarr fetching the .nzb), not on a
// per-episode search, so we push parallelism high to start. If the indexer throttles (429/503/
// timeouts) the pool downshifts to GRAB_SAFE_CONCURRENCY for the rest of the run — see mapAdaptive.
const GRAB_CONCURRENCY = 16;
const GRAB_SAFE_CONCURRENCY = 6;
// Season pre-fetch issues heavy interactive-search queries; keep these modest regardless of how
// high the grab POST concurrency goes.
const SEASON_PREFETCH_CONCURRENCY = 6;
const SEARCH_DEBUG_DETAIL_CAP = 30;

/** Describes why the FuN* releases of one search result were not grabbable, for debug logging. */
function describeRejectedFunReleases(releases: ArrRelease[]): string {
  return releases
    .map((release) => {
      const flags = [
        release.rejected === true ? "rejected" : null,
        release.downloadAllowed === false ? "downloadNotAllowed" : null,
      ].filter(Boolean);
      const rejections = (release.rejections ?? []).join("; ");
      const detail = [flags.join(","), rejections].filter((part) => part && part.length > 0).join(" — ");
      return `"${release.title ?? "?"}"${detail ? ` [${detail}]` : ""}`;
    })
    .join(" | ");
}

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
  ipcMain.handle("jobs:runCombined", (_event, payload: unknown): ArrActionResult => {
    const input = assertRunCombinedInput(payload);
    const job = enqueueCombinedJob(
      state,
      input.target,
      input.target === "selected" ? { seriesIds: input.seriesIds, movieIds: input.movieIds } : undefined,
    );
    return { ok: true, jobId: job.id, message: `Pipeline queued for ${input.target}` };
  });
  ipcMain.handle("jobs:resume", (_event, payload: unknown): ArrActionResult => {
    const jobId =
      typeof payload === "object" && payload !== null && "jobId" in payload && typeof payload.jobId === "string"
        ? payload.jobId
        : undefined;
    if (!jobId) throw new Error("jobId is required");
    const job = state.jobRunner.listJobs().find((j) => j.id === jobId);
    if (!job) return { ok: false, message: "Job not found" };
    if (job.kind !== "combined") return { ok: false, message: "Only combined jobs can be resumed" };
    if (job.status !== "blocked_by_budget") return { ok: false, message: "Job is not blocked by budget" };
    if (job.target === "selected") return { ok: false, message: "Re-select items and start pipeline again" };
    const resumeTarget = job.target as "sonarr" | "radarr" | "all";
    const newJob = enqueueCombinedJob(state, resumeTarget);
    return { ok: true, jobId: newJob.id, message: `Pipeline resumed for ${resumeTarget}` };
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
  ipcMain.handle("media:setOverride", (_event, payload: unknown): ArrActionResult => {
    const input = assertMediaOverrideInput(payload);
    const result = state.repositories.mediaItemOverrides.setExcluded({ ...input, now: new Date() });
    return { ok: result.ok, message: result.message };
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
  ipcMain.handle("settings:update", (_event, payload: unknown) => {
    const saved = updateAppSettings(state.repositories, assertSettingsInput(payload));
    if (state.loginStartup) {
      applyLoginStartupSetting(saved, state.loginStartup);
    }
    return saved;
  });
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
  ipcMain.handle("automation:listGoals", (): AutomationGoalView[] => state.repositories.automationGoals.list());
  ipcMain.handle("automation:getGoal", (_event, payload: unknown): AutomationGoalView | undefined => {
    const input = assertAutomationGoalIdInput(payload);
    return state.repositories.automationGoals.find(input.goalId);
  });
  ipcMain.handle("automation:saveGoal", (_event, payload: unknown): AutomationGoalView => {
    const goal = state.repositories.automationGoals.upsert({ ...assertAutomationGoalInput(payload), now: new Date() });
    registerAutomationGoalSchedule(state, goal);
    return goal;
  });
  ipcMain.handle("automation:deleteGoal", (_event, payload: unknown) => {
    const input = assertAutomationGoalIdInput(payload);
    state.repositories.automationGoals.delete(input.goalId);
    state.scheduler.remove(automationScheduleId(input.goalId));
    return { ok: true };
  });
  ipcMain.handle("automation:reorderGoals", (_event, payload: unknown): AutomationGoalView[] => {
    const input = assertAutomationReorderInput(payload);
    state.repositories.automationGoals.reorder(input.goalIds, new Date());
    return state.repositories.automationGoals.list();
  });
  ipcMain.handle("automation:pauseGoal", (_event, payload: unknown): AutomationGoalView | undefined => {
    const input = assertAutomationGoalIdInput(payload);
    state.repositories.automationGoals.setManualStatus(input.goalId, "paused_by_user", new Date());
    const goal = state.repositories.automationGoals.find(input.goalId);
    if (goal) registerAutomationGoalSchedule(state, goal);
    return goal;
  });
  ipcMain.handle("automation:resumeGoal", (_event, payload: unknown): AutomationGoalView | undefined => {
    const input = assertAutomationGoalIdInput(payload);
    state.repositories.automationGoals.setManualStatus(input.goalId, "active", new Date());
    const goal = state.repositories.automationGoals.find(input.goalId);
    if (goal) registerAutomationGoalSchedule(state, goal);
    return goal;
  });
  ipcMain.handle("automation:runGoal", (_event, payload: unknown) => {
    const input = assertAutomationGoalIdInput(payload);
    return getAutomationRunner(state).runGoal(input.goalId, "manual");
  });
  ipcMain.handle("automation:runEligible", () => getAutomationRunner(state).runEligible("resume"));
  ipcMain.handle("automation:listEvents", (_event, payload: unknown) => {
    const input = assertAutomationGoalIdInput(payload);
    return state.repositories.automationEvents.list(input.goalId);
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

export function createProductionAutomationRunner(state: Pick<IpcState, "instanceStore" | "jobRunner" | "repositories">): AutomationRunner {
  const clients: AutomationArrClients = {
    sonarr: {
      getStatus: () => {
        const config = state.instanceStore.getWithApiKey("sonarr");
        return new SonarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey }).getStatus();
      },
      getReleasesForEpisode: (episodeId) => {
        const config = state.instanceStore.getWithApiKey("sonarr");
        return new SonarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey }).getReleasesForEpisode(episodeId);
      },
      grabRelease: async (release) => {
        const config = state.instanceStore.getWithApiKey("sonarr");
        await new SonarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey }).grabRelease(release);
      },
    },
    radarr: {
      getStatus: () => {
        const config = state.instanceStore.getWithApiKey("radarr");
        return new RadarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey }).getStatus();
      },
      getReleasesForMovie: (movieId) => {
        const config = state.instanceStore.getWithApiKey("radarr");
        return new RadarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey }).getReleasesForMovie(movieId);
      },
      grabRelease: async (release) => {
        const config = state.instanceStore.getWithApiKey("radarr");
        await new RadarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey }).grabRelease(release);
      },
    },
  };

  return new AutomationRunner({
    repositories: state.repositories,
    jobRunner: state.jobRunner,
    getSettings: () => getAppSettings(state.repositories),
    now: () => new Date(),
    executor: createAutomationExecutor({
      repositories: state.repositories,
      getSettings: () => getAppSettings(state.repositories),
      now: () => new Date(),
      clients,
    }),
  });
}

function getAutomationRunner(state: IpcState): AutomationRunner {
  state.automationRunner ??= createProductionAutomationRunner(state);
  return state.automationRunner;
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

async function runCombinedWorkflow(
  state: IpcState,
  context: JobContext,
  targets: ReadonlyArray<"sonarr" | "radarr">,
  ids?: { seriesIds?: number[]; movieIds?: number[] },
): Promise<void> {
  const isSelected = Boolean(ids);

  // Phase 1: Analysis
  for (const t of targets) {
    context.addEvent("info", `Phase 1/3 — Analyse (${t})`);
    if (t === "sonarr") {
      await analyzeSonarrLibrary(state, context, ids?.seriesIds);
    } else {
      await analyzeRadarrLibrary(state, context, ids?.movieIds);
    }
    context.throwIfCancelled();
  }

  // Phase 2: Search
  for (const t of targets) {
    if (t === "sonarr") {
      const seriesIds = isSelected
        ? (ids?.seriesIds ?? [])
        : state.repositories.mediaItems.listSonarrRows().filter((r) => r.nonFunFiles > 0).map((r) => r.arrId);
      if (seriesIds.length > 0) {
        context.addEvent("info", `Phase 2/3 — Search (sonarr, ${seriesIds.length} series)`);
        await searchSonarrCandidates(state, { seriesIds }, context);
      } else {
        context.addEvent("info", "Phase 2/3 — Search (sonarr): no series with non-FuN files, skipping");
      }
    } else {
      const movieIds = isSelected
        ? (ids?.movieIds ?? [])
        : state.repositories.mediaItems.listRadarrRows().filter((r) => r.nonFunFiles > 0).map((r) => r.arrId);
      if (movieIds.length > 0) {
        context.addEvent("info", `Phase 2/3 — Search (radarr, ${movieIds.length} movies)`);
        await searchRadarrCandidates(state, { movieIds }, context);
      } else {
        context.addEvent("info", "Phase 2/3 — Search (radarr): no movies with non-FuN files, skipping");
      }
    }
    context.throwIfCancelled();
  }

  // Phase 3: Grab
  for (const t of targets) {
    if (t === "sonarr") {
      const seriesIds = isSelected
        ? (ids?.seriesIds ?? [])
        : state.repositories.mediaItems.listSonarrRows().filter((r) => r.pendingFunCandidates > 0).map((r) => r.arrId);
      if (seriesIds.length > 0) {
        context.addEvent("info", `Phase 3/3 — Grab (sonarr, ${seriesIds.length} series)`);
        await grabSonarrCandidates(state, { seriesIds }, context);
      } else {
        context.addEvent("info", "Phase 3/3 — Grab (sonarr): no series with pending candidates, skipping");
      }
    } else {
      const movieIds = isSelected
        ? (ids?.movieIds ?? [])
        : state.repositories.mediaItems.listRadarrRows().filter((r) => r.pendingFunCandidates > 0).map((r) => r.arrId);
      if (movieIds.length > 0) {
        context.addEvent("info", `Phase 3/3 — Grab (radarr, ${movieIds.length} movies)`);
        await grabRadarrCandidates(state, { movieIds }, context);
      } else {
        context.addEvent("info", "Phase 3/3 — Grab (radarr): no movies with pending candidates, skipping");
      }
    }
    context.throwIfCancelled();
  }
}

function enqueueCombinedJob(
  state: IpcState,
  jobTarget: "sonarr" | "radarr" | "all" | "selected",
  ids?: { seriesIds?: number[]; movieIds?: number[] },
) {
  const targets: ReadonlyArray<"sonarr" | "radarr"> =
    jobTarget === "all"
      ? ["sonarr", "radarr"]
      : jobTarget === "selected"
      ? [
          ...(ids?.seriesIds && ids.seriesIds.length > 0 ? (["sonarr"] as const) : []),
          ...(ids?.movieIds && ids.movieIds.length > 0 ? (["radarr"] as const) : []),
        ]
      : [jobTarget];

  return state.jobRunner.enqueue({
    name: jobTarget === "selected" ? "Run pipeline (selected)" : `Run pipeline (${jobTarget})`,
    kind: "combined",
    target: jobTarget,
    run: (context) => runCombinedWorkflow(state, context, targets, ids),
  });
}

async function analyzeSonarrLibrary(state: IpcState, context: JobContext, seriesIds?: number[], sampleSize?: number): Promise<void> {
  const config = state.instanceStore.getWithApiKey("sonarr");
  const instanceId = upsertRuntimeInstance(state, "sonarr", config);
  const client = new SonarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const [seriesList, qualityProfiles] = await Promise.all([client.getSeries(), client.getQualityProfiles().catch(() => [])]);
  const qualityProfileMap = new Map(qualityProfiles.map((p) => [p.id, p.name]));
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
      const item = analyzeSonarrSeries(series, episodes, analyzedAt, series.qualityProfileId != null ? qualityProfileMap.get(series.qualityProfileId) : undefined);
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
  const [movies, radarrQualityProfiles] = await Promise.all([client.getMovies(), client.getQualityProfiles().catch(() => [])]);
  const radarrQualityProfileMap = new Map(radarrQualityProfiles.map((p) => [p.id, p.name]));
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
      const result = analyzeRadarrMovies([movie], analyzedAt, movie.qualityProfileId != null ? radarrQualityProfileMap.get(movie.qualityProfileId) : undefined);
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
  const excludedIds = new Set(state.repositories.mediaItemOverrides.excludedItemIds());
  const allowedEpisodeTasks = filterOutExcluded(episodeTasks, excludedIds, (task) => task.mediaItemId);
  if (allowedEpisodeTasks.length < episodeTasks.length) {
    context.addEvent("info", `Skipping ${episodeTasks.length - allowedEpisodeTasks.length} episode(s) from excluded series`);
  }
  let candidatesFound = 0;
  let searched = 0;
  let skippedByCooldown = 0;
  let withReleases = 0;
  let withFunGroup = 0;
  let onlyRejectedFun = 0;
  let errors = 0;
  let detailLogged = 0;

  context.setProgressTotal(allowedEpisodeTasks.length);
  context.addEvent("info", `Searching ${allowedEpisodeTasks.length} non-FuN episodes with concurrency ${SEARCH_CONCURRENCY}`);

  await mapConcurrent(allowedEpisodeTasks, SEARCH_CONCURRENCY, async (task) => {
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
      skippedByCooldown += 1;
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
      searched += 1;
      if (releases.length > 0) {
        withReleases += 1;
      }
      const funReleases = releases.filter((release) => isFunReleaseGroup(release.releaseGroup));
      if (funReleases.length > 0) {
        withFunGroup += 1;
      }
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
      } else if (funReleases.length > 0) {
        onlyRejectedFun += 1;
        if (detailLogged < SEARCH_DEBUG_DETAIL_CAP) {
          detailLogged += 1;
          context.addEvent(
            "warning",
            `Episode ${task.episodeId}: ${funReleases.length} FuN* release(s) found but none grabbable — ${describeRejectedFunReleases(funReleases)}`,
          );
        }
      }
      quota.complete(reservation.activityId!, "success", candidate ? "FuN* candidate found" : "No FuN* candidate");
      context.incrementProgress();
    } catch (error) {
      errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      quota.complete(reservation.activityId!, "failed", message);
      if (detailLogged < SEARCH_DEBUG_DETAIL_CAP) {
        detailLogged += 1;
        context.addEvent("error", `Episode ${task.episodeId} search failed: ${message}`);
      }
      context.incrementProgress({ failed: true });
    }
  });
  if (detailLogged >= SEARCH_DEBUG_DETAIL_CAP) {
    context.addEvent("info", `Per-episode detail logs capped at ${SEARCH_DEBUG_DETAIL_CAP} entries.`);
  }
  context.addEvent(
    "info",
    `Search summary — searched ${searched}, skipped by cooldown ${skippedByCooldown}, errors ${errors}; ` +
      `${withReleases} returned releases, ${withFunGroup} had a FuN* release, ${onlyRejectedFun} had only non-grabbable FuN* releases; stored ${candidatesFound} candidates.`,
  );
}

type GrabTarget = { release: ArrRelease; strategy: "guid" | "title" | "best-fun" };

/**
 * Resolves which freshly-fetched release to grab for a stored candidate. Sonarr/Radarr only let you
 * grab a release that is still in their short-lived server-side release cache, so we re-query the
 * indexer at grab time and re-match the stored candidate against the current results. We prefer the
 * exact same release (guid, then title), but fall back to the best currently-offered FuN* release so
 * a day-old candidate can still be grabbed as long as a suitable release is on the indexer.
 */
function resolveGrabTarget(fresh: ArrRelease[], stored: ArrRelease): GrabTarget | undefined {
  if (stored.guid) {
    const byGuid = fresh.find((item) => item.guid === stored.guid);
    if (byGuid) {
      return { release: byGuid, strategy: "guid" };
    }
  }
  if (stored.title) {
    const byTitle = fresh.find((item) => item.title === stored.title);
    if (byTitle) {
      return { release: byTitle, strategy: "title" };
    }
  }
  const best = selectBestFunRelease(fresh);
  return best ? { release: best, strategy: "best-fun" } : undefined;
}

/** Monotonic high-resolution clock for sub-task timing, in milliseconds. */
function nowMs(): number {
  return performance.now();
}

/**
 * Heuristic: does this error look like the indexer/download-client overloading us (as opposed to a
 * plain not-found or rejection)? Used to decide whether to downshift grab concurrency.
 */
function isThrottleError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("429") ||
    message.includes("too many") ||
    message.includes("returned 503") ||
    message.includes("returned 504") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout")
  );
}

type StoredCandidate = {
  id: number;
  mediaItemId: number | null;
  childArrId: number;
  release: ArrRelease;
};

type RecordPerf = (sample: Omit<PerfSampleInsert, "jobId" | "app" | "phase" | "createdAt">) => void;

type GrabLoopParams = {
  state: IpcState;
  context: JobContext;
  quota: QuotaService;
  instanceId: number;
  app: InstanceKind;
  /** Singular noun for the grabbed child, used in messages ("episode" / "movie"). */
  childNoun: string;
  /** Field label for the parent arr id, used in messages ("seriesArrId" / "movieArrId"). */
  childIdLabel: string;
  candidates: StoredCandidate[];
  /** Per-item indexer re-query — used by Radarr (one per movie) and as the Sonarr fallback. */
  refetch: (childArrId: number) => Promise<ArrRelease[]>;
  /** Issue the grab POST to the *arr instance. */
  grab: (release: ArrRelease) => Promise<unknown>;
  /**
   * Optional batch pre-fetch. Returns fresh indexer results keyed by childArrId so that many
   * candidates can re-match against a few shared queries (e.g. one per season) instead of one
   * query each. Candidates absent from the returned map fall back to {@link refetch}.
   */
  prefetch?: (candidates: StoredCandidate[], recordPerf: RecordPerf) => Promise<Map<number, ArrRelease[]>>;
};

/**
 * Shared grab loop for Sonarr and Radarr. Sonarr/Radarr only let you grab a release that is still
 * in their short-lived server-side release cache, so for each stored candidate we re-query the
 * indexer and re-match. The per-candidate indexer query is by far the slowest sub-task, so the
 * optional {@link GrabLoopParams.prefetch} batches those queries (Sonarr: one per season) and the
 * loop re-matches each candidate against the shared result, only re-querying per item when the
 * batch missed. Every sub-task is timed into `perf_samples` for later performance analysis.
 */
async function grabStoredCandidates(params: GrabLoopParams): Promise<void> {
  const { state, context, quota, instanceId, app, childNoun, childIdLabel, candidates, refetch, grab, prefetch } = params;
  const jobId = context.jobId;

  const recordPerf: RecordPerf = (sample): void => {
    try {
      state.repositories.perfSamples.insert({ ...sample, jobId, app, phase: "grab", createdAt: new Date() });
    } catch {
      // Performance logging must never break a grab.
    }
  };

  // Batch-prefetch fresh releases (e.g. one indexer query per season) so most candidates avoid a
  // per-item round-trip. Any failure here is non-fatal: those candidates fall back to refetch().
  let prefetched = new Map<number, ArrRelease[]>();
  if (prefetch && candidates.length > 0) {
    try {
      prefetched = await prefetch(candidates, recordPerf);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.addEvent("warning", `Batch pre-fetch failed (${message}); falling back to per-${childNoun} queries`);
    }
  }

  let poolResult: AdaptivePoolResult | undefined;
  try {
    poolResult = await mapAdaptive(
      candidates,
      {
        initialLimit: GRAB_CONCURRENCY,
        safeLimit: GRAB_SAFE_CONCURRENCY,
        onDownshift: (newLimit, reason) => {
          const why = reason instanceof Error ? reason.message : String(reason);
          context.addEvent(
            "warning",
            `Throttling detected (${why}); reducing grab concurrency ${GRAB_CONCURRENCY} → ${newLimit} for the rest of this run`,
          );
        },
      },
      async (candidate, _index, controls) => {
        context.throwIfCancelled();
        const release = candidate.release;
        const releaseLabel = release.title ?? `candidate #${candidate.id}`;
        context.addEvent(
          "info",
          `Grabbing "${releaseLabel}" (${childIdLabel}=${candidate.childArrId}, indexer=${release.indexer ?? "?"}, ` +
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
          context.blockByBudget(`Grab budget exhausted before ${app} grab`);
        }

        const startedMs = nowMs();
        try {
          // Prefer the batch-prefetched result set; only re-query per item if it is missing or
          // does not contain a grabbable match for this candidate.
          let target = resolveGrabTarget(prefetched.get(candidate.childArrId) ?? [], release);
          let matchedVia: "season batch" | "re-fetched" = "season batch";
          if (!target) {
            matchedVia = "re-fetched";
            const refetchStart = nowMs();
            const fresh = await refetch(candidate.childArrId);
            recordPerf({ operation: "refetch", childArrId: candidate.childArrId, outcome: "success", durationMs: nowMs() - refetchStart, detail: `${fresh.length} results` });
            context.throwIfCancelled();
            target = resolveGrabTarget(fresh, release);
            if (!target) {
              throw new Error(
                `No grabbable FuN* release among ${fresh.length} current results for ${childNoun} ${candidate.childArrId} ` +
                  `(looked for guid=${release.guid ?? "?"}, title="${releaseLabel}"). Re-run a FuN* search.`,
              );
            }
          }
          const grabbedLabel = target.release.title ?? releaseLabel;
          if (target.strategy !== "guid") {
            context.addEvent(
              "warning",
              `Stored release not matched by guid; grabbing via ${target.strategy} match: "${grabbedLabel}" (indexer=${target.release.indexer ?? "?"})`,
            );
          }
          const grabStart = nowMs();
          await grab(target.release);
          recordPerf({ operation: "grab_post", childArrId: candidate.childArrId, strategy: target.strategy, outcome: "success", durationMs: nowMs() - grabStart });
          state.repositories.releaseCandidates.delete(candidate.id);
          quota.complete(reservation.activityId!, "success", grabbedLabel);
          recordPerf({ operation: "grab_total", childArrId: candidate.childArrId, strategy: target.strategy, outcome: "success", durationMs: nowMs() - startedMs, detail: matchedVia });
          context.addEvent("info", `Grabbed "${grabbedLabel}" (${matchedVia}, ${target.strategy} match) and removed it from the candidate store`);
          context.incrementProgress();
        } catch (error) {
          // An overloaded indexer/download-client shows up here; tell the pool to back off.
          if (isThrottleError(error)) {
            controls.reportThrottle(error);
          }
          const message = error instanceof Error ? error.message : String(error);
          quota.complete(reservation.activityId!, "failed", message);
          recordPerf({ operation: "grab_total", childArrId: candidate.childArrId, outcome: "failed", durationMs: nowMs() - startedMs, detail: message });
          context.addEvent("error", `Failed to grab "${releaseLabel}": ${message}`);
          context.incrementProgress({ failed: true });
        }
      },
    );
  } finally {
    // Always emit the performance summary — including when the run is cut short by the grab budget
    // or cancellation — so the timing breakdown and observed parallelism are available for analysis.
    const summary = state.repositories.perfSamples.summarizeForJob(jobId);
    const parts = summary.map((row) => `${row.operation}/${row.outcome}: n=${row.count}, avg=${row.avgMs}ms, max=${row.maxMs}ms`);
    if (poolResult) {
      const limitNote = poolResult.downshifted
        ? `${GRAB_CONCURRENCY}→${poolResult.finalLimit} (throttled)`
        : `${GRAB_CONCURRENCY}`;
      parts.push(`peak parallelism ${poolResult.peakActive} of limit ${limitNote}`);
    }
    if (parts.length > 0) {
      context.addEvent("info", `Grab performance — ${parts.join(" | ")}`);
    }
  }
}

/** Maps each episode id (childArrId) to its series + season, read from Sonarr's local episode list. */
type EpisodeSeasonMap = Map<number, { seriesId: number; seasonNumber: number }>;

/**
 * Loads episode→season metadata for the requested series via Sonarr's `/episode` endpoint. This is a
 * cheap local lookup (no indexer involved) and is the reliable source of each candidate's season —
 * the interactive-search release JSON does not carry a usable seriesId/seasonNumber.
 */
async function loadEpisodeSeasonMap(
  client: SonarrClient,
  context: JobContext,
  seriesArrIds: number[],
): Promise<EpisodeSeasonMap> {
  const map: EpisodeSeasonMap = new Map();
  await mapConcurrent(seriesArrIds, EPISODE_LOAD_CONCURRENCY, async (seriesId) => {
    try {
      const episodes = await client.getEpisodes(seriesId, false);
      for (const episode of episodes) {
        if (typeof episode.seasonNumber === "number") {
          map.set(episode.id, { seriesId, seasonNumber: episode.seasonNumber });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.addEvent("warning", `Could not load episodes for series ${seriesId} (${message}); season batching disabled for it`);
    }
  });
  return map;
}

/**
 * Sonarr batch pre-fetch: one season-level indexer query per (series, season) pair, shared across
 * all episode candidates of that season. Collapses N per-episode queries into roughly one per
 * season — the single biggest grab speed-up, since a season of episodes otherwise queues N slow
 * indexer searches. Candidates whose season cannot be resolved are left for per-episode refetch.
 */
async function prefetchSonarrSeasons(
  client: SonarrClient,
  context: JobContext,
  candidates: StoredCandidate[],
  recordPerf: RecordPerf,
  episodeSeasons: EpisodeSeasonMap,
): Promise<Map<number, ArrRelease[]>> {
  type SeasonGroup = { seriesId: number; seasonNumber: number; episodeIds: number[] };
  const groups = new Map<string, SeasonGroup>();
  for (const candidate of candidates) {
    const meta = episodeSeasons.get(candidate.childArrId);
    if (!meta) {
      continue;
    }
    const key = `${meta.seriesId}:${meta.seasonNumber}`;
    const group = groups.get(key) ?? { seriesId: meta.seriesId, seasonNumber: meta.seasonNumber, episodeIds: [] };
    group.episodeIds.push(candidate.childArrId);
    groups.set(key, group);
  }

  const byEpisode = new Map<number, ArrRelease[]>();
  if (groups.size === 0) {
    return byEpisode;
  }
  context.addEvent("info", `Pre-fetching ${groups.size} season(s) for ${candidates.length} candidate(s)`);

  await mapConcurrent([...groups.values()], SEASON_PREFETCH_CONCURRENCY, async (group) => {
    context.throwIfCancelled();
    const start = nowMs();
    try {
      const results = await client.getReleasesForSeason(group.seriesId, group.seasonNumber);
      recordPerf({
        operation: "season_refetch",
        outcome: "success",
        durationMs: nowMs() - start,
        detail: `series ${group.seriesId} S${group.seasonNumber}: ${results.length} results for ${group.episodeIds.length} candidate(s)`,
      });
      for (const episodeId of group.episodeIds) {
        byEpisode.set(episodeId, results);
      }
      context.addEvent(
        "info",
        `Season pre-fetch: series ${group.seriesId} season ${group.seasonNumber} → ${results.length} releases covering ${group.episodeIds.length} candidate(s)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordPerf({ operation: "season_refetch", outcome: "failed", durationMs: nowMs() - start, detail: message });
      context.addEvent(
        "warning",
        `Season pre-fetch failed for series ${group.seriesId} season ${group.seasonNumber} (${message}); those candidates fall back to per-episode queries`,
      );
    }
  });

  return byEpisode;
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
  const excludedIds = new Set(state.repositories.mediaItemOverrides.excludedItemIds());
  const candidates = filterOutExcluded(
    state.repositories.releaseCandidates.listForSeriesIds(input.seriesIds),
    excludedIds,
    (candidate) => candidate.mediaItemId,
  );

  context.setProgressTotal(candidates.length);
  if (candidates.length === 0) {
    context.addEvent(
      "warning",
      "No stored Sonarr FuN* candidates matched the requested series — nothing to grab. Run a FuN* search first so candidates are stored.",
    );
    return;
  }
  context.addEvent("info", `Grabbing ${candidates.length} stored FuN* candidates with adaptive concurrency (start ${GRAB_CONCURRENCY}, safe ${GRAB_SAFE_CONCURRENCY})`);

  const episodeSeasons = await loadEpisodeSeasonMap(client, context, input.seriesIds);

  await grabStoredCandidates({
    state,
    context,
    quota,
    instanceId,
    app: "sonarr",
    childNoun: "episode",
    childIdLabel: "seriesArrId",
    candidates,
    prefetch: (items, recordPerf) => prefetchSonarrSeasons(client, context, items, recordPerf, episodeSeasons),
    refetch: (childArrId) => client.getReleasesForEpisode(childArrId),
    grab: (release) => client.grabRelease(release),
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
  const excludedIds = new Set(state.repositories.mediaItemOverrides.excludedItemIds());
  const allowedMovieTasks = filterOutExcluded(movieTasks, excludedIds, (task) => task.mediaItemId);
  if (allowedMovieTasks.length < movieTasks.length) {
    context.addEvent("info", `Skipping ${movieTasks.length - allowedMovieTasks.length} excluded movie(s)`);
  }
  let candidatesFound = 0;
  let searched = 0;
  let skippedByCooldown = 0;
  let withReleases = 0;
  let withFunGroup = 0;
  let onlyRejectedFun = 0;
  let errors = 0;
  let detailLogged = 0;

  context.setProgressTotal(allowedMovieTasks.length);
  context.addEvent("info", `Searching ${allowedMovieTasks.length} non-FuN Radarr movies with concurrency ${SEARCH_CONCURRENCY}`);

  await mapConcurrent(allowedMovieTasks, SEARCH_CONCURRENCY, async (task) => {
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
      skippedByCooldown += 1;
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
      searched += 1;
      if (releases.length > 0) {
        withReleases += 1;
      }
      const funReleases = releases.filter((release) => isFunReleaseGroup(release.releaseGroup));
      if (funReleases.length > 0) {
        withFunGroup += 1;
      }
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
      } else if (funReleases.length > 0) {
        onlyRejectedFun += 1;
        if (detailLogged < SEARCH_DEBUG_DETAIL_CAP) {
          detailLogged += 1;
          context.addEvent(
            "warning",
            `Movie ${task.movieId}: ${funReleases.length} FuN* release(s) found but none grabbable — ${describeRejectedFunReleases(funReleases)}`,
          );
        }
      }
      quota.complete(reservation.activityId!, "success", candidate ? "FuN* movie candidate found" : "No FuN* movie candidate");
      context.incrementProgress();
    } catch (error) {
      errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      quota.complete(reservation.activityId!, "failed", message);
      if (detailLogged < SEARCH_DEBUG_DETAIL_CAP) {
        detailLogged += 1;
        context.addEvent("error", `Movie ${task.movieId} search failed: ${message}`);
      }
      context.incrementProgress({ failed: true });
    }
  });
  if (detailLogged >= SEARCH_DEBUG_DETAIL_CAP) {
    context.addEvent("info", `Per-movie detail logs capped at ${SEARCH_DEBUG_DETAIL_CAP} entries.`);
  }
  context.addEvent(
    "info",
    `Search summary — searched ${searched}, skipped by cooldown ${skippedByCooldown}, errors ${errors}; ` +
      `${withReleases} returned releases, ${withFunGroup} had a FuN* release, ${onlyRejectedFun} had only non-grabbable FuN* releases; stored ${candidatesFound} candidates.`,
  );
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
  const excludedIds = new Set(state.repositories.mediaItemOverrides.excludedItemIds());
  const candidates = filterOutExcluded(
    state.repositories.releaseCandidates.listForMovieIds(input.movieIds),
    excludedIds,
    (candidate) => candidate.mediaItemId,
  );

  context.setProgressTotal(candidates.length);
  if (candidates.length === 0) {
    context.addEvent(
      "warning",
      "No stored Radarr FuN* candidates matched the requested movies — nothing to grab. Run a FuN* search first so candidates are stored.",
    );
    return;
  }
  context.addEvent("info", `Grabbing ${candidates.length} stored Radarr FuN* candidates with adaptive concurrency (start ${GRAB_CONCURRENCY}, safe ${GRAB_SAFE_CONCURRENCY})`);

  await grabStoredCandidates({
    state,
    context,
    quota,
    instanceId,
    app: "radarr",
    childNoun: "movie",
    childIdLabel: "movieArrId",
    candidates,
    refetch: (childArrId) => client.getReleasesForMovie(childArrId),
    grab: (release) => client.grabRelease(release),
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

export async function registerPersistedAutomationGoals(state: IpcState): Promise<void> {
  for (const goal of state.repositories.automationGoals.list()) {
    registerAutomationGoalSchedule(state, goal);
  }
  await getAutomationRunner(state).runEligible("startup");
}

function registerAutomationGoalSchedule(state: IpcState, goal: AutomationGoalView): void {
  const scheduleId = automationScheduleId(goal.id);
  if (!goal.enabled || goal.manualStatus !== "active" || !goal.schedule?.enabled) {
    state.scheduler.remove(scheduleId);
    return;
  }

  state.scheduler.upsert({
    id: scheduleId,
    name: `Automation: ${goal.name}`,
    enabled: true,
    rule: {
      intervalKind: goal.schedule.intervalKind,
      intervalValue: goal.schedule.intervalValue,
      timeOfDay: goal.schedule.timeOfDay,
    },
    run: async () => {
      await getAutomationRunner(state).runGoal(goal.id, "schedule");
    },
  });
}

function automationScheduleId(goalId: number): string {
  return `automation:${goalId}`;
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

export function assertMediaOverrideInput(payload: unknown): MediaOverrideInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid media override payload");
  }
  const value = payload as Partial<MediaOverrideInput>;
  if (value.kind !== "series" && value.kind !== "movie") {
    throw new Error("Invalid media override kind");
  }
  if (!Number.isInteger(value.arrId) || Number(value.arrId) <= 0) {
    throw new Error("Invalid media override arrId");
  }
  if (typeof value.excluded !== "boolean") {
    throw new Error("Invalid media override excluded flag");
  }
  if (value.note !== undefined && typeof value.note !== "string") {
    throw new Error("Invalid media override note");
  }
  return {
    kind: value.kind,
    arrId: Number(value.arrId),
    excluded: value.excluded,
    note: value.note,
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

function assertAutomationGoalIdInput(payload: unknown): AutomationGoalIdInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("goalId is required");
  }
  const value = payload as Partial<AutomationGoalIdInput>;
  if (!Number.isInteger(value.goalId) || Number(value.goalId) <= 0) {
    throw new Error("goalId is required");
  }
  return { goalId: Number(value.goalId) };
}

function assertAutomationReorderInput(payload: unknown): AutomationReorderInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("goalIds are required");
  }
  const value = payload as Partial<AutomationReorderInput>;
  if (!Array.isArray(value.goalIds) || value.goalIds.length === 0) {
    throw new Error("goalIds are required");
  }
  if (!value.goalIds.every((id) => Number.isInteger(id) && id > 0)) {
    throw new Error("goalIds are required");
  }
  return { goalIds: value.goalIds };
}

function assertAutomationGoalInput(payload: unknown): AutomationGoalInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid automation goal payload");
  }
  const value = payload as Partial<AutomationGoalInput>;
  if (value.id !== undefined && (!Number.isInteger(value.id) || Number(value.id) <= 0)) {
    throw new Error("Invalid automation goal id");
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new Error("Automation goal name is required");
  }
  if (value.scope !== "sonarr" && value.scope !== "radarr" && value.scope !== "both") {
    throw new Error("Invalid automation goal scope");
  }
  if (value.actionMode !== "search_only" && value.actionMode !== "search_and_grab") {
    throw new Error("Invalid automation action mode");
  }
  if (value.executionStrategy !== "grab_immediately" && value.executionStrategy !== "search_then_grab") {
    throw new Error("Invalid automation execution strategy");
  }
  if (
    value.ordering !== "oldest_search_first" &&
    value.ordering !== "lowest_fun_share_first" &&
    value.ordering !== "largest_impact_first" &&
    value.ordering !== "alphabetical"
  ) {
    throw new Error("Invalid automation ordering");
  }
  const targetFunShare = value.targetFunShare;
  const minSearchIntervalHours = value.minSearchIntervalHours;
  if (typeof targetFunShare !== "number" || !Number.isFinite(targetFunShare) || targetFunShare <= 0 || targetFunShare > 1) {
    throw new Error("Invalid automation target FuN share");
  }
  if (typeof minSearchIntervalHours !== "number" || !Number.isInteger(minSearchIntervalHours) || minSearchIntervalHours < 0) {
    throw new Error("Invalid automation search interval");
  }
  const filters = assertAutomationFilters(value.filters);

  return {
    id: value.id,
    name: value.name.trim(),
    enabled: value.enabled ?? true,
    scope: value.scope,
    targetFunShare,
    filters,
    actionMode: value.actionMode,
    executionStrategy: value.executionStrategy,
    ordering: value.ordering,
    minSearchIntervalHours,
    runOnStartup: value.runOnStartup ?? false,
    schedule: value.schedule ?? null,
  };
}

function assertAutomationFilters(value: unknown): AutomationGoalInput["filters"] {
  if (typeof value !== "object" || value === null) {
    throw new Error("Automation filters are required");
  }
  const filters = value as Partial<AutomationGoalInput["filters"]>;
  if (!isAutomationTriState(filters.monitored) || !isAutomationTriState(filters.hasFile)) {
    throw new Error("Automation filters are required");
  }
  if (!Array.isArray(filters.qualityProfiles) || !filters.qualityProfiles.every((profile) => typeof profile === "string")) {
    throw new Error("Automation filters are required");
  }
  return {
    monitored: filters.monitored,
    hasFile: filters.hasFile,
    qualityProfiles: filters.qualityProfiles,
    funShare: assertAutomationFunShareFilter(filters.funShare),
    analyzed: assertAutomationRecencyFilter(filters.analyzed),
    searched: assertAutomationRecencyFilter(filters.searched),
    grabbed: assertAutomationRecencyFilter(filters.grabbed),
  };
}

function assertAutomationFunShareFilter(value: unknown): AutomationGoalInput["filters"]["funShare"] {
  if (value == null) return null;
  if (typeof value !== "object") {
    throw new Error("Invalid automation FuN share filter");
  }
  const filter = value as Partial<NonNullable<AutomationGoalInput["filters"]["funShare"]>>;
  if (filter.operator !== "lt" && filter.operator !== "lte" && filter.operator !== "gt" && filter.operator !== "gte") {
    throw new Error("Invalid automation FuN share filter");
  }
  if (typeof filter.value !== "number" || !Number.isFinite(filter.value) || filter.value < 0 || filter.value > 1) {
    throw new Error("Invalid automation FuN share filter");
  }
  return { operator: filter.operator, value: filter.value };
}

function assertAutomationRecencyFilter(value: unknown): AutomationGoalInput["filters"]["analyzed"] {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid automation recency filter");
  }
  const filter = value as Partial<AutomationGoalInput["filters"]["analyzed"]>;
  if (filter.mode === "any" || filter.mode === "never") {
    return { mode: filter.mode };
  }
  if (filter.mode === "older_than" || filter.mode === "within_last") {
    if (typeof filter.days !== "number" || !Number.isInteger(filter.days) || filter.days <= 0) {
      throw new Error("Invalid automation recency filter");
    }
    return { mode: filter.mode, days: filter.days };
  }
  throw new Error("Invalid automation recency filter");
}

function isAutomationTriState(value: unknown): value is AutomationGoalInput["filters"]["monitored"] {
  return value === "yes" || value === "no" || value === "either";
}

function assertRunCombinedInput(payload: unknown): RunCombinedInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid runCombined payload");
  }
  const value = payload as Partial<RunCombinedInput>;
  if (value.target !== "sonarr" && value.target !== "radarr" && value.target !== "all" && value.target !== "selected") {
    throw new Error("Invalid target for runCombined — must be sonarr, radarr, all, or selected");
  }
  const result = {
    target: value.target,
    seriesIds: Array.isArray(value.seriesIds)
      ? value.seriesIds.filter((id): id is number => Number.isInteger(id) && id > 0)
      : undefined,
    movieIds: Array.isArray(value.movieIds)
      ? value.movieIds.filter((id): id is number => Number.isInteger(id) && id > 0)
      : undefined,
  };
  if (result.target === "selected" && !result.seriesIds?.length && !result.movieIds?.length) {
    throw new Error("target 'selected' requires at least one seriesId or movieId");
  }
  return result;
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
