import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SonarrSeriesView } from "../../src/renderer/views/SonarrSeriesView";
import { RadarrMoviesView } from "../../src/renderer/views/RadarrMoviesView";
import type { RadarrMovieTableRow, SonarrSeriesTableRow } from "../../src/shared/ipc-contracts";

afterEach(() => { cleanup(); localStorage.clear(); });

const series: SonarrSeriesTableRow = {
  id: "series-2293", arrId: 2293, title: "Alias Grace", monitored: true,
  episodes: 6, files: 6, totalSizeBytes: 12835247893, funFiles: 1,
  funShare: 1 / 6, nonFunFiles: 5, pendingFunCandidates: 0, isExcluded: false,
  hasFiles: true, lastAnalyzed: "-", lastSearched: "-", lastGrabbed: "-",
  status: "searchable", qualityProfileName: "German Bluray & Web & FuN",
};
const movie: RadarrMovieTableRow = {
  ...series, id: "movie-1", arrId: 1, title: "Example Movie", year: 2020,
  sizeBytes: 12835247893, releaseGroup: "Other", isFun: false,
};

describe.each(["sonarr", "radarr"] as const)("%s persisted filter controls", (kind) => {
  it("shows the restored profile even when no current item uses it, and clears it directly", () => {
    localStorage.setItem(`arr-ops.table.${kind}`, JSON.stringify({
      columnFilters: [{ id: "qualityProfileName", value: "FuN only" }],
      globalFilter: "", sorting: [], rowSelection: {},
    }));
    const { unmount } = render(kind === "sonarr"
      ? <SonarrSeriesView rows={[series]} />
      : <RadarrMoviesView rows={[movie]} />);
    const profile = screen.getByRole("combobox", { name: "Quality profile" });
    expect(profile).toHaveValue("FuN only");
    expect(screen.queryByText(kind === "sonarr" ? series.title : movie.title)).not.toBeInTheDocument();

    fireEvent.change(profile, { target: { value: "" } });
    expect(profile).toHaveValue("");
    expect(screen.getByText(kind === "sonarr" ? series.title : movie.title)).toBeInTheDocument();
    unmount();

    render(kind === "sonarr" ? <SonarrSeriesView rows={[series]} /> : <RadarrMoviesView rows={[movie]} />);
    expect(screen.getByRole("combobox", { name: "Quality profile" })).toHaveValue("");
    expect(screen.getByText(kind === "sonarr" ? series.title : movie.title)).toBeInTheDocument();
  });

  it("restores dropdown values and keeps them synchronized with filter chips", () => {
    localStorage.setItem(`arr-ops.table.${kind}`, JSON.stringify({
      columnFilters: [
        { id: kind === "sonarr" ? "funFiles" : "nonFunFiles", value: "positive" },
        { id: "monitored", value: true },
      ], globalFilter: "", sorting: [], rowSelection: {},
    }));
    render(kind === "sonarr" ? <SonarrSeriesView rows={[series]} /> : <RadarrMoviesView rows={[movie]} />);
    expect(screen.getByRole("combobox", { name: "FuN state" })).toHaveValue(kind === "sonarr" ? "hasFun" : "notFun");
    expect(screen.getByRole("combobox", { name: "Flags" })).toHaveValue("monitored");
    fireEvent.click(screen.getByRole("button", { name: "Monitored", pressed: true }));
    expect(screen.getByRole("combobox", { name: "Flags" })).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Searchable", pressed: false }));
    expect(screen.getByRole("combobox", { name: "Flags" })).toHaveValue("searchableNow");
  });
});
