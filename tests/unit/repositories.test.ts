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
        status: "searchable",
        title: "Example Series",
      }),
    ]);
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
    totalChildren: 2,
    totalSizeBytes: 3_000,
  };
}
