import { describe, expect, it } from "vitest";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";
import { getAppSettings, updateAppSettings } from "../../src/main/settings/app-settings";

describe("app settings", () => {
  it("returns quota and cooldown defaults when no settings are saved", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    expect(getAppSettings(repos)).toEqual({
      automation: { quotaSafetyPercent: 90 },
      cooldownHours: { movieSearch: 24, episodeSearch: 24 },
      fun: { displayName: "FuN*", prefixes: ["fun"] },
      notifications: {
        jobFinished: true,
        quotaExhausted: true,
        candidatesFound: true,
      },
      quota: { searchLimit: 10000, grabLimit: 400, windowHours: 24 },
      tray: { keepRunningOnClose: true, openAtLogin: false, showControls: true },
    });
  });

  it("normalizes and persists partial settings updates", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    const updated = updateAppSettings(repos, {
      fun: { prefixes: [" FuN ", "", "funhd"] },
      quota: { searchLimit: 25, grabLimit: -1 },
      tray: { openAtLogin: true },
    });

    expect(updated.fun.prefixes).toEqual(["fun", "funhd"]);
    expect(updated.quota).toEqual({ searchLimit: 25, grabLimit: 400, windowHours: 24 });
    expect(updated.tray).toEqual({ keepRunningOnClose: true, openAtLogin: true, showControls: true });
    expect(getAppSettings(repos)).toEqual(updated);
  });

  it("normalizes automation quota safety percent", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    expect(getAppSettings(repos).automation.quotaSafetyPercent).toBe(90);

    updateAppSettings(repos, { automation: { quotaSafetyPercent: 80 } });
    expect(getAppSettings(repos).automation.quotaSafetyPercent).toBe(80);

    updateAppSettings(repos, { automation: { quotaSafetyPercent: 0 } });
    expect(getAppSettings(repos).automation.quotaSafetyPercent).toBe(90);
  });
});
