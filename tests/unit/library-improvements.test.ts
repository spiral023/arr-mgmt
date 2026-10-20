import { afterEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";
import { analyzeRadarrMovies, analyzeSonarrSeries } from "../../src/main/arr/analysis-service";
import { normalizeMediaInfo, parseRuntimeSeconds } from "../../src/main/arr/media-info";
import { resolveTransferStatus } from "../../src/main/arr/transfer-status";
import { refreshTransfers, getWanted } from "../../src/main/arr/library-service";
import { selectAnalysisItems } from "../../src/main/arr/analysis-plan";
import { enqueueRadarrAnalysis, type IpcState } from "../../src/main/ipc";
import { JobRunner } from "../../src/main/scheduler/job-runner";
import { Scheduler } from "../../src/main/scheduler/scheduler";
import { RadarrClient } from "../../src/main/arr/radarr-client";
import type { ArrHistory, RadarrMovie } from "../../src/main/arr/arr-types";
import type { TransferView } from "../../src/shared/ipc-contracts";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() }, shell: { openExternal: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());
const movie: RadarrMovie = { id: 1, title: "Example", tmdbId: 99, imdbId: "tt0000001", movieFile: { id: 4, size: 600_000_000, releaseGroup: "Other", mediaInfo: { runTime: "50:00", videoCodec: "x265" } } };

function fixture() {
  const db = createInMemoryDatabase(); migrateDatabase(db);
  const repositories = createRepositories(db);
  const config = { kind: "radarr", name: "Radarr", apiKey: "test-key", baseUrl: `http://${crypto.randomUUID()}.test`, enabled: true };
  const instanceId = repositories.instances.upsert({ ...config, kind: "radarr", apiKeyEncrypted: "test", now: new Date() });
  const state: IpcState = { repositories, scheduler: new Scheduler(),
    jobRunner: new JobRunner({ show: () => {} }, { persistence: repositories.jobs }),
    instanceStore: { getWithApiKey: () => config } as unknown as IpcState["instanceStore"],
  };
  return { db, state, repositories, instanceId, config };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("file measurements", () => {
  it("normalizes actual ARR runtime formats and preserves unknown values", () => {
    expect(parseRuntimeSeconds("58:06")).toBe(3486);
    expect(parseRuntimeSeconds("2:18:17")).toBe(8297);
    expect(parseRuntimeSeconds("1.02:00:00")).toBe(93600);
    for (const value of [null, "", "0:00", "4:99", "n/a", "123"]) expect(parseRuntimeSeconds(value)).toBeNull();
    expect(normalizeMediaInfo({ runTime: "50:00", videoBitrate: 0 }, 600_000_000)).toMatchObject({ totalBitrateMbps: 1.6, megabytesPerMinute: 12, videoBitrateMbps: null });
    expect(normalizeMediaInfo(undefined, 600)).toMatchObject({ totalBitrateMbps: null, runtimeSeconds: null });
  });
  it("counts a multi-episode physical file once while keeping coverage for both episodes", () => {
    const file = { id: 10, size: 600_000_000, releaseGroup: "FuN" };
    const analysis = analyzeSonarrSeries({ id: 1, title: "Double episode", tvdbId: 123 }, [
      { id: 11, seriesId: 1, episodeFile: file }, { id: 12, seriesId: 1, episodeFile: file },
    ]);
    expect(analysis).toMatchObject({ totalSizeBytes: 600_000_000, funSizeBytes: 600_000_000, childrenWithFile: 2, funChildren: 2, externalIds: { tvdbId: 123 } });
  });
  it("round-trips measurements, identities and transfers through an idempotent migration", () => {
    const f = fixture();
    const itemId = f.repositories.mediaItems.upsertAnalysis(f.instanceId, analyzeRadarrMovies([movie]).items[0]);
    f.repositories.transfers.record({ instanceId: f.instanceId, mediaItemId: itemId, childArrId: 1, title: "Example-FuN", grabbedAt: new Date().toISOString() });
    migrateDatabase(f.db);
    const details = f.repositories.mediaItems.itemDetails("movie", 1);
    expect(details.externalIds).toEqual({ tmdbId: 99, imdbId: "tt0000001" });
    expect(details.files?.[0].mediaInfo).toMatchObject({ totalBitrateMbps: 1.6, videoCodec: "x265" });
    expect(details.transfers?.[0].status).toBe("grabbed");
    f.db.close();
  });
  it("prunes removed catalog entries while preserving surviving items and activity history", () => {
    const f = fixture();
    const removedId = f.repositories.mediaItems.upsertAnalysis(f.instanceId, analyzeRadarrMovies([movie]).items[0]);
    f.repositories.mediaItems.upsertAnalysis(f.instanceId, analyzeRadarrMovies([{ ...movie, id: 2 }]).items[0]);
    f.repositories.activityLog.insert({ instanceId: f.instanceId, mediaItemId: removedId, action: "grab", quotaType: "grab", status: "success", createdAt: new Date() });
    expect(f.repositories.mediaItems.reconcileCatalog("movie", f.instanceId, [2])).toBe(1);
    expect(f.repositories.mediaItems.listRadarrRows().map((row) => row.arrId)).toEqual([2]);
    expect(f.repositories.activityLog.listRecent(10)).toHaveLength(1);
    f.db.close();
  });
});

describe("incremental analysis", () => {
  it("prioritizes new titles, refreshes changed and expired items, and retains recent unchanged items", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    const selected = selectAnalysisItems([1, 2, 3, 4].map((id) => ({ id })), [
      { arrId: 1, lastAnalyzedAt: "2026-10-20T09:00:00Z" },
      { arrId: 2, lastAnalyzedAt: "2026-10-20T09:00:00Z" },
      { arrId: 3, lastAnalyzedAt: "2026-10-18T09:00:00Z" },
    ], new Set([2]), now);
    expect(selected.map((item) => item.id)).toEqual([4, 2, 3]);
  });
  it("refreshes an existing Radarr movie after import and falls back to a full scan if history fails", async () => {
    const f = fixture();
    let current = movie;
    let history: ArrHistory[] = [];
    let historyFails = false;
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/qualityprofile")) return json([]);
      if (url.pathname.endsWith("/history/since")) return historyFails ? json({}, 503) : json(history);
      if (url.pathname.endsWith("/movie")) return json([current]);
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetch);
    const run = async () => { const job = enqueueRadarrAnalysis(f.state); await f.state.jobRunner.waitFor(job.id); return f.state.jobRunner.listJobs().find((item) => item.id === job.id)!; };
    expect((await run()).successCount).toBe(1);
    current = { ...movie, movieFile: { ...movie.movieFile, releaseGroup: "FuN" } };
    history = [{ id: 1, movieId: 1, date: new Date().toISOString(), eventType: "downloadFolderImported" }];
    expect((await run()).successCount).toBe(1);
    expect(f.repositories.mediaItems.listRadarrRows()[0].funShare).toBe(1);
    history = [];
    expect((await run()).progressTotal).toBe(0);
    historyFails = true;
    expect((await run()).successCount).toBe(1);
    f.db.close();
  });
});

