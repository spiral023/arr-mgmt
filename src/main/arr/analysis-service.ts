import type {
  AnalysisFile,
  AnalysisSummary,
  MediaItemAnalysis,
  RadarrMovie,
  SonarrEpisode,
  SonarrSeries
} from "./arr-types";
import { isFunReleaseGroup } from "../../shared/fun";

export type RadarrAnalysisResult = {
  items: MediaItemAnalysis[];
  summary: AnalysisSummary;
};

export function analyzeSonarrSeries(
  series: SonarrSeries,
  episodes: SonarrEpisode[],
  analyzedAt = new Date()
): MediaItemAnalysis {
  const files: AnalysisFile[] = episodes.flatMap((episode) => {
    if (!episode.episodeFile) {
      return [];
    }

    const releaseGroup = episode.episodeFile.releaseGroup ?? null;
    const sizeBytes = episode.episodeFile.size ?? 0;

    return [
      {
        arrFileId: episode.episodeFile.id,
        childArrId: episode.id,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        path: episode.episodeFile.path,
        relativePath: episode.episodeFile.relativePath,
        releaseGroup,
        isFun: isFunReleaseGroup(releaseGroup),
        qualityName: episode.episodeFile.quality?.quality?.name,
        sizeBytes
      }
    ];
  });

  return buildMediaItemAnalysis({
    kind: "series",
    arrId: series.id,
    title: series.title,
    titleSlug: series.titleSlug,
    sortTitle: series.sortTitle,
    year: series.year,
    monitored: series.monitored ?? false,
    totalChildren: episodes.length,
    files,
    analyzedAt
  });
}

export function analyzeRadarrMovies(movies: RadarrMovie[], analyzedAt = new Date()): RadarrAnalysisResult {
  const items = movies.map((movie) => analyzeRadarrMovie(movie, analyzedAt));
  const itemsWithFile = items.filter((item) => item.hasFile).length;
  const funItems = items.filter((item) => item.funChildren > 0).length;
  const totalSizeBytes = sum(items.map((item) => item.totalSizeBytes));
  const funSizeBytes = sum(items.map((item) => item.funSizeBytes));

  return {
    items,
    summary: {
      totalItems: items.length,
      itemsWithFile,
      funItems,
      nonFunItems: itemsWithFile - funItems,
      totalSizeBytes,
      funSizeBytes,
      funShare: itemsWithFile === 0 ? 0 : funItems / itemsWithFile
    }
  };
}

function analyzeRadarrMovie(movie: RadarrMovie, analyzedAt: Date): MediaItemAnalysis {
  const files: AnalysisFile[] = movie.movieFile
    ? [
        {
          arrFileId: movie.movieFile.id,
          childArrId: movie.id,
          path: movie.movieFile.path,
          relativePath: movie.movieFile.relativePath,
          releaseGroup: movie.movieFile.releaseGroup ?? null,
          isFun: isFunReleaseGroup(movie.movieFile.releaseGroup),
          qualityName: movie.movieFile.quality?.quality?.name,
          sizeBytes: movie.movieFile.size ?? 0
        }
      ]
    : [];

  return buildMediaItemAnalysis({
    kind: "movie",
    arrId: movie.id,
    title: movie.title,
    sortTitle: movie.sortTitle,
    year: movie.year,
    monitored: movie.monitored ?? false,
    totalChildren: 1,
    files,
    analyzedAt
  });
}

function buildMediaItemAnalysis(input: {
  kind: "series" | "movie";
  arrId: number;
  title: string;
  titleSlug?: string;
  sortTitle?: string;
  year?: number;
  monitored: boolean;
  totalChildren: number;
  files: AnalysisFile[];
  analyzedAt: Date;
}): MediaItemAnalysis {
  const childrenWithFile = input.files.length;
  const funChildren = input.files.filter((file) => file.isFun).length;
  const totalSizeBytes = sum(input.files.map((file) => file.sizeBytes));
  const funSizeBytes = sum(input.files.filter((file) => file.isFun).map((file) => file.sizeBytes));

  return {
    kind: input.kind,
    arrId: input.arrId,
    title: input.title,
    titleSlug: input.titleSlug,
    sortTitle: input.sortTitle,
    year: input.year,
    monitored: input.monitored,
    hasFile: childrenWithFile > 0,
    totalChildren: input.totalChildren,
    childrenWithFile,
    funChildren,
    nonFunChildren: childrenWithFile - funChildren,
    totalSizeBytes,
    funSizeBytes,
    funShare: childrenWithFile === 0 ? 0 : funChildren / childrenWithFile,
    lastAnalyzedAt: input.analyzedAt.toISOString(),
    files: input.files
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
