import { describe, expect, it } from "vitest";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";

function setupInstance(repos: ReturnType<typeof createRepositories>) {
  return repos.instances.upsert({
    kind: "radarr",
    name: "Radarr",
    baseUrl: "http://radarr.local:7878",
    apiKeyEncrypted: "enc",
    enabled: true,
    now: new Date("2026-06-19T20:00:00.000Z"),
  });
}

describe("mediaItems.upsertAnalysis stale candidate cleanup", () => {
  it("deletes release_candidates when a child gets a FuN file", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    const instanceId = setupInstance(repos);

    // Insert initial media item with a non-FuN file
    const mediaItemId = repos.mediaItems.upsertAnalysis(instanceId, {
      arrId: 101,
      kind: "movie",
      title: "Test Movie",
      titleSlug: undefined,
      sortTitle: undefined,
      year: 2024,
      monitored: true,
      hasFile: true,
      totalChildren: 1,
      childrenWithFile: 1,
      funChildren: 0,
      nonFunChildren: 1,
      totalSizeBytes: 3000,
      funSizeBytes: 0,
      funShare: 0,
      lastAnalyzedAt: "2026-06-19T20:00:00.000Z",
      qualityProfileName: undefined,
      files: [
        {
          arrFileId: 5001,
          childArrId: 101,
          isFun: false,
          path: "/movies/test.mkv",
          relativePath: "test.mkv",
          releaseGroup: "WvF",
          qualityName: "WEBDL-1080p",
          sizeBytes: 3000,
        },
      ],
    });

    // Insert a release candidate for this child
    repos.releaseCandidates.insert({
      instanceId,
      mediaItemId,
      childArrId: 101,
      release: { guid: "guid1", title: "Test.Movie.2024.FuN", releaseGroup: "FuN" },
      foundAt: new Date("2026-06-19T20:05:00.000Z"),
    });

    // Verify the candidate exists
    const candidatesBefore = repos.releaseCandidates.listForMovieIds([101]);
    expect(candidatesBefore).toHaveLength(1);

    // Upsert the media item with a FuN file now
    repos.mediaItems.upsertAnalysis(instanceId, {
      arrId: 101,
      kind: "movie",
      title: "Test Movie",
      titleSlug: undefined,
      sortTitle: undefined,
      year: 2024,
      monitored: true,
      hasFile: true,
      totalChildren: 1,
      childrenWithFile: 1,
      funChildren: 1,
      nonFunChildren: 0,
      totalSizeBytes: 2500,
      funSizeBytes: 2500,
      funShare: 100,
      lastAnalyzedAt: "2026-06-19T20:10:00.000Z",
      qualityProfileName: undefined,
      files: [
        {
          arrFileId: 5002,
          childArrId: 101,
          isFun: true,
          path: "/movies/test-fun.mkv",
          relativePath: "test-fun.mkv",
          releaseGroup: "FuN",
          qualityName: "WEBDL-1080p",
          sizeBytes: 2500,
        },
      ],
    });

    // Verify the candidate is now deleted
    const candidatesAfter = repos.releaseCandidates.listForMovieIds([101]);
    expect(candidatesAfter).toHaveLength(0);
  });

  it("preserves release_candidates when a child does not have a FuN file", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    const instanceId = setupInstance(repos);

    // Insert initial media item with a non-FuN file
    const mediaItemId = repos.mediaItems.upsertAnalysis(instanceId, {
      arrId: 102,
      kind: "movie",
      title: "Another Movie",
      titleSlug: undefined,
      sortTitle: undefined,
      year: 2024,
      monitored: true,
      hasFile: true,
      totalChildren: 1,
      childrenWithFile: 1,
      funChildren: 0,
      nonFunChildren: 1,
      totalSizeBytes: 4000,
      funSizeBytes: 0,
      funShare: 0,
      lastAnalyzedAt: "2026-06-19T20:00:00.000Z",
      qualityProfileName: undefined,
      files: [
        {
          arrFileId: 6001,
          childArrId: 102,
          isFun: false,
          path: "/movies/another.mkv",
          relativePath: "another.mkv",
          releaseGroup: "WvF",
          qualityName: "WEBDL-1080p",
          sizeBytes: 4000,
        },
      ],
    });

    // Insert a release candidate for this child
    repos.releaseCandidates.insert({
      instanceId,
      mediaItemId,
      childArrId: 102,
      release: { guid: "guid2", title: "Another.Movie.2024.FuN", releaseGroup: "FuN" },
      foundAt: new Date("2026-06-19T20:05:00.000Z"),
    });

    // Verify the candidate exists
    const candidatesBefore = repos.releaseCandidates.listForMovieIds([102]);
    expect(candidatesBefore).toHaveLength(1);

    // Upsert the media item with a different non-FuN file
    repos.mediaItems.upsertAnalysis(instanceId, {
      arrId: 102,
      kind: "movie",
      title: "Another Movie",
      titleSlug: undefined,
      sortTitle: undefined,
      year: 2024,
      monitored: true,
      hasFile: true,
      totalChildren: 1,
      childrenWithFile: 1,
      funChildren: 0,
      nonFunChildren: 1,
      totalSizeBytes: 3500,
      funSizeBytes: 0,
      funShare: 0,
      lastAnalyzedAt: "2026-06-19T20:10:00.000Z",
      qualityProfileName: undefined,
      files: [
        {
          arrFileId: 6002,
          childArrId: 102,
          isFun: false,
          path: "/movies/another-updated.mkv",
          relativePath: "another-updated.mkv",
          releaseGroup: "WvF",
          qualityName: "WEBDL-1080p",
          sizeBytes: 3500,
        },
      ],
    });

    // Verify the candidate is still there
    const candidatesAfter = repos.releaseCandidates.listForMovieIds([102]);
    expect(candidatesAfter).toHaveLength(1);
  });
});