const transfer: TransferView = { id: 1, instanceId: 1, mediaItemId: 1, childArrId: 1, title: "Example-FuN", downloadId: null,
  status: "grabbed", message: null, grabbedAt: "2026-10-20T10:00:00.000Z", checkedAt: null };
describe("download and import confirmation", () => {
  it("does not infer an import from disappearing downloads or another release's history", () => {
    expect(resolveTransferStatus(transfer, [], [], "radarr").status).toBe("unknown");
    expect(resolveTransferStatus(transfer, [{ id: 1, movieId: 1, sourceTitle: "Other", date: "2026-10-20T10:01:00Z", eventType: "downloadFolderImported" }], [], "radarr").status).toBe("unknown");
    expect(resolveTransferStatus(transfer, [{ id: 1, movieId: 1, sourceTitle: transfer.title, date: "2026-10-20T09:59:59Z", eventType: "downloadFolderImported" }], [], "radarr").status).toBe("unknown");
  });
  it("distinguishes downloads, pending imports and failed imports", () => {
    const base = { id: 1, movieId: 1, title: transfer.title };
    expect(resolveTransferStatus(transfer, [], [{ ...base, status: "downloading" }], "radarr").status).toBe("downloading");
    expect(resolveTransferStatus(transfer, [], [{ ...base, status: "completed", trackedDownloadState: "importPending" }], "radarr").status).toBe("importing");
    expect(resolveTransferStatus(transfer, [], [{ ...base, trackedDownloadState: "importFailed" }], "radarr").status).toBe("failed");
  });
  it("refreshes coverage only after a matching confirmed import", async () => {
    const f = fixture();
    const itemId = f.repositories.mediaItems.upsertAnalysis(f.instanceId, analyzeRadarrMovies([movie]).items[0]);
    f.repositories.transfers.record({ ...transfer, downloadId: undefined, mediaItemId: itemId, instanceId: f.instanceId });
    const fetch = vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path.endsWith("/history/since")) return json([{ id: 1, movieId: 1, sourceTitle: transfer.title, downloadId: "abc", date: "2026-10-20T10:02:00Z", eventType: "downloadFolderImported" }]);
      if (path.endsWith("/queue")) return json({ page: 1, pageSize: 100, totalRecords: 0, records: [] });
      if (path.endsWith("/movie/1")) return json({ ...movie, movieFile: { ...movie.movieFile, releaseGroup: "FuN" } });
      throw new Error(path);
    });
    vi.stubGlobal("fetch", fetch);
    expect((await refreshTransfers(f.state, "radarr"))[0].status).toBe("imported");
    expect(f.repositories.mediaItems.listRadarrRows()[0].funShare).toBe(1);
    expect(fetch.mock.calls.every(([url]) => !url.includes("/release"))).toBe(true);
    f.db.close();
  });
  it("does not query a replacement server for transfers from the previous connection", async () => {
    const f = fixture();
    const itemId = f.repositories.mediaItems.upsertAnalysis(f.instanceId, analyzeRadarrMovies([movie]).items[0]);
    f.repositories.transfers.record({ ...transfer, downloadId: undefined, instanceId: f.instanceId, mediaItemId: itemId });
    f.config.baseUrl = "http://replacement.test";
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await refreshTransfers(f.state, "radarr"))[0]).toMatchObject({ status: "unknown", message: expect.stringContaining("Verbindung hat sich geändert") });
    expect(fetch).not.toHaveBeenCalled();
    f.db.close();
  });
});

describe("API read contracts", () => {
  it("uses ARR wanted counts and enriches Radarr cutoff files", async () => {
    const f = fixture();
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/moviefile/4")) return json(movie.movieFile);
      return json({ page: 1, pageSize: 20, totalRecords: 7, records: [{ id: 1, title: movie.title, movieFileId: 4 }] });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await getWanted(f.state, "radarr", "cutoff");
    expect(result.totalRecords).toBe(7);
    expect(result.records[0]).toHaveProperty("movieFile.mediaInfo.runTime", "50:00");
    f.db.close();
  });
  it("rejects a successful HTTP response with the wrong response shape", async () => {
    const client = new RadarrClient({ baseUrl: "http://contract.test", apiKey: "test", fetchImpl: async () => json({ error: "not an array" }) });
    await expect(client.getMovies()).rejects.toThrow("expected an array");
    await expect(client.getQueue()).rejects.toThrow("paginated");
  });
});
