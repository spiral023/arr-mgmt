import { describe, expect, it, vi } from "vitest";
import { ArrRateLimiter } from "../../src/main/arr/arr-api-client";
import type { FetchLike } from "../../src/main/arr/arr-types";
import { RadarrClient } from "../../src/main/arr/radarr-client";
import { SonarrClient } from "../../src/main/arr/sonarr-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function testRateLimiter(): ArrRateLimiter {
  return new ArrRateLimiter({ maxRequests: 100, windowMs: 1000 });
}

describe("ARR API clients", () => {
  it("separates metadata reads from the unchanged five-per-second release limit", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse([]));
      const client = new RadarrClient({ baseUrl: `http://${crypto.randomUUID()}.test`, apiKey: "test", fetchImpl });
      const pending = Promise.all([
        ...Array.from({ length: 9 }, () => client.getMovies()),
        ...Array.from({ length: 6 }, () => client.getReleasesForMovie(1)),
      ]);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl).toHaveBeenCalledTimes(13);
      expect(fetchImpl.mock.calls.filter(([url]) => url.includes("/release"))).toHaveLength(5);
      await vi.advanceTimersByTimeAsync(1000);
      await pending;
      expect(fetchImpl).toHaveBeenCalledTimes(15);
    } finally { vi.useRealTimers(); }
  });
  it("limits ARR API request starts to five per second across clients", async () => {
    vi.useFakeTimers();
    try {
      const starts: number[] = [];
      const fetchImpl = vi.fn<FetchLike>(async () => {
        starts.push(Date.now());
        return jsonResponse([]);
      });
      const rateLimiter = new ArrRateLimiter({ maxRequests: 5, windowMs: 1000 });
      const sonarr = new SonarrClient({
        baseUrl: "http://sonarr.local:8989",
        apiKey: "sonarr-key",
        fetchImpl,
        rateLimiter
      });
      const radarr = new RadarrClient({
        baseUrl: "http://radarr.local:7878",
        apiKey: "radarr-key",
        fetchImpl,
        rateLimiter
      });

      const requests = [
        sonarr.getStatus(),
        sonarr.getSeries(),
        sonarr.getQualityProfiles(),
        radarr.getStatus(),
        radarr.getMovies(),
        radarr.getQualityProfiles()
      ];

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl).toHaveBeenCalledTimes(5);

      await vi.advanceTimersByTimeAsync(999);
      expect(fetchImpl).toHaveBeenCalledTimes(5);

      await vi.advanceTimersByTimeAsync(1);
      await Promise.all(requests);

      expect(fetchImpl).toHaveBeenCalledTimes(6);
      expect(starts[5] - starts[0]).toBeGreaterThanOrEqual(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("normalizes Sonarr URLs and sends the API key header", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ version: "4.0.17.2952" }));
    const client = new SonarrClient({
      baseUrl: "http://sonarr.local:8989/",
      apiKey: "sonarr-key",
      fetchImpl,
      rateLimiter: testRateLimiter()
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
      fetchImpl,
      rateLimiter: testRateLimiter()
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
      fetchImpl,
      rateLimiter: testRateLimiter()
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
      fetchImpl,
      rateLimiter: testRateLimiter()
    });

    await expect(client.getStatus()).rejects.toThrow("ARR request failed: GET /system/status returned 401");
  });
});
