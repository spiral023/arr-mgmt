import { ArrApiClient } from "./arr-api-client";
import type {
  ArrClientConfig,
  ArrCommand,
  ArrQualityProfile,
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
    return this.getArray<SonarrSeries>("/series");
  }

  getSeriesById(id: number): Promise<SonarrSeries> { return this.getEntity(`/series/${id}`, id); }
  getWanted(mode: "missing" | "cutoff", page = 1, pageSize = 100) {
    return this.getPage<SonarrEpisode>(`/wanted/${mode}`, {
      page, pageSize, monitored: true, includeSeries: true,
      ...(mode === "cutoff" ? { includeEpisodeFile: true } : {}),
    });
  }

  getQualityProfiles(): Promise<ArrQualityProfile[]> {
    return this.get<ArrQualityProfile[]>("/qualityprofile");
  }

  getEpisodes(seriesId: number, includeEpisodeFile: boolean): Promise<SonarrEpisode[]> {
    return this.getArray<SonarrEpisode>("/episode", { seriesId, includeEpisodeFile });
  }

  getReleasesForEpisode(episodeId: number): Promise<ArrRelease[]> {
    return this.getArray<ArrRelease>("/release", { episodeId });
  }

  /**
   * Season-level interactive search. One indexer query returns every release for the season —
   * including the individual per-episode releases — so a whole season of grabs can re-match
   * against a single result set instead of querying the indexer once per episode.
   */
  getReleasesForSeason(seriesId: number, seasonNumber: number): Promise<ArrRelease[]> {
    return this.getArray<ArrRelease>("/release", { seriesId, seasonNumber });
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
