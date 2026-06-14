import { describe, expect, it } from "vitest";
import { selectSonarrSeriesForAnalysis } from "../../src/main/arr/sonarr-analysis-plan";
import type { SonarrSeries } from "../../src/main/arr/arr-types";

describe("selectSonarrSeriesForAnalysis", () => {
  it("continues a partial scan by analyzing only missing series", () => {
    const series = makeSeries([1, 2, 3, 4]);

    expect(selectSonarrSeriesForAnalysis(series, new Set([1, 3])).map((item) => item.id)).toEqual([2, 4]);
  });

  it("reanalyzes all series when no partial scan is left to resume", () => {
    const series = makeSeries([1, 2]);

    expect(selectSonarrSeriesForAnalysis(series, new Set([1, 2])).map((item) => item.id)).toEqual([1, 2]);
  });
});

function makeSeries(ids: number[]): SonarrSeries[] {
  return ids.map((id) => ({ id, title: `Series ${id}` }));
}
