import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

// Always copy the supplied snapshot. This benchmark never changes its input database.
const option = (name) => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes("--database")) throw new Error("Usage: node scripts/benchmark-performance.mjs --database <snapshot.sqlite> [--baseline <before.cjs>]");
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const scratch = mkdtempSync(join(tmpdir(), "arr-ops-benchmark-"));
const currentBundle = join(scratch, "current.cjs");
buildSync({ stdin: { contents: 'export {createRepositories} from "./src/main/db/repositories"; export {migrateDatabase} from "./src/main/db/migrations"; export {formatDateTime} from "./src/shared/date-time"; export {JobRunner} from "./src/main/scheduler/job-runner"; export {mapConcurrent} from "./src/main/async/map-concurrent";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "cjs", outfile: currentBundle });
const input = resolve(option("--database"));
const results = [];
for (const [label, bundle] of [
  ...(process.argv.includes("--baseline") ? [["before", resolve(option("--baseline"))]] : []),
  ["after", currentBundle],
]) {
  const path = join(scratch, `${label}.sqlite`);
  copyFileSync(input, path);
  const db = new Database(path);
  if (label === "after") { db.pragma("journal_mode=WAL"); db.pragma("synchronous=FULL"); }
  if (db.pragma("quick_check", { simple: true }) !== "ok") throw new Error("Invalid input snapshot");
  const module = require(bundle);
  module.migrateDatabase(db);
  const repos = module.createRepositories(db);
  const parent = db.prepare("select mi.* from media_items mi join media_files mf on mf.media_item_id=mi.id group by mi.id order by count(*) desc limit 1").get();
  const files = db.prepare("select * from media_files where media_item_id=? order by id").all(parent.id).map((f) => ({
    arrFileId: f.arr_file_id, childArrId: f.child_arr_id, seasonNumber: f.season_number,
    episodeNumber: f.episode_number, path: f.path, relativePath: f.relative_path,
    releaseGroup: f.release_group, isFun: !!f.is_fun, qualityName: f.quality_name,
    sizeBytes: f.size_bytes, mediaInfo: JSON.parse(f.media_info_json ?? "null"),
  }));
  const item = { kind: parent.kind, arrId: parent.arr_id, title: parent.title, titleSlug: parent.title_slug,
    sortTitle: parent.sort_title, year: parent.year, monitored: !!parent.monitored, hasFile: !!parent.has_file,
    totalChildren: parent.total_children, childrenWithFile: parent.children_with_file,
    funChildren: parent.fun_children, totalSizeBytes: parent.total_size_bytes, funShare: parent.fun_share,
    lastAnalyzedAt: parent.last_analyzed_at, qualityProfileName: parent.quality_profile_name,
    externalIds: JSON.parse(parent.external_ids_json ?? "{}"), files,
  };
  const timed = (run) => { const t = performance.now(); const value = run(); return { ms: +(performance.now() - t).toFixed(2), value }; };
  const write = timed(() => repos.mediaItems.upsertAnalysis(parent.instance_id, item));
  const sonarr = timed(() => repos.mediaItems.listSonarrRows());
  const radarr = timed(() => repos.mediaItems.listRadarrRows());
  const rows = [...sonarr.value, ...radarr.value];
  const formatter = module.formatDateTime ?? ((value) => {
    if (!value || value === "-") return "-";
    const d = new Date(value);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`;
  });
  const dates = timed(() => { for (const row of rows) for (const key of ["lastAnalyzed", "lastSearched", "lastGrabbed"]) formatter(row[key]); });
  const fileCount = db.prepare("select count(*) n from media_files").get().n;
  const details = repos.mediaItems.itemDetails(parent.kind, parent.arr_id);
  if (details.files.length !== files.length || JSON.stringify(details.externalIds) !== JSON.stringify(item.externalIds)) throw new Error("Metadata changed during round trip");
  const result = { label, libraryRows: rows.length, fileCount, seriesFiles: files.length,
    upsertMs: write.ms, sonarrRowsMs: sonarr.ms, radarrRowsMs: radarr.ms, dateFormattingMs: dates.ms,
    fileLookupPlan: db.prepare("explain query plan select id from media_files where media_item_id=? and child_arr_id=?").all(parent.id, files[0].childArrId).map((r) => r.detail),
  };
  results.push(result);
  console.log(JSON.stringify(result));
  if (label === "after" && process.argv.includes("--replay")) {
    const parents = db.prepare("select * from media_items where kind='series' order by id").all();
    const getFiles = db.prepare("select * from media_files where media_item_id=?");
    let maxBlockMs = 0, maxTimerLagMs = 0, writes = 0;
    let tick = performance.now();
    const heartbeat = setInterval(() => { const now = performance.now(); maxTimerLagMs = Math.max(maxTimerLagMs, now - tick - 10); tick = now; }, 10);
    const runner = new module.JobRunner({ show: () => {} }, { persistence: repos.jobs, onChange: (e) => { if (e.type === "job") writes++; } });
    const started = performance.now();
    const job = runner.enqueue({ name: "Offline library replay", kind: "analysis", target: "sonarr", progressTotal: parents.length, run: async (ctx) => {
      await module.mapConcurrent(parents, 4, async (parent) => {
        const begin = performance.now();
        const files = getFiles.all(parent.id).map((f) => ({ arrFileId: f.arr_file_id, childArrId: f.child_arr_id, seasonNumber: f.season_number,
          episodeNumber: f.episode_number, path: f.path, relativePath: f.relative_path, releaseGroup: f.release_group,
          isFun: !!f.is_fun, qualityName: f.quality_name, sizeBytes: f.size_bytes, mediaInfo: JSON.parse(f.media_info_json ?? "null") }));
        const id = repos.mediaItems.upsertAnalysis(parent.instance_id, { kind: parent.kind, arrId: parent.arr_id, title: parent.title,
          titleSlug: parent.title_slug, sortTitle: parent.sort_title, year: parent.year, monitored: !!parent.monitored, hasFile: !!parent.has_file,
          totalChildren: parent.total_children, childrenWithFile: parent.children_with_file, funChildren: parent.fun_children,
          totalSizeBytes: parent.total_size_bytes, funShare: parent.fun_share, lastAnalyzedAt: parent.last_analyzed_at,
          qualityProfileName: parent.quality_profile_name, externalIds: JSON.parse(parent.external_ids_json ?? "{}"), files });
        repos.activityLog.insert({ action: "analysis", quotaType: "none", status: "success", instanceId: parent.instance_id, mediaItemId: id, createdAt: new Date() });
        ctx.incrementProgress();
        maxBlockMs = Math.max(maxBlockMs, performance.now() - begin);
      }, { yieldEvery: 1 });
    } });
    await runner.waitFor(job.id);
    clearInterval(heartbeat);
    const replay = { label: "offline-replay", series: parents.length, ms: Math.round(performance.now() - started),
      maxItemMs: +maxBlockMs.toFixed(2), maxTimerLagMs: +maxTimerLagMs.toFixed(2), progressWrites: writes,
      status: job.status, processed: job.progressCurrent };
    if (job.status !== "completed" || job.progressCurrent !== parents.length || db.prepare("select count(*) n from media_files").get().n !== fileCount) throw new Error("Replay failed or changed file count");
    results.push(replay); console.log(JSON.stringify(replay));
  }
  db.close();
}
writeFileSync(join(scratch, "results.json"), JSON.stringify(results, null, 2));
console.log(`Benchmark artifacts: ${scratch}`);
