import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeRadarr,
  grabRadarrMovies,
  searchRadarrMovies,
} from "../../src/renderer/state/ipc-client";

describe("ipc-client Radarr actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "arrOps");
  });

  it("targets Radarr channels instead of Sonarr channels", async () => {
    const invoke = vi.fn(async () => ({ ok: true })) as unknown as Window["arrOps"]["invoke"] & {
      mock: { calls: Array<[string, unknown?]> };
    };
    window.arrOps = {
      invoke,
      onJobEvent: () => () => undefined,
    };

    await analyzeRadarr([201]);
    await searchRadarrMovies([201]);
    await grabRadarrMovies([201]);

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "jobs:enqueue",
      "radarr:search",
      "radarr:grab",
    ]);
    expect(invoke.mock.calls[0][1]).toEqual({
      movieIds: [201],
      name: "Analyze selected Radarr movies",
      target: "radarr",
    });
  });
});
