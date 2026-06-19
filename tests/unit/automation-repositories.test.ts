import { describe, expect, it } from "vitest";
import type { MediaItemAnalysis } from "../../src/main/arr/arr-types";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";
import type { AutomationGoalFilters } from "../../src/shared/ipc-contracts";

const defaultFilters = {
  monitored: "yes",
  hasFile: "yes",
  qualityProfiles: ["WEBDL-1080p"],
  funShare: { operator: "lt", value: 0.95 },
  analyzed: { mode: "any" },
  searched: { mode: "older_than", days: 7 },
  grabbed: { mode: "any" },
} satisfies AutomationGoalFilters;

describe("automation repositories", () => {
  it("creates, updates, lists, pauses, resumes, and reorders goals", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    const goal = repos.automationGoals.upsert({
      name: "Sonarr to 95% FuN",
      enabled: true,
      scope: "sonarr",
      targetFunShare: 0.95,
      filters: defaultFilters,
      actionMode: "search_and_grab",
      executionStrategy: "grab_immediately",
      ordering: "oldest_search_first",
      minSearchIntervalHours: 168,
      runOnStartup: true,
      schedule: null,
      now: new Date("2026-06-18T10:00:00.000Z"),
    });

    expect(goal).toMatchObject({
      id: 1,
      name: "Sonarr to 95% FuN",
      priority: 1,
      manualStatus: "active",
      targetFunShare: 0.95,
    });

    repos.automationGoals.setManualStatus(goal.id, "paused_by_user", new Date("2026-06-18T10:01:00.000Z"));
    expect(repos.automationGoals.find(goal.id)?.manualStatus).toBe("paused_by_user");

    repos.automationGoals.setManualStatus(goal.id, "active", new Date("2026-06-18T10:02:00.000Z"));
    expect(repos.automationGoals.find(goal.id)?.manualStatus).toBe("active");

    const updated = repos.automationGoals.upsert({
      ...goal,
      name: "Sonarr to 90% FuN",
      targetFunShare: 0.9,
      now: new Date("2026-06-18T10:02:30.000Z"),
    });
    expect(updated).toMatchObject({ id: goal.id, name: "Sonarr to 90% FuN", targetFunShare: 0.9 });

    const second = repos.automationGoals.upsert({
      ...goal,
      id: undefined,
      name: "Radarr to 95% FuN",
      scope: "radarr",
      now: new Date("2026-06-18T10:03:00.000Z"),
    });
    repos.automationGoals.reorder([second.id, goal.id], new Date("2026-06-18T10:04:00.000Z"));

    expect(repos.automationGoals.list().map((item) => item.id)).toEqual([second.id, goal.id]);
  });

  it("throws a clear error when updating a missing automation goal", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    expect(() =>
      repos.automationGoals.upsert({
        id: 999,
        name: "Missing goal",
        enabled: true,
        scope: "sonarr",
        targetFunShare: 0.95,
        filters: defaultFilters,
        actionMode: "search_and_grab",
        executionStrategy: "grab_immediately",
        ordering: "oldest_search_first",
        minSearchIntervalHours: 168,
        runOnStartup: true,
        schedule: null,
        now: new Date("2026-06-18T10:00:00.000Z"),
      }),
    ).toThrow("Automation goal 999 not found");
  });

  it("upserts work items from media files and records runs/events", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const instanceId = repos.instances.upsert({
      kind: "sonarr",
      name: "Sonarr",
      baseUrl: "http://sonarr.local:8989",
      apiKeyEncrypted: "encrypted",
      enabled: true,
      now: new Date("2026-06-18T10:00:00.000Z"),
    });
    const mediaItemId = repos.mediaItems.upsertAnalysis(instanceId, analysis());
    const goal = repos.automationGoals.upsert({
      name: "Goal",
      enabled: true,
      scope: "sonarr",
      targetFunShare: 0.95,
      filters: defaultFilters,
      actionMode: "search_and_grab",
      executionStrategy: "grab_immediately",
      ordering: "oldest_search_first",
      minSearchIntervalHours: 168,
      runOnStartup: true,
      schedule: null,
      now: new Date("2026-06-18T10:00:00.000Z"),
    });

    repos.activityLog.insert({
      action: "search",
      quotaType: "search",
      status: "success",
      instanceId,
      mediaItemId,
      childArrId: 102,
      createdAt: new Date("2026-06-18T09:00:00.000Z"),
    });
    repos.activityLog.insert({
      action: "grab",
      quotaType: "grab",
      status: "success",
      instanceId,
      mediaItemId,
      childArrId: 102,
      createdAt: new Date("2026-06-18T09:30:00.000Z"),
    });
    repos.activityLog.insert({
      action: "grab",
      quotaType: "grab",
      status: "failed",
      instanceId,
      mediaItemId,
      childArrId: 102,
      createdAt: new Date("2026-06-18T09:45:00.000Z"),
    });

    const files = repos.mediaFiles.listForAutomation({ scope: "sonarr" });
    expect(files).toHaveLength(2);
    expect(files[1]).toMatchObject({
      childArrId: 102,
      lastGrabbedAt: "2026-06-18T09:30:00.000Z",
      lastSearchedAt: "2026-06-18T09:00:00.000Z",
    });

    repos.automationWorkItems.reconcile(goal.id, [
      {
        instanceId,
        mediaItemId,
        mediaFileId: files[1].mediaFileId,
        childArrId: 102,
        kind: "episode",
        title: "Example Series S01E02",
        sortKey: "example series s01e02",
        isFun: false,
        lastAnalyzedAt: "2026-06-18T10:00:00.000Z",
        lastSearchedAt: files[1].lastSearchedAt,
        lastGrabbedAt: files[1].lastGrabbedAt,
        status: "pending",
        now: new Date("2026-06-18T10:05:00.000Z"),
      },
    ]);

    expect(repos.automationWorkItems.listForGoal(goal.id)).toEqual([
      expect.objectContaining({
        childArrId: 102,
        lastGrabbedAt: "2026-06-18T09:30:00.000Z",
        lastSearchedAt: "2026-06-18T09:00:00.000Z",
        status: "pending",
        title: "Example Series S01E02",
      }),
    ]);

    const run = repos.automationRuns.start({
      goalId: goal.id,
      trigger: "manual",
      jobId: "job-1",
      now: new Date("2026-06-18T10:06:00.000Z"),
    });
    repos.automationEvents.insert({
      goalId: goal.id,
      runId: run.id,
      level: "info",
      message: "Started",
      createdAt: new Date("2026-06-18T10:06:01.000Z"),
    });

    expect(repos.automationRuns.listForGoal(goal.id)).toEqual([
      expect.objectContaining({ id: run.id, status: "running" }),
    ]);
    expect(repos.automationEvents.list(goal.id, 10)).toEqual([expect.objectContaining({ message: "Started" })]);
  });

  it("lists Radarr movies for automation with activity overlays", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const instanceId = repos.instances.upsert({
      kind: "radarr",
      name: "Radarr",
      baseUrl: "http://radarr.local:7878",
      apiKeyEncrypted: "encrypted",
      enabled: true,
      now: new Date("2026-06-18T10:00:00.000Z"),
    });
    const mediaItemId = repos.mediaItems.upsertAnalysis(instanceId, {
      ...analysis(),
      arrId: 401,
      childrenWithFile: 1,
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
      funChildren: 0,
      funShare: 0,
      funSizeBytes: 0,
      kind: "movie",
      nonFunChildren: 1,
      title: "Example Movie",
      titleSlug: undefined,
      totalChildren: 1,
      totalSizeBytes: 4_000,
      year: 2024,
    });

    repos.activityLog.insert({
      action: "search",
      quotaType: "search",
      status: "success",
      instanceId,
      mediaItemId,
      childArrId: 401,
      createdAt: new Date("2026-06-18T09:00:00.000Z"),
    });
    repos.activityLog.insert({
      action: "grab",
      quotaType: "grab",
      status: "success",
      instanceId,
      mediaItemId,
      childArrId: 401,
      createdAt: new Date("2026-06-18T09:30:00.000Z"),
    });

    expect(repos.mediaFiles.listForAutomation({ scope: "radarr" })).toEqual([
      expect.objectContaining({
        childArrId: 401,
        kind: "movie",
        lastGrabbedAt: "2026-06-18T09:30:00.000Z",
        lastSearchedAt: "2026-06-18T09:00:00.000Z",
        title: "Example Movie",
      }),
    ]);
  });

  it("marks existing work items out of scope when reconciling an empty desired item list", () => {
    const { goal, repos, workItems } = createAutomationFixture();

    repos.automationWorkItems.reconcile(goal.id, [workItems[1]]);
    repos.automationWorkItems.reconcile(goal.id, [], new Date("2026-06-18T10:06:00.000Z"));

    expect(repos.automationWorkItems.listForGoal(goal.id)).toEqual([
      expect.objectContaining({
        childArrId: 102,
        status: "out_of_scope",
        updatedAt: "2026-06-18T10:06:00.000Z",
      }),
    ]);
  });

  it("marks only removed desired work items out of scope when reconciling down to one item", () => {
    const { goal, repos, workItems } = createAutomationFixture();

    repos.automationWorkItems.reconcile(goal.id, workItems);
    repos.automationWorkItems.reconcile(goal.id, [workItems[0]], new Date("2026-06-18T10:06:00.000Z"));

    expect(repos.automationWorkItems.listForGoal(goal.id)).toEqual([
      expect.objectContaining({
        childArrId: 101,
        status: "pending",
        updatedAt: "2026-06-18T10:05:00.000Z",
      }),
      expect.objectContaining({
        childArrId: 102,
        status: "out_of_scope",
        updatedAt: "2026-06-18T10:06:00.000Z",
      }),
    ]);
  });

  it("updates automation work item status, timestamps, attempts, and error details", () => {
    const { goal, repos, workItems } = createAutomationFixture();
    repos.automationWorkItems.reconcile(goal.id, [workItems[1]]);
    const item = repos.automationWorkItems.listForGoal(goal.id)[0];

    repos.automationWorkItems.updateStatus(item.id, {
      status: "failed",
      lastSearchedAt: new Date("2026-06-18T10:07:00.000Z"),
      incrementSearchAttempt: true,
      lastError: "ARR search failed",
      updatedAt: new Date("2026-06-18T10:07:01.000Z"),
    });

    expect(repos.automationWorkItems.listForGoal(goal.id)).toEqual([
      expect.objectContaining({
        id: item.id,
        lastError: "ARR search failed",
        lastSearchedAt: "2026-06-18T10:07:00.000Z",
        searchAttemptCount: 1,
        status: "failed",
        updatedAt: "2026-06-18T10:07:01.000Z",
      }),
    ]);

    repos.automationWorkItems.updateStatus(item.id, {
      status: "grabbed",
      lastGrabbedAt: new Date("2026-06-18T10:08:00.000Z"),
      lastError: null,
      updatedAt: new Date("2026-06-18T10:08:01.000Z"),
    });

    expect(repos.automationWorkItems.listForGoal(goal.id)).toEqual([
      expect.objectContaining({
        id: item.id,
        lastError: null,
        lastGrabbedAt: "2026-06-18T10:08:00.000Z",
        searchAttemptCount: 1,
        status: "grabbed",
        updatedAt: "2026-06-18T10:08:01.000Z",
      }),
    ]);
  });

  it("excludes out-of-scope work items from goal metrics", () => {
    const { goal, instanceId, mediaItemId, repos, workItems } = createAutomationFixture();

    repos.releaseCandidates.insert({
      instanceId,
      mediaItemId,
      childArrId: 102,
      release: { guid: "candidate-102", title: "Example.Series.S01E02.FuN", releaseGroup: "FuN" },
      foundAt: new Date("2026-06-18T10:07:00.000Z"),
    });
    repos.automationWorkItems.reconcile(goal.id, workItems);
    repos.automationWorkItems.reconcile(goal.id, [workItems[0]], new Date("2026-06-18T10:06:00.000Z"));

    expect(repos.automationGoals.find(goal.id)).toMatchObject({
      currentFunShare: 1,
      matchingFiles: 1,
      pendingCandidates: 0,
      remainingNonFunFiles: 0,
      status: "target_reached",
    });
    expect(repos.automationGoals.list()).toEqual([
      expect.objectContaining({
        id: goal.id,
        currentFunShare: 1,
        matchingFiles: 1,
        pendingCandidates: 0,
        remainingNonFunFiles: 0,
        status: "target_reached",
      }),
    ]);
  });
});

