import { describe, expect, it } from "vitest";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";

function setupExcludedMovieWithCandidate() {
  const db = createInMemoryDatabase();
  migrateDatabase(db);
  const repos = createRepositories(db);
  const instanceId = repos.instances.upsert({
    kind: "radarr",
    name: "Radarr",
    baseUrl: "http://radarr.local:7878",
    apiKeyEncrypted: "encrypted",
    enabled: true,
    now: new Date("2026-06-19T20:00:00.000Z"),
  });
  const mediaItemId = repos.mediaItems.upsertAnalysis(instanceId, {
    arrId: 201,
    kind: "movie",
    title: "Example Movie",
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
      { arrFileId: 3001, childArrId: 201, isFun: false, path: "/m/e.mkv", relativePath: "e.mkv", releaseGroup: "WvF", qualityName: "WEBDL-1080p", sizeBytes: 4000 },
    ],
  });
  // Candidate inserted BEFORE exclusion so the count query (not just the cleanup) is exercised.
  repos.releaseCandidates.insert({
    instanceId,
    mediaItemId,
    childArrId: 201,
    release: { guid: "c1", title: "Example.Movie.2024.FuN", releaseGroup: "FuN" },
    foundAt: new Date("2026-06-19T20:05:00.000Z"),
  });
  return { db, repos, mediaItemId };
}

describe("pending FuN queries with overrides", () => {
  it("flags excluded rows and drops them from pending counts", () => {
    const { repos, mediaItemId } = setupExcludedMovieWithCandidate();

    // Re-insert a candidate AFTER marking excluded via raw row, bypassing cleanup,
    // to prove the count query itself filters excluded items.
    repos.mediaItemOverrides.setExcluded({ kind: "movie", arrId: 201, excluded: true, now: new Date("2026-06-19T21:00:00.000Z") });
    repos.releaseCandidates.insert({
      instanceId: 1,
      mediaItemId,
      childArrId: 201,
      release: { guid: "c2", title: "Example.Movie.2024.FuN.PROPER", releaseGroup: "FuN" },
      foundAt: new Date("2026-06-19T21:05:00.000Z"),
    });

    const radarrRows = repos.mediaItems.listRadarrRows();
    expect(radarrRows[0].isExcluded).toBe(true);
    expect(radarrRows[0].pendingFunCandidates).toBe(0);

    const summary = repos.mediaItems.summary();
    expect(summary.radarrPendingFunCandidates).toBe(0);
  });

  it("leaves non-excluded rows unaffected", () => {
    const { repos } = setupExcludedMovieWithCandidate();
    const radarrRows = repos.mediaItems.listRadarrRows();
    expect(radarrRows[0].isExcluded).toBe(false);
    expect(radarrRows[0].pendingFunCandidates).toBe(1);
    expect(repos.mediaItems.summary().radarrPendingFunCandidates).toBe(1);
  });
});
