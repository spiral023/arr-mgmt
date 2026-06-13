import { describe, expect, it } from "vitest";
import type { ArrRelease, SonarrEpisode } from "../../src/main/arr/arr-types";
import { getNonFunEpisodeIds, selectBestFunRelease } from "../../src/main/arr/sonarr-operations";

describe("sonarr operations", () => {
  it("finds episodes with files that are not FuN releases", () => {
    const episodes: SonarrEpisode[] = [
      episode(1, "FuN"),
      episode(2, "WvF"),
      episode(3, null),
      { id: 4, seriesId: 10, hasFile: false },
    ];

    expect(getNonFunEpisodeIds(episodes)).toEqual([2, 3]);
  });

  it("selects the first allowed FuN release and ignores rejected releases", () => {
    const releases: ArrRelease[] = [
      release("bad", "FuN", { rejected: true, downloadAllowed: true }),
      release("wrong-group", "WvF", { rejected: false, downloadAllowed: true }),
      release("blocked", "FuNHD", { rejected: false, downloadAllowed: false }),
      release("good", "FuN", { rejected: false, downloadAllowed: true }),
    ];

    expect(selectBestFunRelease(releases)?.guid).toBe("good");
  });
});

function episode(id: number, releaseGroup: string | null): SonarrEpisode {
  return {
    id,
    seriesId: 10,
    hasFile: true,
    episodeFile: {
      releaseGroup,
    },
  };
}

function release(guid: string, releaseGroup: string, flags: Partial<ArrRelease>): ArrRelease {
  return {
    guid,
    title: guid,
    releaseGroup,
    ...flags,
  };
}
