import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RadarrMoviesView } from "../../src/renderer/views/RadarrMoviesView";
import type { RadarrMovieTableRow } from "../../src/shared/ipc-contracts";

describe("RadarrMoviesView", () => {
  it("shows pending FuN files in the selected bulk state and runs Radarr actions", () => {
    const onSearch = vi.fn();
    const onGrab = vi.fn();

    render(
      <RadarrMoviesView
        onGrab={onGrab}
        onSearch={onSearch}
        rows={[
          row({ arrId: 201, pendingFunCandidates: 2, title: "Example Movie" }),
          row({ arrId: 202, pendingFunCandidates: 0, title: "Complete Movie" }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Example Movie" }));

    expect(screen.getByText("1 selected · 2 pending FuN* files")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Search selected Radarr movies" }));
    fireEvent.click(screen.getByRole("button", { name: "Grab selected pending Radarr FuN releases" }));

    expect(onSearch).toHaveBeenCalledWith([201]);
    expect(onGrab).toHaveBeenCalledWith([201]);
  });
});

function row(overrides: Partial<RadarrMovieTableRow>): RadarrMovieTableRow {
  return {
    arrId: 201,
    files: 1,
    funFiles: 0,
    funShare: 0,
    hasFiles: true,
    id: `movie-${overrides.arrId ?? 201}`,
    isFun: false,
    lastAnalyzed: "-",
    lastGrabbed: "-",
    lastSearched: "-",
    monitored: true,
    nonFunFiles: 1,
    pendingFunCandidates: 0,
    isExcluded: false,
    releaseGroup: "WvF",
    sizeBytes: 1_000,
    status: "searchable",
    title: "Example Movie",
    year: 2024,
    ...overrides,
  };
}
