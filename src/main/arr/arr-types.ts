export type ArrKind = "sonarr" | "radarr";

export type ArrQualityProfile = {
  id: number;
  name: string;
  [key: string]: unknown;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ArrRequestRateLimiter = {
  waitForSlot: (signal?: AbortSignal) => Promise<void>;
};

export type ArrClientConfig = {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  rateLimiter?: ArrRequestRateLimiter;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type ArrPage<T> = { page: number; pageSize: number; totalRecords: number; records: T[] };
export type ArrHistory = {
  id: number; date: string; eventType: string; downloadId?: string;
  sourceTitle?: string; movieId?: number; seriesId?: number; episodeId?: number;
  data?: Record<string, string>;
};
export type ArrQueueItem = {
  id: number; downloadId?: string; title?: string; movieId?: number; seriesId?: number; episodeId?: number;
  status?: string; trackedDownloadStatus?: string; trackedDownloadState?: string;
  statusMessages?: Array<{ title?: string; messages?: string[] }>;
};
export type ArrMediaInfo = {
  runTime?: string | null; videoBitrate?: number; audioBitrate?: number;
  videoCodec?: string | null; audioCodec?: string | null; audioLanguages?: string | null;
  resolution?: string | null; videoDynamicRangeType?: string | null;
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
  tvdbId?: number;
  tmdbId?: number;
  imdbId?: string;
  [key: string]: unknown;
};

export type SonarrEpisodeFile = {
  id?: number;
  releaseGroup?: string | null;
  size?: number;
  path?: string;
  relativePath?: string;
  quality?: ArrQuality;
  mediaInfo?: ArrMediaInfo;
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
  mediaInfo?: ArrMediaInfo;
  [key: string]: unknown;
};

export type RadarrMovie = {
  id: number;
  title: string;
  sortTitle?: string;
  titleSlug?: string;
  year?: number;
  tmdbId?: number;
  imdbId?: string;
  monitored?: boolean;
  hasFile?: boolean;
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
  mediaInfo?: import("../../shared/ipc-contracts").FileMediaInfo;
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
  externalIds?: { tmdbId?: number; tvdbId?: number; imdbId?: string };
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
