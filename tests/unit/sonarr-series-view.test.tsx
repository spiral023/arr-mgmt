import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SonarrSeriesView } from "../../src/renderer/views/SonarrSeriesView";
import type { MediaItemDetails, SonarrSeriesTableRow } from "../../src/shared/ipc-contracts";

describe("SonarrSeriesView", () => {
  it("opens Sonarr with the row title slug", () => {
    const onOpenInSonarr = vi.fn();

    render(<SonarrSeriesView onOpenInSonarr={onOpenInSonarr} rows={[row({ arrId: 1203, title: "Wednesday", titleSlug: "wednesday" })]} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Wednesday in Sonarr" }));

    expect(onOpenInSonarr).toHaveBeenCalledWith(1203, "wednesday");
  });

  it("hides complete FuN share rows with a quick filter", () => {
    render(
      <SonarrSeriesView
        rows={[
          row({ arrId: 1, title: "Complete", funShare: 1, nonFunFiles: 0, status: "ready" }),
          row({ arrId: 2, title: "Needs Work", funShare: 0.5, nonFunFiles: 1, status: "searchable" }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide 100% FuN*" }));

    const table = screen.getByRole("table");
    expect(within(table).queryByText("Complete")).not.toBeInTheDocument();
    expect(within(table).getByText("Needs Work")).toBeInTheDocument();
  });

  it("shows missing FuN episodes and found candidates in the details drawer", async () => {
    const onLoadDetails = vi.fn<(kind: "series" | "movie", arrId: number) => Promise<MediaItemDetails>>().mockResolvedValue({
      kind: "series",
      arrId: 1203,
      nonFunFiles: [
        { childArrId: 11, seasonNumber: 1, episodeNumber: 3, relativePath: "S01E03.mkv", releaseGroup: "GRP", quality: "WEBDL-1080p", sizeBytes: 2_000_000_000 },
      ],
      candidates: [
        { id: 5, childArrId: 11, title: "Wednesday.S01E03.FuN.WEBDL-1080p", releaseGroup: "FuN", quality: "WEBDL-1080p", indexer: "MyIndexer", sizeBytes: 2_100_000_000, approved: true, foundAt: "2026-06-14T10:00:00.000Z" },
      ],
    });

    render(<SonarrSeriesView onLoadDetails={onLoadDetails} rows={[row({ arrId: 1203, title: "Wednesday" })]} />);

    fireEvent.click(screen.getByRole("button", { name: "Open details for Wednesday" }));

    expect(onLoadDetails).toHaveBeenCalledWith("series", 1203);
    await waitFor(() => expect(screen.getByText("S01E03 · S01E03.mkv")).toBeInTheDocument());
    expect(screen.getByText("Wednesday.S01E03.FuN.WEBDL-1080p")).toBeInTheDocument();
    expect(screen.getByText("Fehlende FuN*-Folgen")).toBeInTheDocument();
    expect(screen.getByText("Beim Search gefunden")).toBeInTheDocument();
  });
});

function row(overrides: Partial<SonarrSeriesTableRow>): SonarrSeriesTableRow {
  return {
    arrId: 7,
    episodes: 2,
    files: 2,
    funFiles: 1,
    funShare: 0.5,
    hasFiles: true,
    id: `series-${overrides.arrId ?? 7}`,
    lastAnalyzed: "-",
    lastGrabbed: "-",
    lastSearched: "-",
    monitored: true,
    nonFunFiles: 1,
    pendingFunCandidates: 0,
    status: "searchable",
    title: "Example Series",
    titleSlug: "example-series",
    totalSizeBytes: 1_000,
    ...overrides,
  };
}
