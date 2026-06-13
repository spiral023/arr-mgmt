import { ArrApiClient } from "./arr-api-client";
import type { ArrClientConfig, ArrCommand, ArrRelease, ArrStatus, RadarrMovie } from "./arr-types";

export class RadarrClient extends ArrApiClient {
  constructor(config: ArrClientConfig) {
    super(config);
  }

  getStatus(): Promise<ArrStatus> {
    return this.get<ArrStatus>("/system/status");
  }

  getMovies(): Promise<RadarrMovie[]> {
    return this.get<RadarrMovie[]>("/movie");
  }

  getReleasesForMovie(movieId: number): Promise<ArrRelease[]> {
    return this.get<ArrRelease[]>("/release", { movieId });
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
