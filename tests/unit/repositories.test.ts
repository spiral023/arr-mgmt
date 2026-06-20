import { describe, expect, it } from "vitest";
import type { MediaItemAnalysis } from "../../src/main/arr/arr-types";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";

describe("repositories", () => {
  it("persists Sonarr analysis rows and overlays last search and grab activity", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    const instanceId = repos.instances.upsert({
      kind: "sonarr",
      name: "Sonarr",
      baseUrl: "http://sonarr.local:8989",
      apiKeyEncrypted: "encrypted",
      enabled: true,
      now: new Date("2026-06-13T20:00:00.000Z"),
    });

    const mediaItemId = repos.mediaItems.upsertAnalysis(instanceId, analysis());

    expect(repos.mediaItems.listAnalyzedArrIds("series", instanceId)).toEqual([7]);

    repos.activityLog.insert({
      action: "search",
      quotaType: "search",
      status: "success",
      instanceId,
      mediaItemId,
      childArrId: 101,
      createdAt: new Date("2026-06-13T20:05:00.000Z"),
    });
    repos.activityLog.insert({
      action: "grab",
      quotaType: "grab",
      status: "success",
      instanceId,
      mediaItemId,
      childArrId: 101,
      createdAt: new Date("2026-06-13T20:10:00.000Z"),
    });
    repos.releaseCandidates.insert({
      instanceId,
      mediaItemId,
      childArrId: 102,
      release: { guid: "candidate-1", title: "Example.Series.S01E02.FuN", releaseGroup: "FuN" },
      foundAt: new Date("2026-06-13T20:12:00.000Z"),
    });
    repos.releaseCandidates.insert({
      instanceId,
      mediaItemId,
      childArrId: 103,
      release: { guid: "candidate-2", title: "Example.Series.S01E03.FuN", releaseGroup: "FuN" },
      foundAt: new Date("2026-06-13T20:13:00.000Z"),
    });

    expect(repos.mediaItems.listSonarrRows()).toEqual([
      expect.objectContaining({
        arrId: 7,
        episodes: 2,
        files: 2,
        funFiles: 1,
        lastAnalyzed: "2026-06-13T20:00:00.000Z",
        lastGrabbed: "2026-06-13T20:10:00.000Z",
        lastSearched: "2026-06-13T20:05:00.000Z",
        nonFunFiles: 1,
        pendingFunCandidates: 2,
        status: "searchable",
        title: "Example Series",
        titleSlug: "example-series",
      }),
    ]);
  });

  it("persists Radarr rows with pending candidates", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    const instanceId = repos.instances.upsert({
      kind: "radarr",
      name: "Radarr",
      baseUrl: "http://radarr.local:7878",
      apiKeyEncrypted: "encrypted",
      enabled: true,
      now: new Date("2026-06-13T20:00:00.000Z"),
    });
    const mediaItemId = repos.mediaItems.upsertAnalysis(instanceId, {
      ...analysis(),
      arrId: 201,
      childrenWithFile: 1,
      files: [
        {
          arrFileId: 3001,
          childArrId: 201,
          isFun: false,
          path: "/movies/example.mkv",
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

    repos.releaseCandidates.insert({
      instanceId,
      mediaItemId,
      childArrId: 201,
      release: { guid: "radarr-candidate", title: "Example.Movie.2024.FuN", releaseGroup: "FuN" },
      foundAt: new Date("2026-06-13T21:00:00.000Z"),
    });

    expect(repos.mediaItems.listRadarrRows()).toEqual([
      expect.objectContaining({
        arrId: 201,
        files: 1,
        funFiles: 0,
        nonFunFiles: 1,
        pendingFunCandidates: 1,
        status: "searchable",
        title: "Example Movie",
        year: 2024,
      }),
    ]);
  });

  it("clears stale FuN candidates for children that reached their target on re-analysis", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    const instanceId = repos.instances.upsert({
      kind: "sonarr",
      name: "Sonarr",
      baseUrl: "http://sonarr.local:8989",
      apiKeyEncrypted: "encrypted",
      enabled: true,
      now: new Date("2026-06-13T20:00:00.000Z"),
    });

    const mediaItemId = repos.mediaItems.upsertAnalysis(instanceId, analysis());

    // Episode 101 already has a FuN file; episode 102 does not yet.
    repos.releaseCandidates.insert({
      instanceId,
      mediaItemId,
      childArrId: 101,
      release: { guid: "stale", title: "Example.Series.S01E01.FuN", releaseGroup: "FuN" },
      foundAt: new Date("2026-06-13T20:12:00.000Z"),
    });
    repos.releaseCandidates.insert({
      instanceId,
      mediaItemId,
      childArrId: 102,
      release: { guid: "still-needed", title: "Example.Series.S01E02.FuN", releaseGroup: "FuN" },
      foundAt: new Date("2026-06-13T20:13:00.000Z"),
    });

    // Re-analysing the same library state must drop the obsolete candidate for
    // the FuN episode while keeping the one for the still-non-FuN episode.
    repos.mediaItems.upsertAnalysis(instanceId, analysis());

    expect(repos.mediaItems.listSonarrRows()).toEqual([
      expect.objectContaining({ arrId: 7, pendingFunCandidates: 1 }),
    ]);
    expect(repos.releaseCandidates.listForSeriesIds([7]).map((c) => c.childArrId)).toEqual([102]);
  });

  it("stores daily coverage snapshots and activity stats", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const sonarrId = repos.instances.upsert({
      kind: "sonarr",
      name: "Sonarr",
      baseUrl: "http://sonarr.local:8989",
      apiKeyEncrypted: "encrypted",
      enabled: true,
      now: new Date("2026-06-13T20:00:00.000Z"),
    });

    repos.mediaItems.upsertAnalysis(sonarrId, analysis());
    repos.stats.recordCoverageSnapshot(new Date("2026-06-13T22:00:00.000Z"));
    repos.activityLog.insert({
      action: "search",
      quotaType: "search",
      status: "success",
      instanceId: sonarrId,
      createdAt: new Date("2026-06-13T20:05:00.000Z"),
    });
    repos.activityLog.insert({
      action: "grab",
      quotaType: "grab",
      status: "success",
      instanceId: sonarrId,
      createdAt: new Date("2026-06-13T20:10:00.000Z"),
    });

    expect(repos.stats.summary()).toEqual(
      expect.objectContaining({
        dailyActivity: [
          expect.objectContaining({
            date: "2026-06-13",
            grabs: 1,
            searches: 1,
          }),
        ],
        coverageHistory: [
          expect.objectContaining({
            date: "2026-06-13",
            sonarrFunShare: 0.5,
          }),
        ],
      }),
    );
  });

  it("finds recent child activity for cooldown checks", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const instanceId = repos.instances.upsert({
      kind: "sonarr",
      name: "Sonarr",
      baseUrl: "http://sonarr.local:8989",
      apiKeyEncrypted: "encrypted",
      enabled: true,
      now: new Date("2026-06-13T20:00:00.000Z"),
    });
    const mediaItemId = repos.mediaItems.upsertAnalysis(instanceId, analysis());

    repos.activityLog.insert({
      action: "search",
      quotaType: "search",
      status: "success",
      instanceId,
      mediaItemId,
      childArrId: 101,
      createdAt: new Date("2026-06-13T19:00:00.000Z"),
    });

    expect(
      repos.activityLog.hasRecentChildActivity({
        action: "search",
        childArrId: 101,
        instanceId,
        now: new Date("2026-06-13T20:00:00.000Z"),
        windowHours: 24,
      }),
    ).toBe(true);
    expect(
      repos.activityLog.hasRecentChildActivity({
        action: "search",
        childArrId: 102,
        instanceId,
        now: new Date("2026-06-13T20:00:00.000Z"),
        windowHours: 24,
      }),
    ).toBe(false);
  });

  it("upserts and lists persisted schedules", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    const schedule = repos.schedules.upsert({
      actions: ["analysis", "search"],
      enabled: true,
      intervalKind: "daily_time",
      name: "Nightly",
      targetScope: "sonarr",
      timeOfDay: "03:30",
      now: new Date("2026-06-13T20:00:00.000Z"),
    });

    expect(schedule).toEqual(
      expect.objectContaining({
        actions: ["analysis", "search"],
        enabled: true,
        intervalKind: "daily_time",
        name: "Nightly",
        targetScope: "sonarr",
        timeOfDay: "03:30",
      }),
    );

    const updated = repos.schedules.upsert({
      id: schedule.id,
      actions: ["analysis"],
      enabled: false,
      intervalKind: "hours",
      intervalValue: 6,
      name: "Every six hours",
      targetScope: "all",
      now: new Date("2026-06-13T21:00:00.000Z"),
    });

    expect(repos.schedules.list()).toEqual([
      expect.objectContaining({
        id: schedule.id,
        actions: ["analysis"],
        enabled: false,
        intervalKind: "hours",
        intervalValue: 6,
        name: "Every six hours",
        nextRunAt: updated.nextRunAt,
        targetScope: "all",
      }),
    ]);
  });

  it("records performance samples and summarizes them per job", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    repos.perfSamples.insert({
      jobId: "job-1",
      app: "sonarr",
      phase: "grab",
      operation: "grab_post",
      childArrId: 101,
      strategy: "guid",
      outcome: "success",
      durationMs: 120.4,
      createdAt: new Date("2026-06-14T10:00:00.000Z"),
    });
    repos.perfSamples.insert({
      jobId: "job-1",
      app: "sonarr",
      phase: "grab",
      operation: "grab_post",
      childArrId: 102,
      strategy: "guid",
      outcome: "success",
      durationMs: 80.6,
      createdAt: new Date("2026-06-14T10:00:01.000Z"),
    });
    repos.perfSamples.insert({
      jobId: "job-1",
      app: "sonarr",
      phase: "grab",
      operation: "season_refetch",
      childArrId: 103,
      outcome: "success",
      durationMs: 5_000,
      createdAt: new Date("2026-06-14T10:00:02.000Z"),
    });
    repos.perfSamples.insert({
      jobId: "job-2",
      app: "radarr",
      phase: "grab",
      operation: "grab_post",
      childArrId: 201,
      strategy: "guid",
      outcome: "success",
      durationMs: 999,
      createdAt: new Date("2026-06-14T11:00:00.000Z"),
    });

    expect(repos.perfSamples.summarizeForJob("job-1")).toEqual([
      { operation: "grab_post", outcome: "success", count: 2, avgMs: 101, minMs: 81, maxMs: 120 },
      { operation: "season_refetch", outcome: "success", count: 1, avgMs: 5_000, minMs: 5_000, maxMs: 5_000 },
    ]);
    expect(repos.perfSamples.summarizeByPhase("grab")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "grab_post", outcome: "success", count: 3 }),
      ]),
    );
  });
});

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
    lastAnalyzedAt: "2026-06-13T20:00:00.000Z",
    monitored: true,
    nonFunChildren: 1,
    title: "Example Series",
    titleSlug: "example-series",
    totalChildren: 2,
    totalSizeBytes: 3_000,
  };
}
