import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArrRelease, MediaItemAnalysis } from "../../src/main/arr/arr-types";
import {
  AutomationQuotaSafetyError,
  createAutomationExecutor,
  type AutomationArrClients,
} from "../../src/main/automation/automation-executor";
import { defaultAppSettings } from "../../src/main/settings/app-settings";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";
import { JobRunner } from "../../src/main/scheduler/job-runner";
import type { AppSettings, AutomationGoalFilters, AutomationGoalView } from "../../src/shared/ipc-contracts";

const now = new Date("2026-06-18T12:00:00.000Z");

const defaultFilters = {
  monitored: "yes",
  hasFile: "yes",
  qualityProfiles: ["WEBDL-1080p"],
  funShare: { operator: "lt", value: 0.95 },
  analyzed: { mode: "any" },
  searched: { mode: "any" },
  grabbed: { mode: "any" },
} satisfies AutomationGoalFilters;

describe("createAutomationExecutor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("search_only reserves search, asks ARR for releases, stores the best FuN candidate, and marks candidate_found", async () => {
    const fixture = createFixture({ goal: { actionMode: "search_only" } });
    const clients = createClients({
      sonarrReleases: [release({ releaseGroup: "WvF" }), release({ guid: "fun-102", releaseGroup: "FuN" })],
    });
    const executor = createExecutor(fixture, clients);

    const result = await executor({
      goal: fixture.goal,
      run: fixture.run,
      workItems: [fixture.workItems.sonarr],
    });

    expect(result).toEqual({ completed: 1 });
    expect(clients.sonarr.getReleasesForEpisode).toHaveBeenCalledWith(102);
    expect(clients.sonarr.grabRelease).not.toHaveBeenCalled();
    expect(fixture.repos.activityLog.countSince("search", now, 24)).toBe(1);
    expect(fixture.repos.releaseCandidates.listForSeriesIds([7])).toEqual([
      expect.objectContaining({
        childArrId: 102,
        mediaItemId: fixture.mediaItemIds.sonarr,
        release: expect.objectContaining({ guid: "fun-102", releaseGroup: "FuN" }),
      }),
    ]);
    expect(fixture.repos.automationWorkItems.listForGoal(fixture.goal.id)[0]).toEqual(
      expect.objectContaining({
        childArrId: 102,
        lastSearchedAt: "2026-06-18T12:00:00.000Z",
        searchAttemptCount: 1,
        status: "candidate_found",
      }),
    );
  });

  it("never grabs or searches the next item when cancelled during a release search", async () => {
    const fixture = createFixture({ includeSecondSonarr: true });
    const clients = createClients();
    const runner = new JobRunner({ show: vi.fn() });
    let jobId = "";
    clients.sonarr.getReleasesForEpisode = vi.fn(async () => {
      runner.cancel(jobId);
      return [release()];
    });
    const executor = createExecutor(fixture, clients);
    const job = runner.enqueue({ name: "Cancel during search", kind: "automation", run: async (context) => {
      await executor({ goal: fixture.goal, run: fixture.run, workItems: fixture.repos.automationWorkItems.listForGoal(fixture.goal.id), context });
    } });
    jobId = job.id;
    await runner.waitFor(job.id);
    expect(job.status).toBe("cancelled");
    expect(clients.sonarr.getReleasesForEpisode).toHaveBeenCalledOnce();
    expect(clients.sonarr.grabRelease).not.toHaveBeenCalled();
    expect(fixture.repos.activityLog.countSince("grab", now, 24)).toBe(0);
  });

  it("checks the ARR connection before searching and stops without consuming quota when it fails", async () => {
    const fixture = createFixture({ goal: { actionMode: "search_only" } });
    const clients = createClients({
      sonarrReleases: [release({ guid: "fun-102", releaseGroup: "FuN" })],
    });
    clients.sonarr.getStatus = vi.fn(async () => {
      throw new Error("Sonarr unavailable");
    });
    const executor = createExecutor(fixture, clients);

    await expect(
      executor({
        goal: fixture.goal,
        run: fixture.run,
        workItems: [fixture.workItems.sonarr],
      }),
    ).rejects.toThrow("Sonarr unavailable");

    expect(clients.sonarr.getStatus).toHaveBeenCalledTimes(1);
    expect(clients.sonarr.getReleasesForEpisode).not.toHaveBeenCalled();
    expect(fixture.repos.activityLog.countSince("search", now, 24)).toBe(0);
  });

  it("grab_immediately searches and grabs a FuN release, records both quotas, marks grabbed, and skips re-search before analysis changes", async () => {
    const fixture = createFixture();
    const clients = createClients({
      sonarrReleases: [release({ guid: "fun-102", releaseGroup: "FuN" })],
    });
    const executor = createExecutor(fixture, clients);

    const first = await executor({
      goal: fixture.goal,
      run: fixture.run,
      workItems: [fixture.workItems.sonarr],
    });
    const grabbedItem = fixture.repos.automationWorkItems.listForGoal(fixture.goal.id)[0];
    const second = await executor({
      goal: fixture.goal,
      run: fixture.run,
      workItems: [grabbedItem],
    });

    expect(first).toEqual({ completed: 1 });
    expect(second).toEqual({ completed: 1 });
    expect(clients.sonarr.getReleasesForEpisode).toHaveBeenCalledTimes(1);
    expect(clients.sonarr.grabRelease).toHaveBeenCalledWith(expect.objectContaining({ guid: "fun-102" }));
    expect(fixture.repos.activityLog.countSince("search", now, 24)).toBe(1);
    expect(fixture.repos.activityLog.countSince("grab", now, 24)).toBe(1);
    expect(fixture.repos.releaseCandidates.listForSeriesIds([7])).toEqual([]);
    expect(grabbedItem).toEqual(
      expect.objectContaining({
        lastGrabbedAt: "2026-06-18T12:00:00.000Z",
        lastSearchedAt: "2026-06-18T12:00:00.000Z",
        status: "grabbed",
      }),
    );
  });

  it("skips recently searched items without consuming search quota and marks cooldown", async () => {
    const fixture = createFixture({ lastSearchedAt: "2026-06-18T11:30:00.000Z" });
    const clients = createClients({ sonarrReleases: [release({ releaseGroup: "FuN" })] });
    const executor = createExecutor(fixture, clients);

    const result = await executor({
      goal: { ...fixture.goal, minSearchIntervalHours: 2 },
      run: fixture.run,
      workItems: [fixture.workItems.sonarr],
    });

    expect(result).toEqual({ completed: 1 });
    expect(clients.sonarr.getReleasesForEpisode).not.toHaveBeenCalled();
    expect(fixture.repos.activityLog.countSince("search", now, 24)).toBe(0);
    expect(fixture.repos.automationWorkItems.listForGoal(fixture.goal.id)[0]).toEqual(
      expect.objectContaining({
        lastSearchedAt: "2026-06-18T11:30:00.000Z",
        searchAttemptCount: 0,
        status: "cooldown",
      }),
    );
  });

  it("search_then_grab stores candidates without immediately grabbing during the search phase", async () => {
    const fixture = createFixture({ goal: { executionStrategy: "search_then_grab" } });
    const clients = createClients({
      sonarrReleases: [release({ guid: "fun-102", releaseGroup: "FuN" })],
    });
    const executor = createExecutor(fixture, clients);

    const result = await executor({
      goal: fixture.goal,
      run: fixture.run,
      workItems: [fixture.workItems.sonarr],
    });

    expect(result).toEqual({ completed: 1 });
    expect(clients.sonarr.getReleasesForEpisode).toHaveBeenCalledWith(102);
    expect(clients.sonarr.grabRelease).not.toHaveBeenCalled();
    expect(fixture.repos.releaseCandidates.listForSeriesIds([7])).toHaveLength(1);
    expect(fixture.repos.activityLog.countSince("grab", now, 24)).toBe(0);
  });

  it("marks grab quota activity failed when the ARR grab call fails after a successful search", async () => {
    const fixture = createFixture();
    const clients = createClients({
      sonarrReleases: [release({ guid: "fun-102", releaseGroup: "FuN" })],
    });
    clients.sonarr.grabRelease = vi.fn(async () => {
      throw new Error("grab rejected");
    });
    const executor = createExecutor(fixture, clients);

    const result = await executor({
      goal: fixture.goal,
      run: fixture.run,
      workItems: [fixture.workItems.sonarr],
    });

    expect(result).toEqual({ completed: 1 });
    expect(fixture.repos.automationWorkItems.listForGoal(fixture.goal.id)[0]).toEqual(
      expect.objectContaining({ lastError: "grab rejected", status: "failed" }),
    );
    expect(fixture.repos.activityLog.listRecent(2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "grab", status: "failed" }),
      expect.objectContaining({ action: "search", status: "success" }),
    ]));
  });

  it("stops before ARR calls when hard search quota is denied", async () => {
    const settings: AppSettings = {
      ...defaultAppSettings,
      quota: { searchLimit: 1, grabLimit: 10, windowHours: 24 },
    };
    const fixture = createFixture({ settings });
    fixture.repos.activityLog.insert({
      action: "search",
      quotaType: "search",
      status: "success",
      createdAt: new Date("2026-06-18T11:00:00.000Z"),
    });
    const clients = createClients({ sonarrReleases: [release({ releaseGroup: "FuN" })] });
    const executor = createExecutor(fixture, clients);

    const promise = executor({
      goal: fixture.goal,
      run: fixture.run,
      workItems: [fixture.workItems.sonarr],
    });
    await expect(promise).rejects.toBeInstanceOf(AutomationQuotaSafetyError);
    await expect(promise).rejects.toEqual(expect.objectContaining({ action: "search", completed: 0 }));

    expect(clients.sonarr.getReleasesForEpisode).not.toHaveBeenCalled();
    expect(fixture.repos.activityLog.countSince("search", now, 24)).toBe(1);
  });

  it("stops before the next search when automation search safety is reached mid-run", async () => {
    const settings: AppSettings = {
      ...defaultAppSettings,
      automation: { quotaSafetyPercent: 90 },
      quota: { searchLimit: 10, grabLimit: 10, windowHours: 24 },
    };
    const fixture = createFixture({
      goal: { actionMode: "search_only" },
      includeSecondSonarr: true,
      settings,
    });
    for (let index = 0; index < 8; index += 1) {
      fixture.repos.activityLog.insert({
        action: "search",
        quotaType: "search",
        status: "success",
        createdAt: new Date(now.getTime() - index * 60_000),
      });
    }
    const clients = createClients({ sonarrReleases: [release({ guid: "fun-102", releaseGroup: "FuN" })] });
    const executor = createExecutor(fixture, clients);
    const workItems = fixture.repos.automationWorkItems.listForGoal(fixture.goal.id);

    const promise = executor({
      goal: fixture.goal,
      run: fixture.run,
      workItems,
    });

    await expect(promise).rejects.toEqual(expect.objectContaining({ action: "search", completed: 1 }));
    expect(clients.sonarr.getReleasesForEpisode).toHaveBeenCalledTimes(1);
    expect(clients.sonarr.getReleasesForEpisode).toHaveBeenCalledWith(102);
    expect(fixture.repos.activityLog.countSince("search", now, 24)).toBe(9);
  });

  it("stops before the next grab when automation grab safety is reached mid-run", async () => {
    const settings: AppSettings = {
      ...defaultAppSettings,
      automation: { quotaSafetyPercent: 90 },
      quota: { searchLimit: 20, grabLimit: 10, windowHours: 24 },
    };
    const fixture = createFixture({ includeSecondSonarr: true, settings });
    for (let index = 0; index < 8; index += 1) {
      fixture.repos.activityLog.insert({
        action: "grab",
        quotaType: "grab",
        status: "success",
        createdAt: new Date(now.getTime() - index * 60_000),
      });
    }
    const clients = createClients({ sonarrReleases: [release({ guid: "fun-102", releaseGroup: "FuN" })] });
    const executor = createExecutor(fixture, clients);
    const workItems = fixture.repos.automationWorkItems.listForGoal(fixture.goal.id);

    const promise = executor({
      goal: fixture.goal,
      run: fixture.run,
      workItems,
    });

    await expect(promise).rejects.toEqual(expect.objectContaining({ action: "grab", completed: 1 }));
    expect(clients.sonarr.getReleasesForEpisode).toHaveBeenCalledTimes(2);
    expect(clients.sonarr.grabRelease).toHaveBeenCalledTimes(1);
    expect(fixture.repos.activityLog.countSince("grab", now, 24)).toBe(9);
  });

  it("searches Radarr movies through the injected Radarr client", async () => {
    const fixture = createFixture({ includeRadarr: true });
    const clients = createClients({
      radarrReleases: [release({ guid: "fun-401", releaseGroup: "FuN" })],
    });
    const executor = createExecutor(fixture, clients);

    await executor({
      goal: fixture.radarrGoal,
      run: fixture.radarrRun,
      workItems: [fixture.workItems.radarr],
    });

    expect(clients.radarr.getReleasesForMovie).toHaveBeenCalledWith(401);
    expect(clients.radarr.grabRelease).toHaveBeenCalledWith(expect.objectContaining({ guid: "fun-401" }));
    expect(fixture.repos.releaseCandidates.listForMovieIds([401])).toEqual([]);
  });
});