function createAutomationFixture() {
  const db = createInMemoryDatabase();
  migrateDatabase(db);
  const repos = createRepositories(db);
  const instanceId = repos.instances.upsert({
    kind: "sonarr",
    name: "Sonarr",
    baseUrl: "http://sonarr.local:8989",
    apiKeyEncrypted: "encrypted",
    enabled: true,
    now: new Date("2026-06-18T10:00:00.000Z"),
  });
  const mediaItemId = repos.mediaItems.upsertAnalysis(instanceId, analysis());
  const goal = repos.automationGoals.upsert({
    name: "Goal",
    enabled: true,
    scope: "sonarr",
    targetFunShare: 0.95,
    filters: defaultFilters,
    actionMode: "search_and_grab",
    executionStrategy: "grab_immediately",
    ordering: "oldest_search_first",
    minSearchIntervalHours: 168,
    runOnStartup: true,
    schedule: null,
    now: new Date("2026-06-18T10:00:00.000Z"),
  });
  const files = repos.mediaFiles.listForAutomation({ scope: "sonarr" });
  const workItems = [
    {
      instanceId,
      mediaItemId,
      mediaFileId: files[0].mediaFileId,
      childArrId: 101,
      kind: "episode" as const,
      title: "Example Series S01E01",
      sortKey: "example series s01e01",
      isFun: true,
      lastAnalyzedAt: "2026-06-18T10:00:00.000Z",
      lastSearchedAt: files[0].lastSearchedAt,
      lastGrabbedAt: files[0].lastGrabbedAt,
      status: "pending" as const,
      now: new Date("2026-06-18T10:05:00.000Z"),
    },
    {
      instanceId,
      mediaItemId,
      mediaFileId: files[1].mediaFileId,
      childArrId: 102,
      kind: "episode" as const,
      title: "Example Series S01E02",
      sortKey: "example series s01e02",
      isFun: false,
      lastAnalyzedAt: "2026-06-18T10:00:00.000Z",
      lastSearchedAt: files[1].lastSearchedAt,
      lastGrabbedAt: files[1].lastGrabbedAt,
      status: "pending" as const,
      now: new Date("2026-06-18T10:06:00.000Z"),
    },
  ];

  return { goal, instanceId, mediaItemId, repos, workItems };
}

function analysis(): MediaItemAnalysis {
  return {
    arrId: 7,
    childrenWithFile: 2,
    files: [
      {
        arrFileId: 1001,
        childArrId: 101,
        episodeNumber: 1,
        isFun: true,
        path: "/tv/example/s01e01.mkv",
        qualityName: "WEBDL-1080p",
        releaseGroup: "FuN",
        seasonNumber: 1,
        sizeBytes: 1_000,
      },
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
    funChildren: 1,
    funShare: 0.5,
    funSizeBytes: 1_000,
    hasFile: true,
    kind: "series",
    lastAnalyzedAt: "2026-06-18T10:00:00.000Z",
    monitored: true,
    nonFunChildren: 1,
    qualityProfileName: "WEBDL-1080p",
    title: "Example Series",
    titleSlug: "example-series",
    totalChildren: 2,
    totalSizeBytes: 3_000,
  };
}
