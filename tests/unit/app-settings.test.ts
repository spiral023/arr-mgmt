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
      cooldownHours: { movieSearch: 24, episodeSearch: 24 },
      fun: { displayName: "FuN*", prefixes: ["fun"] },
      notifications: {
        jobFinished: true,
        quotaExhausted: true,
        candidatesFound: true,
      },
      quota: { searchLimit: 2000, grabLimit: 400, windowHours: 24 },
      tray: { keepRunningOnClose: true, showControls: true },
    });
  });

  it("normalizes and persists partial settings updates", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);

    const updated = updateAppSettings(repos, {
      fun: { prefixes: [" FuN ", "", "funhd"] },
      quota: { searchLimit: 25, grabLimit: -1 },
    });

    expect(updated.fun.prefixes).toEqual(["fun", "funhd"]);
    expect(updated.quota).toEqual({ searchLimit: 25, grabLimit: 400, windowHours: 24 });
    expect(getAppSettings(repos)).toEqual(updated);
  });
});
