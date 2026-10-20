import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppDatabase, createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";
import { analyzeSonarrSeries } from "../../src/main/arr/analysis-service";
import { JobRunner } from "../../src/main/scheduler/job-runner";
import { reconcileRows } from "../../src/renderer/state/reconcile-rows";
import { invokeIpc } from "../../src/renderer/state/ipc-client";
import { formatDateTime } from "../../src/shared/date-time";

afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(window, "arrOps"); });

describe("large library storage", () => {
  it("indexes file, cooldown and event lookups after migrating an existing database", () => {
    const db = createInMemoryDatabase(); migrateDatabase(db);
    const plan = (sql: string, ...args: unknown[]) => (db.prepare(`explain query plan ${sql}`).all(...args) as Array<{ detail: string }>).map((r) => r.detail).join("\n");
    expect(plan("delete from media_files where media_item_id=?", 1)).toMatch(/SEARCH media_files USING.*INDEX/);
    expect(plan("update media_files set media_info_json=? where media_item_id=? and child_arr_id=?", null, 1, 2)).toMatch(/idx_media_files_item_child/);
    expect(plan("select 1 from activity_log where instance_id=? and child_arr_id=? and action=? and created_at>=? limit 1", 1, 2, "search", "2026")).toMatch(/idx_activity_log_child_action_created/);
    expect(plan("select * from job_events where job_id=? order by created_at", "job")).toMatch(/idx_job_events_job_created/);
    db.exec("drop index idx_media_files_item_child"); migrateDatabase(db); migrateDatabase(db);
    expect(plan("select id from media_files where media_item_id=? and child_arr_id=?", 1, 2)).toMatch(/SEARCH.*idx_media_files_item_child/);
    db.close();
  });

  it("saves metadata directly and rolls back a failed replacement without losing files", () => {
    const db = createInMemoryDatabase(); migrateDatabase(db); const repos = createRepositories(db);
    const instance = repos.instances.upsert({ kind: "sonarr", name: "test", baseUrl: "http://test", apiKeyEncrypted: "test", enabled: true, now: new Date() });
    const item = analyzeSonarrSeries({ id: 1, title: "Large series", tvdbId: 123 }, Array.from({ length: 801 }, (_, i) => ({
      id: i + 1, seriesId: 1, episodeFile: { id: i + 1, size: 600_000_000, releaseGroup: "Other", mediaInfo: { runTime: "50:00", videoCodec: "x265" } },
    })));
    const spy = vi.spyOn(db, "prepare");
    repos.mediaItems.upsertAnalysis(instance, item);
    expect(spy.mock.calls.some(([sql]) => /^update media_files set media_info_json/i.test(sql))).toBe(false);
    const details = repos.mediaItems.itemDetails("series", 1);
    expect(details.files).toHaveLength(801);
    expect(details.files?.[800].mediaInfo).toMatchObject({ videoCodec: "x265", totalBitrateMbps: 1.6 });
    db.exec("create trigger fail_file before insert on media_files when new.child_arr_id=2 begin select raise(abort, 'test rollback'); end");
    expect(() => repos.mediaItems.upsertAnalysis(instance, { ...item, title: "Should roll back" })).toThrow("test rollback");
    expect(repos.mediaItems.itemDetails("series", 1)).toEqual(details);
    expect(repos.mediaItems.listSonarrRows()[0].title).toBe("Large series");
    spy.mockRestore(); db.close();
  });

  it("allows a companion reader during a write transaction and retains FULL durability", () => {
    const folder = mkdtempSync(join(tmpdir(), "arr-wal-test-"));
    const writer = createAppDatabase(join(folder, "test.sqlite")); migrateDatabase(writer);
    const reader = createAppDatabase(join(folder, "test.sqlite"));
    try {
      expect(writer.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(writer.pragma("synchronous", { simple: true })).toBe(2);
      writer.exec("begin immediate");
      writer.prepare("insert into settings(key,value_json) values(?,?)").run("pending", "true");
      expect(reader.prepare("select * from settings where key='pending'").get()).toBeUndefined();
      writer.exec("commit");
      expect(reader.prepare("select key from settings where key='pending'").get()).toEqual({ key: "pending" });
    } finally { if (writer.inTransaction) writer.exec("rollback"); reader.close(); writer.close(); rmSync(folder, { recursive: true }); }
  });
});

describe("job progress pressure", () => {
  it("coalesces 10,000 updates, persists live progress, and flushes cancellation immediately", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const upsert = vi.fn(); const onChange = vi.fn();
    const runner = new JobRunner({ show: vi.fn() }, { persistence: { upsert }, onChange });
    const job = runner.enqueue({ name: "Burst", kind: "analysis", progressTotal: 10001, run: async (ctx) => {
      for (let i = 0; i < 10000; i++) ctx.incrementProgress();
      await new Promise<void>((resolve) => { finish = resolve; });
    } });
    await Promise.resolve();
    expect(runner.listJobs()[0].progressCurrent).toBe(10000);
    expect(upsert.mock.calls.length).toBeLessThan(6);
    await vi.advanceTimersByTimeAsync(250);
    expect(onChange.mock.calls.at(-1)?.[0].job.progressCurrent).toBe(10000);
    runner.cancel(job.id); finish(); await runner.waitFor(job.id);
    await vi.advanceTimersByTimeAsync(1000);
    expect(upsert.mock.calls.at(-1)?.[0]).toMatchObject({ status: "cancelled", progressCurrent: 10000 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("loads a complete older log instead of only the last 200 startup events", async () => {
    const db = createInMemoryDatabase(); migrateDatabase(db); const repos = createRepositories(db);
    const runner = new JobRunner({ show: vi.fn() }, { persistence: repos.jobs });
    const job = runner.enqueue({ name: "Logs", kind: "analysis", run: async (ctx) => { for (let i = 0; i < 300; i++) ctx.addEvent("info", `Event ${i}`); } });
    await runner.waitFor(job.id);
    const reloaded = new JobRunner({ show: vi.fn() }, { persistence: repos.jobs });
    expect(reloaded.listEvents(job.id)).toHaveLength(302);
    db.close();
  });
});

describe("renderer refresh cost", () => {
  it("shares simultaneous read calls but never caches actions or stale results", async () => {
    let resolve!: (value: unknown) => void;
    const invoke = vi.fn(() => new Promise((done) => { resolve = done; }));
    Object.defineProperty(window, "arrOps", { configurable: true, value: { invoke } });
    const a = invokeIpc("library:summary"); const b = invokeIpc("library:summary");
    expect(invoke).toHaveBeenCalledTimes(1); resolve({ count: 1 });
    expect(await a).toEqual(await b);
    invoke.mockResolvedValue({ count: 2 });
    expect(await invokeIpc("library:summary")).toEqual({ count: 2 });
    await Promise.all([invokeIpc("sonarr:search", { seriesIds: [1] }), invokeIpc("sonarr:search", { seriesIds: [1] })]);
    expect(invoke).toHaveBeenCalledTimes(4);
    invoke.mockRejectedValueOnce(new Error("offline"));
    await expect(invokeIpc("library:summary")).rejects.toThrow("offline");
    expect(await invokeIpc("library:summary")).toEqual({ count: 2 });
  });

  it("retains unchanged table identities and updates changed, deleted and reordered rows", () => {
    const before = [{ id: "1", count: 1 }, { id: "2", count: 2 }];
    expect(reconcileRows(before, before.map((r) => ({ ...r })))).toBe(before);
    const changed = reconcileRows(before, [{ id: "1", count: 1 }, { id: "2", count: 3 }]);
    expect(changed[0]).toBe(before[0]); expect(changed[1].count).toBe(3);
    expect(reconcileRows(before, [before[1], before[0]])).toEqual([before[1], before[0]]);
    expect(reconcileRows(before, [before[1]])).toEqual([before[1]]);
  });

  it("retains locale formatting and renders unknown dates explicitly", () => {
    const value = "2026-10-20T10:15:00Z"; const date = new Date(value);
    expect(formatDateTime(value)).toBe(`${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    for (const value of [undefined, "-", "", "invalid"]) expect(formatDateTime(value)).toBe("-");
  });
});
