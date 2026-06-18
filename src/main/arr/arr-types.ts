export type ArrKind = "sonarr" | "radarr";

export type ArrQualityProfile = {
  id: number;
  name: string;
  [key: string]: unknown;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ArrRequestRateLimiter = {
  waitForSlot: () => Promise<void>;
};

export type ArrClientConfig = {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  rateLimiter?: ArrRequestRateLimiter;
};

export type ArrStatus = {
  version?: string;
  appName?: string;
  instanceName?: string;
  urlBase?: string;
  [key: string]: unknown;
};

export type ArrQuality = {
  quality?: {
    name?: string;
  };
  [key: string]: unknown;
};

export type ArrRelease = {
  guid?: string;
  title?: string;
  releaseGroup?: string | null;
  quality?: ArrQuality;
  indexer?: string;
  approved?: boolean;
  downloadAllowed?: boolean;
  rejected?: boolean;
  rejections?: string[];
  size?: number;
  [key: string]: unknown;
};

export type ArrCommand = {
  id?: number;
  name?: string;
  commandName?: string;
  status?: string;
  queued?: string;
  started?: string;
  ended?: string;
  message?: string;
  [key: string]: unknown;
};

export type SonarrSeries = {
  id: number;
  title: string;
  titleSlug?: string;
  sortTitle?: string;
  monitored?: boolean;
  year?: number;
  qualityProfileId?: number;
  [key: string]: unknown;
};

export type SonarrEpisodeFile = {
  id?: number;
  releaseGroup?: string | null;
  size?: number;
  path?: string;
  relativePath?: string;
  quality?: ArrQuality;
  [key: string]: unknown;
};

export type SonarrEpisode = {
  id: number;
  seriesId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  title?: string;
  monitored?: boolean;
  hasFile?: boolean;
  episodeFileId?: number;
  episodeFile?: SonarrEpisodeFile | null;
  [key: string]: unknown;
};

export type RadarrMovieFile = {
  id?: number;
  releaseGroup?: string | null;
  size?: number;
  path?: string;
  relativePath?: string;
  quality?: ArrQuality;
  [key: string]: unknown;
};

export type RadarrMovie = {
  id: number;
  title: string;
  sortTitle?: string;
  year?: number;
  monitored?: boolean;
  movieFile?: RadarrMovieFile | null;
  qualityProfileId?: number;
  [key: string]: unknown;
};

export type AnalysisFile = {
  arrFileId?: number;
  childArrId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  path?: string;
  relativePath?: string;
  releaseGroup: string | null;
  isFun: boolean;
  qualityName?: string;
  sizeBytes: number;
};

export type MediaItemAnalysis = {
  kind: "series" | "movie";
  arrId: number;
  title: string;
  titleSlug?: string;
  sortTitle?: string;
  year?: number;
  monitored: boolean;
  hasFile: boolean;
  totalChildren: number;
  childrenWithFile: number;
  funChildren: number;
  nonFunChildren: number;
  totalSizeBytes: number;
  funSizeBytes: number;
  funShare: number;
  lastAnalyzedAt: string;
  qualityProfileName?: string;
  files: AnalysisFile[];
};

export type AnalysisSummary = {
  totalItems: number;
  itemsWithFile: number;
  funItems: number;
  nonFunItems: number;
  totalSizeBytes: number;
  funSizeBytes: number;
  funShare: number;
};
