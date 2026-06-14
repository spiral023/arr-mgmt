import type { SonarrSeries } from "./arr-types";

export function selectSonarrSeriesForAnalysis(
  seriesList: SonarrSeries[],
  analyzedArrIds: ReadonlySet<number>,
): SonarrSeries[] {
  const missingSeries = seriesList.filter((series) => !analyzedArrIds.has(series.id));
  return missingSeries.length > 0 ? missingSeries : seriesList;
}
