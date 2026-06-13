import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../../src/main/arr/arr-types";
import { RadarrClient } from "../../src/main/arr/radarr-client";
import { SonarrClient } from "../../src/main/arr/sonarr-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("ARR API clients", () => {
  it("normalizes Sonarr URLs and sends the API key header", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ version: "4.0.17.2952" }));
    const client = new SonarrClient({
      baseUrl: "http://sonarr.local:8989/",
      apiKey: "sonarr-key",
      fetchImpl
    });

    await client.getStatus();

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://sonarr.local:8989/api/v3/system/status",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Api-Key": "sonarr-key"
        }),
        method: "GET"
      })
    );
  });

  it("builds Sonarr episode, release, grab, and command requests", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse([{ id: 1 }]));
    const client = new SonarrClient({
      baseUrl: "http://sonarr.local:8989",
      apiKey: "sonarr-key",
      fetchImpl
    });

    await client.getSeries();
    await client.getEpisodes(42, true);
    await client.getReleasesForEpisode(1001);
    await client.grabRelease({ guid: "release-guid", title: "FuN release" });
    await client.runEpisodeSearch([1001, 1002]);

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "http://sonarr.local:8989/api/v3/series",
      "http://sonarr.local:8989/api/v3/episode?seriesId=42&includeEpisodeFile=true",
      "http://sonarr.local:8989/api/v3/release?episodeId=1001",
      "http://sonarr.local:8989/api/v3/release",
      "http://sonarr.local:8989/api/v3/command"
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[3][1]?.body as string)).toEqual({
      guid: "release-guid",
      title: "FuN release"
    });
    expect(JSON.parse(fetchImpl.mock.calls[4][1]?.body as string)).toEqual({
      name: "EpisodeSearch",
      episodeIds: [1001, 1002]
    });
  });

  it("builds Radarr movie, release, grab, and command requests", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse([{ id: 1 }]));
    const client = new RadarrClient({
      baseUrl: "http://radarr.local:7878/",
      apiKey: "radarr-key",
      fetchImpl
    });

    await client.getStatus();
    await client.getMovies();
    await client.getReleasesForMovie(8222);
    await client.grabRelease({ guid: "movie-release", title: "FuN movie" });
    await client.runMoviesSearch([8222, 9000]);

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "http://radarr.local:7878/api/v3/system/status",
      "http://radarr.local:7878/api/v3/movie",
      "http://radarr.local:7878/api/v3/release?movieId=8222",
      "http://radarr.local:7878/api/v3/release",
      "http://radarr.local:7878/api/v3/command"
    ]);
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual(
      expect.objectContaining({ "X-Api-Key": "radarr-key" })
    );
    expect(JSON.parse(fetchImpl.mock.calls[4][1]?.body as string)).toEqual({
      name: "MoviesSearch",
      movieIds: [8222, 9000]
    });
  });

  it("throws a useful error for non-successful ARR responses", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ message: "Unauthorized" }, 401));
    const client = new SonarrClient({
      baseUrl: "http://sonarr.local:8989",
      apiKey: "bad-key",
      fetchImpl
    });

    await expect(client.getStatus()).rejects.toThrow("ARR request failed: GET /system/status returned 401");
  });
});
