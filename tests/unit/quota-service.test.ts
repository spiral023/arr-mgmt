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

    expect(service.reserve("search", { message: "sonarr" })).toMatchObject({ allowed: true, remaining: 1 });
    expect(service.reserve("search", { message: "radarr" })).toMatchObject({ allowed: true, remaining: 0 });
    expect(service.reserve("search", { message: "blocked" })).toEqual({ allowed: false, remaining: 0 });
  });

  it("updates a reservation instead of creating a second quota-consuming row", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const now = new Date("2026-06-13T20:00:00.000Z");
    const service = new QuotaService(repos, {
      searchLimit: 2,
      grabLimit: 1,
      windowHours: 24,
      now: () => now,
    });

    const reservation = service.reserve("search", { message: "Criminal Record S01E01" });
    expect(reservation).toMatchObject({ allowed: true, remaining: 1 });

    service.complete(reservation.activityId!, "success", "FuN* candidate found");

    expect(repos.activityLog.countSince("search", now, 24)).toBe(1);
    expect(repos.activityLog.listRecent(1)).toEqual([
      expect.objectContaining({
        action: "search",
        item: "FuN* candidate found",
        status: "success",
      }),
    ]);
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
