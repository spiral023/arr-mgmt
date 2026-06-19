import { describe, expect, it } from "vitest";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";

function setupMovie(repos: ReturnType<typeof createRepositories>) {
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
      {
        arrFileId: 3001,
        childArrId: 201,
        isFun: false,
        path: "/movies/example.mkv",
        relativePath: "example.mkv",
        releaseGroup: "WvF",
        qualityName: "WEBDL-1080p",
        sizeBytes: 4000,
      },
    ],
  });
  return { instanceId, mediaItemId };
}

describe("mediaItemOverrides", () => {
  it("excludes an item, deletes its FuN candidates, and reports it excluded", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const { instanceId, mediaItemId } = setupMovie(repos);

    repos.releaseCandidates.insert({
      instanceId,
      mediaItemId,
      childArrId: 201,
      release: { guid: "c1", title: "Example.Movie.2024.FuN", releaseGroup: "FuN" },
      foundAt: new Date("2026-06-19T20:05:00.000Z"),
    });

    const result = repos.mediaItemOverrides.setExcluded({
      kind: "movie",
      arrId: 201,
      excluded: true,
      now: new Date("2026-06-19T21:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    expect(repos.mediaItemOverrides.isExcluded(mediaItemId)).toBe(true);
    expect(repos.mediaItemOverrides.excludedItemIds()).toEqual([mediaItemId]);
    expect(repos.mediaItems.itemDetails("movie", 201).candidates).toHaveLength(0);
  });

  it("re-includes an item without dropping the override row", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const { mediaItemId } = setupMovie(repos);

    repos.mediaItemOverrides.setExcluded({ kind: "movie", arrId: 201, excluded: true, now: new Date("2026-06-19T21:00:00.000Z") });
    repos.mediaItemOverrides.setExcluded({ kind: "movie", arrId: 201, excluded: false, now: new Date("2026-06-19T22:00:00.000Z") });

    expect(repos.mediaItemOverrides.isExcluded(mediaItemId)).toBe(false);
    expect(repos.mediaItemOverrides.excludedItemIds()).toEqual([]);
  });

  it("returns ok:false when the media item does not exist", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    const result = repos.mediaItemOverrides.setExcluded({ kind: "movie", arrId: 999, excluded: true, now: new Date() });
    expect(result.ok).toBe(false);
  });

  it("cascades the override away when the media item is removed", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const { mediaItemId } = setupMovie(repos);
    repos.mediaItemOverrides.setExcluded({ kind: "movie", arrId: 201, excluded: true, now: new Date() });

    db.prepare("delete from media_items where id = ?").run(mediaItemId);
    expect(repos.mediaItemOverrides.excludedItemIds()).toEqual([]);
  });
});
