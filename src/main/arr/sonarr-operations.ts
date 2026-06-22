import type { ArrRelease, RadarrMovie, SonarrEpisode } from "./arr-types";
import { isFunReleaseGroup } from "../../shared/fun";

export function getNonFunEpisodeIds(episodes: SonarrEpisode[]): number[] {
  return episodes
    .filter((episode) => episode.hasFile !== false)
    .filter((episode) => !isFunReleaseGroup(episode.episodeFile?.releaseGroup))
    .map((episode) => episode.id);
}

export function getNonFunMovieIds(movies: RadarrMovie[]): number[] {
  return movies
    .filter((movie) => movie.movieFile)
    .filter((movie) => !isFunReleaseGroup(movie.movieFile?.releaseGroup))
    .map((movie) => movie.id);
}

/**
 * Ein Release ist grabbbar, wenn Radarr/Sonarr es nicht abgelehnt und den Download
 * nicht blockiert hat. `approved` wird nicht gesondert geprüft: Ein Release mit
 * `approved === false` trägt immer auch `rejected === true`, sodass `rejected`
 * bereits ausreichend gatet.
 */
export function isGrabbableRelease(release: ArrRelease): boolean {
  return release.rejected !== true && release.downloadAllowed !== false;
}

export function selectBestFunRelease(releases: ArrRelease[]): ArrRelease | undefined {
  return releases.find((release) => isFunReleaseGroup(release.releaseGroup) && isGrabbableRelease(release));
}
