import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSonarrSeries } from "../../src/main/arr/analysis-service";
import { RadarrClient } from "../../src/main/arr/radarr-client";
import { SonarrClient } from "../../src/main/arr/sonarr-client";

loadDotEnv();

const sonarrUrl = requiredEnv("SONARR_URL");
const sonarrApiKey = requiredEnv("SONARR_API_KEY");
const radarrUrl = requiredEnv("RADARR_URL");
const radarrApiKey = requiredEnv("RADARR_API_KEY");

describe("live ARR integrations", () => {
  it("connects to Sonarr and analyzes Criminal Record", async () => {
    const client = new SonarrClient({ baseUrl: sonarrUrl, apiKey: sonarrApiKey });
    const status = await client.getStatus();
    expect(status.appName).toBe("Sonarr");

    const series = await client.getSeries();
    const criminalRecord = series.find((item) => item.titleSlug === "criminal-record" || item.title === "Criminal Record");
    expect(criminalRecord).toBeTruthy();

    const episodes = await client.getEpisodes(criminalRecord!.id, true);
    const analysis = analyzeSonarrSeries(criminalRecord!, episodes);

    expect(analysis.totalChildren).toBeGreaterThan(0);
    expect(analysis.childrenWithFile).toBeGreaterThan(0);
    expect(analysis.funChildren).toBeGreaterThan(0);
    expect(analysis.funShare).toBeGreaterThan(0);
  }, 60_000);

  it("connects to Radarr and finds tmdbId 11397", async () => {
    const client = new RadarrClient({ baseUrl: radarrUrl, apiKey: radarrApiKey });
    const status = await client.getStatus();
    expect(status.appName).toBe("Radarr");

    const movies = await client.getMovies();
    const movie = movies.find((item) => item.tmdbId === 11397 || item.titleSlug === "11397");

    expect(movie).toBeTruthy();
    expect(movie?.id).toBeGreaterThan(0);
    expect(movie?.title).toBeTruthy();
  }, 60_000);
});

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    process.env[key] ??= value;
  }
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} must be set in .env for live ARR tests`);
  }
  return value;
}
