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

  it("creates automation tables", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);

    const rows = db
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all() as Array<{ name: string }>;

    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "automation_events",
        "automation_goals",
        "automation_runs",
        "automation_work_items",
      ]),
    );
  });

  it("allows automation jobs", () => {
    const db = createInMemoryDatabase();
    migrateDatabase(db);

    expect(() =>
      db
        .prepare(
          `insert into jobs (
        id, name, kind, target_scope, status, progress_current, progress_total,
        success_count, failure_count, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("job-automation", "Automation", "automation", "all", "queued", 0, 0, 0, 0, "2026-06-18T00:00:00.000Z"),
    ).not.toThrow();
  });

  it("migrates existing jobs tables to allow automation jobs", () => {
    const db = createInMemoryDatabase();

    db.prepare(
      `create table jobs (
        id text primary key,
        name text not null,
        kind text not null check (kind in ('analysis', 'search', 'grab', 'combined')),
        target_scope text not null check (target_scope in ('all', 'sonarr', 'radarr', 'selected')),
        status text not null check (status in ('queued', 'running', 'blocked_by_budget', 'completed', 'failed', 'cancelled')),
        progress_current integer not null default 0,
        progress_total integer not null default 0,
        success_count integer not null default 0,
        failure_count integer not null default 0,
        created_at text not null,
        started_at text,
        finished_at text
      )`,
    ).run();

    db.prepare(
      `insert into jobs (
        id, name, kind, target_scope, status, progress_current, progress_total,
        success_count, failure_count, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("job-combined", "Combined", "combined", "all", "completed", 10, 10, 9, 1, "2026-06-17T00:00:00.000Z");

    migrateDatabase(db);

    expect(db.prepare("select kind, status, success_count, failure_count from jobs where id = ?").get("job-combined")).toEqual({
      kind: "combined",
      status: "completed",
      success_count: 9,
      failure_count: 1,
    });
    expect(() =>
      db
        .prepare(
          `insert into jobs (
            id, name, kind, target_scope, status, progress_current, progress_total,
            success_count, failure_count, created_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("job-automation", "Automation", "automation", "all", "queued", 0, 0, 0, 0, "2026-06-18T00:00:00.000Z"),
    ).not.toThrow();
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
