import { ArrApiClient } from "./arr-api-client";
import type { ArrClientConfig, ArrCommand, ArrQualityProfile, ArrRelease, ArrStatus, RadarrMovie } from "./arr-types";

export class RadarrClient extends ArrApiClient {
  constructor(config: ArrClientConfig) {
    super(config);
  }

  getStatus(): Promise<ArrStatus> {
    return this.get<ArrStatus>("/system/status");
  }

  getMovies(): Promise<RadarrMovie[]> {
    return this.getArray<RadarrMovie>("/movie");
  }

  getMovie(id: number): Promise<RadarrMovie> { return this.getEntity(`/movie/${id}`, id); }
  getMoviesByTmdbId(tmdbId: number): Promise<RadarrMovie[]> { return this.getArray("/movie", { tmdbId }); }
  getWanted(mode: "missing" | "cutoff", page = 1, pageSize = 100) {
    return this.getPage<RadarrMovie>(`/wanted/${mode}`, { page, pageSize, monitored: true });
  }
  getMovieFile(id: number) { return this.get<import("./arr-types").RadarrMovieFile>(`/moviefile/${id}`); }

  getQualityProfiles(): Promise<ArrQualityProfile[]> {
    return this.get<ArrQualityProfile[]>("/qualityprofile");
  }

  getReleasesForMovie(movieId: number): Promise<ArrRelease[]> {
    return this.getArray<ArrRelease>("/release", { movieId });
  }

  grabRelease(release: ArrRelease): Promise<ArrRelease> {
    return this.post<ArrRelease>("/release", release);
  }

  runMoviesSearch(movieIds: number[]): Promise<ArrCommand> {
    return this.post<ArrCommand>("/command", {
      name: "MoviesSearch",
      movieIds
    });
  }
}
