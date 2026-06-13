import { describe, expect, it } from "vitest";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";
import { QuotaService } from "../../src/main/scheduler/quota-service";

describe("QuotaService", () => {
  it("uses one shared search budget across Sonarr and Radarr", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const service = new QuotaService(repos, {
      searchLimit: 2,
      grabLimit: 1,
      windowHours: 24,
      now: () => new Date("2026-06-13T20:00:00.000Z"),
    });

    expect(service.reserve("search", { message: "sonarr" })).toEqual({ allowed: true, remaining: 1 });
    expect(service.reserve("search", { message: "radarr" })).toEqual({ allowed: true, remaining: 0 });
    expect(service.reserve("search", { message: "blocked" })).toEqual({ allowed: false, remaining: 0 });
  });

  it("allows manual grab entries to consume grab budget", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const service = new QuotaService(repos, {
      searchLimit: 10,
      grabLimit: 2,
      windowHours: 24,
      now: () => new Date("2026-06-13T20:00:00.000Z"),
    });

    service.recordManualGrab(2, "external import");

    expect(service.reserve("grab", { message: "grab" })).toEqual({ allowed: false, remaining: 0 });
  });
});
