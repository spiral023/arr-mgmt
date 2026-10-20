import { describe, expect, it, vi, beforeEach } from "vitest";

const radarrApi = vi.hoisted(() => ({
  getMovies: vi.fn(),
  runMoviesSearch: vi.fn(),
  getReleasesForMovie: vi.fn(),
  grabRelease: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
  safeStorage: { encryptString: vi.fn(), decryptString: vi.fn() },
  app: { getPath: vi.fn(() => ""), whenReady: vi.fn() },
}));

vi.mock("../main/arr/radarr-client", () => ({
  RadarrClient: vi.fn(function () { return radarrApi; }),
}));

import type { IpcState } from "../main/ipc";
import { parseCliArgs } from "./args";
import { runCommand } from "./commands";

function makeState(): IpcState {
  return {
    instanceStore: {
      getWithApiKey: () => ({ kind: "radarr", name: "Radarr", baseUrl: "http://radarr.local:7878", apiKey: "key", enabled: true }),
    },
  } as unknown as IpcState;
}

describe("missing Radarr command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    radarrApi.getMovies.mockResolvedValue([
      { id: 9050, tmdbId: 14292, titleSlug: "14292", title: "Miracle - Das Wunder von Lake Placid", year: 2004, hasFile: false },
    ]);
    radarrApi.runMoviesSearch.mockResolvedValue({ id: 77, name: "MoviesSearch", status: "queued" });
    radarrApi.getReleasesForMovie.mockResolvedValue([
      { guid: "bad", title: "Miracle.bad", rejected: true, downloadAllowed: true, approved: true },
      { guid: "good", title: "Miracle.2004.1080p", rejected: false, downloadAllowed: true, approved: true, indexer: "idx" },
    ]);
    radarrApi.grabRelease.mockResolvedValue({ ok: true });
  });

  it("maps URL/TMDb IDs to Radarr IDs before running a missing movie search", async () => {
    const result = await runCommand(makeState(), parseCliArgs(["missing", "radarr", "--ids", "14292"]));

    expect(result.ok).toBe(true);
    expect(radarrApi.runMoviesSearch).toHaveBeenCalledWith([9050]);
    if (result.ok) {
      expect(result.data).toMatchObject({
        requested: 1,
        resolved: 1,
        searched: 1,
        grabbed: 0,
        failed: 0,
        items: [
          {
            requestedId: 14292,
            radarrId: 9050,
            title: "Miracle - Das Wunder von Lake Placid",
            searched: true,
            grabbed: false,
            commandId: 77,
          },
        ],
      });
    }
  });

  it("grabs the first approved and downloadable release without FuN filtering", async () => {
    const result = await runCommand(makeState(), parseCliArgs(["missing", "radarr", "--ids", "14292", "--grab"]));

    expect(result.ok).toBe(true);
    expect(radarrApi.runMoviesSearch).not.toHaveBeenCalled();
    expect(radarrApi.getReleasesForMovie).toHaveBeenCalledWith(9050);
    expect(radarrApi.grabRelease).toHaveBeenCalledWith(
      expect.objectContaining({ guid: "good", title: "Miracle.2004.1080p" }),
    );
    if (result.ok) {
      expect(result.data).toMatchObject({
        requested: 1,
        resolved: 1,
        searched: 1,
        grabbed: 1,
        failed: 0,
        items: [{ requestedId: 14292, radarrId: 9050, grabbed: true, releaseTitle: "Miracle.2004.1080p" }],
      });
    }
  });
});
