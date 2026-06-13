import type { ArrRelease, SonarrEpisode } from "./arr-types";
import { isFunReleaseGroup } from "../../shared/fun";

export function getNonFunEpisodeIds(episodes: SonarrEpisode[]): number[] {
  return episodes
    .filter((episode) => episode.hasFile !== false)
    .filter((episode) => !isFunReleaseGroup(episode.episodeFile?.releaseGroup))
    .map((episode) => episode.id);
}

export function selectBestFunRelease(releases: ArrRelease[]): ArrRelease | undefined {
  return releases.find((release) => {
    if (!isFunReleaseGroup(release.releaseGroup)) {
      return false;
    }
    if (release.rejected === true) {
      return false;
    }
    if (release.downloadAllowed === false) {
      return false;
    }
    return true;
  });
}
