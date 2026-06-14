import { describe, expect, it } from "vitest";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";

describe("database schema", () => {
  it("creates the required application tables", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);

    const rows = db
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all() as Array<{ name: string }>;

    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "activity_log",
        "instances",
        "job_events",
        "jobs",
        "media_files",
        "media_items",
        "release_candidates",
        "schedules",
        "settings",
        "perf_samples",
      ]),
    );
  });

  it("queries quota activity within a rolling 24 hour window", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);
    const repos = createRepositories(db);
    const now = new Date("2026-06-13T20:00:00.000Z");

    repos.activityLog.insert({
      action: "search",
      quotaType: "search",
      status: "success",
      createdAt: new Date("2026-06-12T19:59:59.000Z"),
    });
    repos.activityLog.insert({
      action: "search",
      quotaType: "search",
      status: "success",
      createdAt: new Date("2026-06-12T20:00:00.000Z"),
    });
    repos.activityLog.insert({
      action: "grab",
      quotaType: "grab",
      status: "success",
      createdAt: new Date("2026-06-13T19:00:00.000Z"),
    });

    expect(repos.activityLog.countSince("search", now, 24)).toBe(1);
    expect(repos.activityLog.countSince("grab", now, 24)).toBe(1);
  });
});
