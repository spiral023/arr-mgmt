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
