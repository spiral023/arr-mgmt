import { describe, expect, it } from "vitest";
import { analyzeRadarrMovies, analyzeSonarrSeries } from "../../src/main/arr/analysis-service";
import { isFunReleaseGroup } from "../../src/shared/fun";

const analyzedAt = new Date("2026-06-13T20:00:00.000Z");

describe("isFunReleaseGroup", () => {
  it("matches FuN release groups case-insensitively by prefix", () => {
    expect(isFunReleaseGroup("FuN")).toBe(true);
    expect(isFunReleaseGroup("FUNHD")).toBe(true);
    expect(isFunReleaseGroup(" fun-team ")).toBe(true);
  });

  it("does not match empty or unrelated release groups", () => {
    expect(isFunReleaseGroup("WvF")).toBe(false);
    expect(isFunReleaseGroup("")).toBe(false);
    expect(isFunReleaseGroup(null)).toBe(false);
    expect(isFunReleaseGroup(undefined)).toBe(false);
  });
});

describe("analysis aggregation", () => {
  it("aggregates Sonarr FuN counts and sizes from episode fixtures", () => {
    const result = analyzeSonarrSeries(
      { id: 7, title: "Example Series", monitored: true },
      [
        {
          id: 101,
          seriesId: 7,
          seasonNumber: 1,
          episodeNumber: 1,
          hasFile: true,
          episodeFile: { id: 1001, releaseGroup: "FuN", size: 1_000 }
        },
        {
          id: 102,
          seriesId: 7,
          seasonNumber: 1,
          episodeNumber: 2,
          hasFile: true,
          episodeFile: { id: 1002, releaseGroup: "WvF", size: 2_000 }
        },
        {
          id: 103,
          seriesId: 7,
          seasonNumber: 1,
          episodeNumber: 3,
          hasFile: true,
          episodeFile: { id: 1003, releaseGroup: "", size: 3_000 }
        },
        {
          id: 104,
          seriesId: 7,
          seasonNumber: 1,
          episodeNumber: 4,
          hasFile: false,
          episodeFile: null
        }
      ],
      analyzedAt
    );

    expect(result).toMatchObject({
      kind: "series",
      arrId: 7,
      title: "Example Series",
      totalChildren: 4,
      childrenWithFile: 3,
      funChildren: 1,
      nonFunChildren: 2,
      totalSizeBytes: 6_000,
      funSizeBytes: 1_000,
      funShare: 1 / 3,
      lastAnalyzedAt: "2026-06-13T20:00:00.000Z"
    });
    expect(result.files).toHaveLength(3);
    expect(result.files.map((file) => [file.childArrId, file.releaseGroup, file.isFun])).toEqual([
      [101, "FuN", true],
      [102, "WvF", false],
      [103, "", false]
    ]);
  });

  it("aggregates Radarr FuN counts and sizes from movie fixtures", () => {
    const result = analyzeRadarrMovies(
      [
        {
          id: 201,
          title: "Fun Movie",
          year: 2020,
          monitored: true,
          movieFile: { id: 3001, releaseGroup: "FuNHD", size: 4_000 }
        },
        {
          id: 202,
          title: "Other Movie",
          year: 2021,
          monitored: true,
          movieFile: { id: 3002, releaseGroup: "TSCC", size: 6_000 }
        },
        {
          id: 203,
          title: "Missing Movie",
          year: 2022,
          monitored: false,
          movieFile: null
        }
      ],
      analyzedAt
    );

    expect(result.summary).toEqual({
      totalItems: 3,
      itemsWithFile: 2,
      funItems: 1,
      nonFunItems: 1,
      totalSizeBytes: 10_000,
      funSizeBytes: 4_000,
      funShare: 1 / 2
    });
    expect(result.items.map((item) => [item.arrId, item.title, item.funChildren, item.funShare])).toEqual([
      [201, "Fun Movie", 1, 1],
      [202, "Other Movie", 0, 0],
      [203, "Missing Movie", 0, 0]
    ]);
  });
});