function createExecutor(fixture: ReturnType<typeof createFixture>, clients: AutomationArrClients) {
  return createAutomationExecutor({
    repositories: fixture.repos,
    getSettings: () => fixture.settings,
    now: () => now,
    clients,
  });
}

function createClients(input: { sonarrReleases?: ArrRelease[]; radarrReleases?: ArrRelease[] } = {}): AutomationArrClients {
  return {
    sonarr: {
      getStatus: vi.fn(async () => ({ appName: "Sonarr" })),
      getReleasesForEpisode: vi.fn(async () => input.sonarrReleases ?? []),
      grabRelease: vi.fn(async () => undefined),
    },
    radarr: {
      getStatus: vi.fn(async () => ({ appName: "Radarr" })),
      getReleasesForMovie: vi.fn(async () => input.radarrReleases ?? []),
      grabRelease: vi.fn(async () => undefined),
    },
  };
}

function release(overrides: Partial<ArrRelease> = {}): ArrRelease {
  return {
    approved: true,
    downloadAllowed: true,
    guid: "release-guid",
    indexer: "Indexer",
    quality: { quality: { name: "WEBDL-1080p" } },
    releaseGroup: "FuN",
    size: 1_000,
    title: "Example.Release.FuN",
    ...overrides,
  };
}

