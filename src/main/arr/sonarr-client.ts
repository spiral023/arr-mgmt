import { ArrApiClient } from "./arr-api-client";
import type {
  ArrClientConfig,
  ArrCommand,
  ArrRelease,
  ArrStatus,
  SonarrEpisode,
  SonarrSeries
} from "./arr-types";

export class SonarrClient extends ArrApiClient {
  constructor(config: ArrClientConfig) {
    super(config);
  }

  getStatus(): Promise<ArrStatus> {
    return this.get<ArrStatus>("/system/status");
  }

  getSeries(): Promise<SonarrSeries[]> {
    return this.get<SonarrSeries[]>("/series");
  }

  getEpisodes(seriesId: number, includeEpisodeFile: boolean): Promise<SonarrEpisode[]> {
    return this.get<SonarrEpisode[]>("/episode", { seriesId, includeEpisodeFile });
  }

  getReleasesForEpisode(episodeId: number): Promise<ArrRelease[]> {
    return this.get<ArrRelease[]>("/release", { episodeId });
  }

  grabRelease(release: ArrRelease): Promise<ArrRelease> {
    return this.post<ArrRelease>("/release", release);
  }

  runEpisodeSearch(episodeIds: number[]): Promise<ArrCommand> {
    return this.post<ArrCommand>("/command", {
      name: "EpisodeSearch",
      episodeIds
    });
  }
}
