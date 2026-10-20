import { describe, expect, it } from "vitest";
import { selectAnalysisItems } from "../../src/main/arr/analysis-plan";
import type { SonarrSeries } from "../../src/main/arr/arr-types";

describe("incremental Sonarr analysis", () => {
  it("continues a partial scan by analyzing only missing series", () => {
    const series = makeSeries([1, 2, 3, 4]);

    const now = new Date();
    expect(selectAnalysisItems(series, [1, 3].map((arrId) => ({ arrId, lastAnalyzedAt: now.toISOString() })), new Set(), now).map((item) => item.id)).toEqual([2, 4]);
  });

  it("refreshes every series during a forced full reconciliation", () => {
    const series = makeSeries([1, 2]);

    const now = new Date();
    expect(selectAnalysisItems(series, [1, 2].map((arrId) => ({ arrId, lastAnalyzedAt: now.toISOString() })), new Set(), now, true).map((item) => item.id)).toEqual([1, 2]);
  });
});

function makeSeries(ids: number[]): SonarrSeries[] {
  return ids.map((id) => ({ id, title: `Series ${id}` }));
}