function createFixture(
  options: {
    goal?: Partial<Pick<AutomationGoalView, "actionMode" | "executionStrategy" | "minSearchIntervalHours" | "scope">>;
    includeRadarr?: boolean;
    includeSecondSonarr?: boolean;
    lastSearchedAt?: string | null;
    settings?: AppSettings;
  } = {},
) {
  const db = createInMemoryDatabase();
  migrateDatabase(db);
  const repos = createRepositories(db);
  const settings = options.settings ?? defaultAppSettings;
  const sonarrInstanceId = repos.instances.upsert({
    kind: "sonarr",
    name: "Sonarr",
    baseUrl: "http://sonarr.local:8989",
    apiKeyEncrypted: "encrypted",
    enabled: true,
    now,
  });
  const sonarrMediaItemId = repos.mediaItems.upsertAnalysis(sonarrInstanceId, sonarrAnalysis());
  const goal = repos.automationGoals.upsert(goalInput(options.goal));
  const sonarrFile = repos.mediaFiles.listForAutomation({ scope: "sonarr" }).find((item) => item.childArrId === 102)!;
  const sonarrWorkItems = [
    {
      instanceId: sonarrInstanceId,
      mediaItemId: sonarrMediaItemId,
      mediaFileId: sonarrFile.mediaFileId,
      childArrId: 102,
      kind: "episode" as const,
      title: "Example Series S01E02",
      sortKey: "example series s01e02",
      isFun: false,
      lastAnalyzedAt: "2026-06-18T10:00:00.000Z",
      lastGrabbedAt: null,
      lastSearchedAt: options.lastSearchedAt ?? null,
      status: "pending" as const,
      now,
    },
  ];
  if (options.includeSecondSonarr) {
    sonarrWorkItems.push({
      instanceId: sonarrInstanceId,
      mediaItemId: sonarrMediaItemId,
      mediaFileId: sonarrFile.mediaFileId,
      childArrId: 103,
      kind: "episode" as const,
      title: "Example Series S01E03",
      sortKey: "example series s01e03",
      isFun: false,
      lastAnalyzedAt: "2026-06-18T10:00:00.000Z",
      lastGrabbedAt: null,
      lastSearchedAt: null,
      status: "pending" as const,
      now,
    });
  }
  repos.automationWorkItems.reconcile(goal.id, sonarrWorkItems);
  const run = repos.automationRuns.start({ goalId: goal.id, trigger: "manual", now });

  let radarrGoal = goal;
  let radarrRun = run;
  let radarrMediaItemId = 0;
  let radarrWorkItem = repos.automationWorkItems.listForGoal(goal.id)[0];
  if (options.includeRadarr) {
    const radarrInstanceId = repos.instances.upsert({
      kind: "radarr",
      name: "Radarr",
      baseUrl: "http://radarr.local:7878",
      apiKeyEncrypted: "encrypted",
      enabled: true,
      now,
    });
    radarrMediaItemId = repos.mediaItems.upsertAnalysis(radarrInstanceId, radarrAnalysis());
    radarrGoal = repos.automationGoals.upsert(goalInput({ ...options.goal, scope: "radarr" }));
    const radarrFile = repos.mediaFiles.listForAutomation({ scope: "radarr" })[0];
    repos.automationWorkItems.reconcile(radarrGoal.id, [
      {
        instanceId: radarrInstanceId,
        mediaItemId: radarrMediaItemId,
        mediaFileId: radarrFile.mediaFileId,
        childArrId: 401,
        kind: "movie",
        title: "Example Movie",
        sortKey: "example movie",
        isFun: false,
        lastAnalyzedAt: "2026-06-18T10:00:00.000Z",
        lastGrabbedAt: null,
        lastSearchedAt: null,
        status: "pending",
        now,
      },
    ]);
    radarrRun = repos.automationRuns.start({ goalId: radarrGoal.id, trigger: "manual", now });
    radarrWorkItem = repos.automationWorkItems.listForGoal(radarrGoal.id)[0];
  }

  return {
    db,
    goal,
    mediaItemIds: { radarr: radarrMediaItemId, sonarr: sonarrMediaItemId },
    radarrGoal,
    radarrRun,
    repos,
    run,
    settings,
    workItems: {
      radarr: radarrWorkItem,
      sonarr: repos.automationWorkItems.listForGoal(goal.id)[0],
    },
  };
}

