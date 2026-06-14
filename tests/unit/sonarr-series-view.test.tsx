import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SonarrSeriesView } from "../../src/renderer/views/SonarrSeriesView";
import type { SonarrSeriesTableRow } from "../../src/shared/ipc-contracts";

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
