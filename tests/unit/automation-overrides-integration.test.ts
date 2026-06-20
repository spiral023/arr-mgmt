import { describe, expect, it } from "vitest";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";

function setupRadarrMovie(repos: ReturnType<typeof createRepositories>) {
  const instanceId = repos.instances.upsert({
    kind: "radarr",
    name: "Radarr",
    baseUrl: "http://radarr.local:7878",
    apiKeyEncrypted: "enc",
    enabled: true,
    now: new Date("2026-06-20T10:00:00.000Z"),
  });
  repos.mediaItems.upsertAnalysis(instanceId, {
    arrId: 301,
    kind: "movie",
    title: "Excluded Movie",
    titleSlug: undefined,
    sortTitle: undefined,
    year: 2024,
    monitored: true,
    hasFile: true,
    totalChildren: 1,
    childrenWithFile: 1,
    funChildren: 0,
    nonFunChildren: 1,
    totalSizeBytes: 5000,
    funSizeBytes: 0,
    funShare: 0,
    lastAnalyzedAt: "2026-06-20T10:00:00.000Z",
    qualityProfileName: undefined,
    files: [
      { arrFileId: 4001, childArrId: 301, isFun: false, path: "/m/ex.mkv", relativePath: "ex.mkv", releaseGroup: "WvF", qualityName: "WEBDL-1080p", sizeBytes: 5000 },
    ],
  });
  return instanceId;
}

describe("listForAutomation with overrides", () => {
  it("excludes overridden movies from automation work list", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    setupRadarrMovie(repos);

    const before = repos.mediaFiles.listForAutomation({ scope: "radarr" });
    expect(before.some((f) => f.isExcluded)).toBe(false);

    repos.mediaItemOverrides.setExcluded({ kind: "movie", arrId: 301, excluded: true, now: new Date("2026-06-20T11:00:00.000Z") });

    const after = repos.mediaFiles.listForAutomation({ scope: "radarr" });
    expect(after.every((f) => f.isExcluded === false)).toBe(false);
    const excluded = after.filter((f) => f.isExcluded);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].isExcluded).toBe(true);
  });

  it("re-includes a movie after override is removed", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    setupRadarrMovie(repos);

    repos.mediaItemOverrides.setExcluded({ kind: "movie", arrId: 301, excluded: true, now: new Date("2026-06-20T11:00:00.000Z") });
    repos.mediaItemOverrides.setExcluded({ kind: "movie", arrId: 301, excluded: false, now: new Date("2026-06-20T12:00:00.000Z") });

    const rows = repos.mediaFiles.listForAutomation({ scope: "radarr" });
    expect(rows.every((f) => !f.isExcluded)).toBe(true);
  });
});