function goalInput(overrides: Partial<Pick<AutomationGoalView, "actionMode" | "executionStrategy" | "minSearchIntervalHours" | "scope">> = {}) {
  return {
    name: "Goal",
    enabled: true,
    scope: "sonarr" as const,
    targetFunShare: 0.95,
    filters: defaultFilters,
    actionMode: "search_and_grab" as const,
    executionStrategy: "grab_immediately" as const,
    ordering: "oldest_search_first" as const,
    minSearchIntervalHours: 168,
    runOnStartup: true,
    schedule: null,
    now,
    ...overrides,
  };
}

function sonarrAnalysis(): MediaItemAnalysis {
  return {
    arrId: 7,
    childrenWithFile: 1,
    files: [
      {
        arrFileId: 1002,
        childArrId: 102,
        episodeNumber: 2,
        isFun: false,
        path: "/tv/example/s01e02.mkv",
        qualityName: "WEBDL-1080p",
        releaseGroup: "WvF",
        seasonNumber: 1,
        sizeBytes: 2_000,
      },
    ],
    funChildren: 0,
    funShare: 0,
    funSizeBytes: 0,
    hasFile: true,
    kind: "series",
    lastAnalyzedAt: "2026-06-18T10:00:00.000Z",
    monitored: true,
    nonFunChildren: 1,
    qualityProfileName: "WEBDL-1080p",
    title: "Example Series",
    titleSlug: "example-series",
    totalChildren: 1,
    totalSizeBytes: 2_000,
  };
}

function radarrAnalysis(): MediaItemAnalysis {
  return {
    ...sonarrAnalysis(),
    arrId: 401,
    files: [
      {
        arrFileId: 5001,
        childArrId: 401,
        isFun: false,
        path: "/movies/example-movie/example.mkv",
        qualityName: "WEBDL-1080p",
        releaseGroup: "WvF",
        sizeBytes: 4_000,
      },
    ],
    kind: "movie",
    title: "Example Movie",
    titleSlug: undefined,
    totalSizeBytes: 4_000,
    year: 2024,
  };
}
