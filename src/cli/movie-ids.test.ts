import { describe, expect, it } from "vitest";
import { resolveMovieIdentity } from "./movie-ids";
import { parseCliArgs } from "./args";

describe("explicit movie identity", () => {
  const movies = [{ id: 10, tmdbId: 20, title: "First" }, { id: 20, tmdbId: 30, title: "Second" }];
  it("rejects collisions instead of preferring an unrelated internal ID", () => {
    expect(() => resolveMovieIdentity(movies, 20)).toThrow("Mehrdeutige ID");
    expect(resolveMovieIdentity(movies, 20, "arr")?.title).toBe("Second");
    expect(resolveMovieIdentity(movies, 20, "tmdb")?.title).toBe("First");
  });
  it("rejects invalid inputs instead of silently shortening an action's ID list", () => {
    expect(() => parseCliArgs(["grab", "radarr", "--ids", "10,nope,20"])).toThrow("ungültige ID");
    expect(() => parseCliArgs(["wanted", "sonarr", "missing", "--limit", "-1"])).toThrow();
    expect(parseCliArgs(["missing", "radarr", "--ids", "20", "--id-type", "tmdb"]).idType).toBe("tmdb");
  });
});
