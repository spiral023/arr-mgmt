import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaDetailLists } from "../../src/renderer/components/MediaDetailLists";
import { WantedList } from "../../src/renderer/components/WantedList";
import type { MediaItemDetails } from "../../src/shared/ipc-contracts";

afterEach(() => { cleanup(); Reflect.deleteProperty(window, "arrOps"); });
function bridge(invoke: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, "arrOps", { configurable: true, value: { invoke } });
}
const details: MediaItemDetails = {
  kind: "movie", arrId: 1, nonFunFiles: [], candidates: [],
  files: [{ childArrId: 1, seasonNumber: null, episodeNumber: null, relativePath: "Example.mkv", releaseGroup: "Other", quality: "1080p", sizeBytes: 100 }],
  transfers: [{ id: 1, instanceId: 1, mediaItemId: 1, childArrId: 1, title: "Example-FuN", downloadId: null,
    grabbedAt: "2026-10-20T10:00:00Z", checkedAt: null, status: "grabbed", message: null }],
};

describe("library detail feedback", () => {
  it("shows unknown bitrate and updates the import state after a read-only refresh", async () => {
    const invoke = vi.fn().mockResolvedValue({ ...details, transfers: [{ ...details.transfers![0], status: "imported" }] });
    bridge(invoke);
    render(<MediaDetailLists details={details} kind="movie" loading={false} />);
    expect(screen.getByText(/Bitrate unbekannt/)).toBeInTheDocument();
    expect(screen.getByText(/An ARR übergeben/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Status prüfen" }));
    await waitFor(() => expect(screen.getByText(/Import bestätigt/)).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("library:refreshTransfers", { kind: "movie", arrId: 1 });
  });
  it("retains the previous transfer state when the connection fails", async () => {
    bridge(vi.fn().mockRejectedValue(new Error("offline")));
    render(<MediaDetailLists details={details} kind="movie" loading={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Status prüfen" }));
    await screen.findByRole("alert");
    expect(screen.getByText(/An ARR übergeben/)).toBeInTheDocument();
    expect(screen.queryByText(/Import bestätigt/)).not.toBeInTheDocument();
  });
});

describe("wanted worklists", () => {
  it("keeps the most recent mode when requests resolve in reverse order", async () => {
    let finishMissing!: (value: unknown) => void;
    const missing = new Promise((resolve) => { finishMissing = resolve; });
    const invoke = vi.fn((_channel, payload) => payload.mode === "missing" ? missing : Promise.resolve({ totalRecords: 1, records: [{ id: 2, title: "Below cutoff" }] }));
    bridge(invoke);
    const { container } = render(<WantedList kind="radarr" />);
    const disclosure = container.querySelector("details")!;
    fireEvent(disclosure, new Event("toggle"));
    fireEvent.click(screen.getByRole("button", { name: "Verfügbar, Datei fehlt" }));
    fireEvent.click(screen.getByRole("button", { name: "Unter Qualitätsziel" }));
    await screen.findByText("Below cutoff");
    await act(async () => finishMissing({ totalRecords: 1, records: [{ id: 1, title: "Old missing result" }] }));
    expect(screen.queryByText("Old missing result")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unter Qualitätsziel" })).toHaveAttribute("aria-pressed", "true");
  });
  it("reports an unavailable server instead of an empty worklist", async () => {
    bridge(vi.fn().mockRejectedValue(new Error("offline")));
    render(<WantedList kind="sonarr" />);
    fireEvent.click(screen.getByRole("button", { name: "Unter Qualitätsziel" }));
    await screen.findByRole("alert");
    expect(screen.queryByText(/0 Einträge/)).not.toBeInTheDocument();
  });
});
