import type { AppDatabase } from "./client";
import type { ActivityInsert, ActivityStatus, PerfSampleInsert, QuotaType } from "./schema";
import type { ArrRelease, MediaItemAnalysis } from "../arr/arr-types";
import type { Job, JobEvent } from "../scheduler/job-runner";
import { calculateNextRunAt } from "../../shared/schedule";
import type {
  InstanceKind,
  LibrarySummary,
  MediaItemDetails,
  RadarrMovieTableRow,
  ScheduleInput,
  ScheduleView,
  SonarrSeriesTableRow,
  StatsSummary,
} from "../../shared/ipc-contracts";

function toIso(date: Date): string {
  return date.toISOString();
}

export function createRepositories(db: AppDatabase) {
  return {
    instances: {
      upsert(input: {
        kind: InstanceKind;
        name: string;
        baseUrl: string;
        apiKeyEncrypted: string;
        enabled: boolean;
        now: Date;
      }): number {
        const now = toIso(input.now);
        db.prepare(
          `insert into instances (kind, name, base_url, api_key_encrypted, enabled, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?)
           on conflict(kind) do update set
             name = excluded.name,
             base_url = excluded.base_url,
             api_key_encrypted = excluded.api_key_encrypted,
             enabled = excluded.enabled,
             updated_at = excluded.updated_at`,
        ).run(input.kind, input.name, input.baseUrl, input.apiKeyEncrypted, input.enabled ? 1 : 0, now, now);

        const row = db.prepare("select id from instances where kind = ?").get(input.kind) as { id: number };
        return row.id;
      },

      findIdByKind(kind: InstanceKind): number | undefined {
        const row = db.prepare("select id from instances where kind = ?").get(kind) as { id: number } | undefined;
        return row?.id;
      },
    },

    mediaItems: {
      upsertAnalysis(instanceId: number, item: MediaItemAnalysis): number {
        db.prepare(
          `insert into media_items (
             instance_id,
             kind,
             arr_id,
             title,
             title_slug,
             sort_title,
             year,
             monitored,
             has_file,
             total_children,
             children_with_file,
             fun_children,
             total_size_bytes,
             fun_share,
             last_analyzed_at,
             quality_profile_name
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict(instance_id, kind, arr_id) do update set
             title = excluded.title,
             title_slug = excluded.title_slug,
             sort_title = excluded.sort_title,
             year = excluded.year,
             monitored = excluded.monitored,
             has_file = excluded.has_file,
             total_children = excluded.total_children,
             children_with_file = excluded.children_with_file,
             fun_children = excluded.fun_children,
             total_size_bytes = excluded.total_size_bytes,
             fun_share = excluded.fun_share,
             last_analyzed_at = excluded.last_analyzed_at,
             quality_profile_name = excluded.quality_profile_name`,
        ).run(
          instanceId,
          item.kind,
          item.arrId,
          item.title,
          item.titleSlug ?? null,
          item.sortTitle ?? null,
          item.year ?? null,
          item.monitored ? 1 : 0,
          item.hasFile ? 1 : 0,
          item.totalChildren,
          item.childrenWithFile,
          item.funChildren,
          item.totalSizeBytes,
          item.funShare,
          item.lastAnalyzedAt,
          item.qualityProfileName ?? null,
        );

        const mediaItem = db
          .prepare("select id from media_items where instance_id = ? and kind = ? and arr_id = ?")
          .get(instanceId, item.kind, item.arrId) as { id: number };

        db.prepare("delete from media_files where media_item_id = ?").run(mediaItem.id);
        const insertFile = db.prepare(
          `insert into media_files (
             media_item_id,
             arr_file_id,
             child_arr_id,
             season_number,
             episode_number,
             path,
             relative_path,
             release_group,
             is_fun,
             quality_name,
             size_bytes,
             date_added
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        for (const file of item.files) {
          insertFile.run(
            mediaItem.id,
            file.arrFileId ?? null,
            file.childArrId,
            file.seasonNumber ?? null,
            file.episodeNumber ?? null,
            file.path ?? null,
            file.relativePath ?? null,
            file.releaseGroup,
            file.isFun ? 1 : 0,
            file.qualityName ?? null,
            file.sizeBytes,
            null,
          );
        }

        return mediaItem.id;
      },

      summary(): LibrarySummary {
        const row = db
          .prepare(
            `select
               sum(case when kind = 'series' then 1 else 0 end) as totalSeries,
               sum(case when kind = 'movie' then 1 else 0 end) as totalMovies,
               coalesce(sum(children_with_file), 0) as totalFiles,
               coalesce(sum(total_size_bytes), 0) as totalSizeBytes,
               coalesce(sum(fun_children), 0) as funFiles,
               coalesce(sum(case when kind = 'series' then children_with_file else 0 end), 0) as sonarrFiles,
               coalesce(sum(case when kind = 'series' then fun_children else 0 end), 0) as sonarrFunFiles,
               coalesce(sum(case when kind = 'movie' then children_with_file else 0 end), 0) as radarrFiles,
               coalesce(sum(case when kind = 'movie' then fun_children else 0 end), 0) as radarrFunFiles
             from media_items`,
          )
          .get() as {
          totalSeries: number | null;
          totalMovies: number | null;
          totalFiles: number;
          totalSizeBytes: number;
          funFiles: number;
          sonarrFiles: number;
          sonarrFunFiles: number;
          radarrFiles: number;
          radarrFunFiles: number;
        };
        const pending = db
          .prepare(
            `select
               coalesce(sum(case when mi.kind = 'series' then 1 else 0 end), 0) as sonarrPending,
               coalesce(sum(case when mi.kind = 'movie' then 1 else 0 end), 0) as radarrPending
             from release_candidates rc
             left join media_items mi on mi.id = rc.media_item_id
             where rc.is_fun = 1`,
          )
          .get() as { sonarrPending: number; radarrPending: number };
        const grabs = db
          .prepare("select count(*) as count from activity_log where action = 'grab' and status = 'success'")
          .get() as { count: number };
        return {
          totalSeries: row.totalSeries ?? 0,
          totalMovies: row.totalMovies ?? 0,
          totalFiles: row.totalFiles,
          totalSizeBytes: row.totalSizeBytes,
          funFiles: row.funFiles,
          funShare: row.totalFiles === 0 ? 0 : row.funFiles / row.totalFiles,
          sonarrFunShare: row.sonarrFiles === 0 ? 0 : row.sonarrFunFiles / row.sonarrFiles,
          radarrFunShare: row.radarrFiles === 0 ? 0 : row.radarrFunFiles / row.radarrFiles,
          sonarrPendingFunCandidates: pending.sonarrPending,
          radarrPendingFunCandidates: pending.radarrPending,
          successfulGrabs: grabs.count,
        };
      },

      findIdByArrId(kind: "series" | "movie", arrId: number, instanceId?: number): number | undefined {
        const row = db
          .prepare(
            `select id from media_items
             where kind = ? and arr_id = ? and (? is null or instance_id = ?)
             order by id desc
             limit 1`,
          )
          .get(kind, arrId, instanceId ?? null, instanceId ?? null) as { id: number } | undefined;
        return row?.id;
      },

      listAnalyzedArrIds(kind: "series" | "movie", instanceId: number): number[] {
        const rows = db
          .prepare(
            `select arr_id as arrId
             from media_items
             where instance_id = ? and kind = ? and last_analyzed_at is not null
             order by arr_id asc`,
          )
          .all(instanceId, kind) as Array<{ arrId: number }>;
        return rows.map((row) => row.arrId);
      },

      listSonarrRows(): SonarrSeriesTableRow[] {
        const rows = db
          .prepare(
            `with last_activity as (
               select
                 media_item_id,
                 max(case when action = 'search' then created_at end) as lastSearched,
                 max(case when action = 'grab' then created_at end) as lastGrabbed
               from activity_log
               where action in ('search', 'grab')
               group by media_item_id
             ),
             pending_candidates as (
               select
                 media_item_id,
                 count(*) as pendingFunCandidates
               from release_candidates
               where is_fun = 1
               group by media_item_id
             )
             select
               mi.id,
               mi.arr_id as arrId,
               mi.title,
               mi.title_slug as titleSlug,
               mi.monitored,
               mi.has_file as hasFiles,
               mi.total_children as episodes,
               mi.children_with_file as files,
               mi.fun_children as funFiles,
               mi.total_size_bytes as totalSizeBytes,
               mi.fun_share as funShare,
               mi.last_analyzed_at as lastAnalyzed,
               la.lastSearched,
               la.lastGrabbed,
               coalesce(pc.pendingFunCandidates, 0) as pendingFunCandidates,
               mi.quality_profile_name as qualityProfileName
             from media_items mi
             join instances i on i.id = mi.instance_id
             left join last_activity la on la.media_item_id = mi.id
             left join pending_candidates pc on pc.media_item_id = mi.id
             where i.kind = 'sonarr' and mi.kind = 'series'
             order by mi.title collate nocase`,
          )
          .all() as Array<{
          id: number;
          arrId: number;
          title: string;
          titleSlug: string | null;
          monitored: 0 | 1;
          hasFiles: 0 | 1;
          episodes: number;
          files: number;
          funFiles: number;
          totalSizeBytes: number;
          funShare: number;
          lastAnalyzed: string | null;
          lastSearched: string | null;
          lastGrabbed: string | null;
          pendingFunCandidates: number;
          qualityProfileName: string | null;
        }>;

        return rows.map((row) => {
          const nonFunFiles = row.files - row.funFiles;
          return {
            id: `series-${row.arrId}`,
            arrId: row.arrId,
            title: row.title,
            titleSlug: row.titleSlug ?? undefined,
            monitored: Boolean(row.monitored),
            episodes: row.episodes,
            files: row.files,
            totalSizeBytes: row.totalSizeBytes,
            funFiles: row.funFiles,
            funShare: row.funShare,
            nonFunFiles,
            pendingFunCandidates: row.pendingFunCandidates,
            hasFiles: Boolean(row.hasFiles),
            lastAnalyzed: row.lastAnalyzed ?? "-",
            lastSearched: row.lastSearched ?? "-",
            lastGrabbed: row.lastGrabbed ?? "-",
            status: nonFunFiles > 0 && row.funFiles > 0 ? "searchable" : "ready",
            qualityProfileName: row.qualityProfileName ?? undefined,
          };
        });
      },

      listRadarrRows(): RadarrMovieTableRow[] {
        const rows = db
          .prepare(
            `with last_activity as (
               select
                 media_item_id,
                 max(case when action = 'search' then created_at end) as lastSearched,
                 max(case when action = 'grab' then created_at end) as lastGrabbed
               from activity_log
               where action in ('search', 'grab')
               group by media_item_id
             ),
             pending_candidates as (
               select
                 media_item_id,
                 count(*) as pendingFunCandidates
               from release_candidates
               where is_fun = 1
               group by media_item_id
             ),
             first_file as (
               select
                 media_item_id,
                 release_group as releaseGroup,
                 is_fun as isFun,
                 size_bytes as sizeBytes
               from media_files
               group by media_item_id
             )
             select
               mi.id,
               mi.arr_id as arrId,
               mi.title,
               mi.year,
               mi.monitored,
               mi.has_file as hasFiles,
               mi.children_with_file as files,
               mi.fun_children as funFiles,
               mi.total_size_bytes as totalSizeBytes,
               mi.fun_share as funShare,
               mi.last_analyzed_at as lastAnalyzed,
               la.lastSearched,
               la.lastGrabbed,
               coalesce(pc.pendingFunCandidates, 0) as pendingFunCandidates,
               ff.releaseGroup,
               coalesce(ff.isFun, 0) as isFun,
               coalesce(ff.sizeBytes, mi.total_size_bytes, 0) as sizeBytes,
               mi.quality_profile_name as qualityProfileName
             from media_items mi
             join instances i on i.id = mi.instance_id
             left join last_activity la on la.media_item_id = mi.id
             left join pending_candidates pc on pc.media_item_id = mi.id
             left join first_file ff on ff.media_item_id = mi.id
             where i.kind = 'radarr' and mi.kind = 'movie'
             order by mi.title collate nocase`,
          )
          .all() as Array<{
          id: number;
          arrId: number;
          title: string;
          year: number | null;
          monitored: 0 | 1;
          hasFiles: 0 | 1;
          files: number;
          funFiles: number;
          totalSizeBytes: number;
          funShare: number;
          lastAnalyzed: string | null;
          lastSearched: string | null;
          lastGrabbed: string | null;
          pendingFunCandidates: number;
          releaseGroup: string | null;
          isFun: 0 | 1;
          sizeBytes: number;
          qualityProfileName: string | null;
        }>;

        return rows.map((row) => {
          const nonFunFiles = row.files - row.funFiles;
          return {
            id: `movie-${row.arrId}`,
            arrId: row.arrId,
            title: row.title,
            year: row.year ?? undefined,
            monitored: Boolean(row.monitored),
            hasFiles: Boolean(row.hasFiles),
            files: row.files,
            sizeBytes: row.sizeBytes,
            funFiles: row.funFiles,
            funShare: row.funShare,
            nonFunFiles,
            pendingFunCandidates: row.pendingFunCandidates,
            releaseGroup: row.releaseGroup,
            isFun: Boolean(row.isFun),
            lastAnalyzed: row.lastAnalyzed ?? "-",
            lastSearched: row.lastSearched ?? "-",
            lastGrabbed: row.lastGrabbed ?? "-",
            status: nonFunFiles > 0 ? "searchable" : "ready",
            qualityProfileName: row.qualityProfileName ?? undefined,
          };
        });
      },

      itemDetails(kind: "series" | "movie", arrId: number): MediaItemDetails {
        const item = db
          .prepare("select id from media_items where kind = ? and arr_id = ? order by id desc limit 1")
          .get(kind, arrId) as { id: number } | undefined;
        if (!item) {
          return { kind, arrId, nonFunFiles: [], candidates: [] };
        }

        const fileRows = db
          .prepare(
            `select
               child_arr_id as childArrId,
               season_number as seasonNumber,
               episode_number as episodeNumber,
               relative_path as relativePath,
               release_group as releaseGroup,
               quality_name as quality,
               size_bytes as sizeBytes
             from media_files
             where media_item_id = ? and is_fun = 0
             order by season_number asc, episode_number asc, id asc`,
          )
          .all(item.id) as Array<{
          childArrId: number | null;
          seasonNumber: number | null;
          episodeNumber: number | null;
          relativePath: string | null;
          releaseGroup: string | null;
          quality: string | null;
          sizeBytes: number;
        }>;

        const candidateRows = db
          .prepare(
            `select
               id,
               child_arr_id as childArrId,
               title,
               release_group as releaseGroup,
               quality_name as quality,
               indexer,
               size_bytes as sizeBytes,
               approved,
               found_at as foundAt
             from release_candidates
             where media_item_id = ? and is_fun = 1
             order by found_at asc, id asc`,
          )
          .all(item.id) as Array<{
          id: number;
          childArrId: number | null;
          title: string;
          releaseGroup: string | null;
          quality: string | null;
          indexer: string | null;
          sizeBytes: number;
          approved: 0 | 1 | null;
          foundAt: string;
        }>;

        return {
          kind,
          arrId,
          nonFunFiles: fileRows.map((row) => ({
            childArrId: row.childArrId ?? 0,
            seasonNumber: row.seasonNumber,
            episodeNumber: row.episodeNumber,
            relativePath: row.relativePath,
            releaseGroup: row.releaseGroup,
            quality: row.quality,
            sizeBytes: row.sizeBytes,
          })),
          candidates: candidateRows.map((row) => ({
            id: row.id,
            childArrId: row.childArrId ?? 0,
            title: row.title,
            releaseGroup: row.releaseGroup,
            quality: row.quality,
            indexer: row.indexer,
            sizeBytes: row.sizeBytes,
            approved: row.approved === null ? null : Boolean(row.approved),
            foundAt: row.foundAt,
          })),
        };
      },
    },

    releaseCandidates: {
      insert(input: {
        instanceId: number;
        mediaItemId?: number;
        childArrId: number;
        release: ArrRelease;
        foundAt: Date;
      }): number {
        const result = db
          .prepare(
            `insert into release_candidates (
               instance_id,
               media_item_id,
               child_arr_id,
               arr_release_guid,
               title,
               release_group,
               is_fun,
               quality_name,
               size_bytes,
               indexer,
               approved,
               download_allowed,
               rejected,
               rejections_json,
               raw_json,
               found_at
             ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.instanceId,
            input.mediaItemId ?? null,
            input.childArrId,
            input.release.guid ?? null,
            input.release.title ?? "Unknown release",
            input.release.releaseGroup ?? null,
            1,
            input.release.quality?.quality?.name ?? null,
            input.release.size ?? 0,
            input.release.indexer ?? null,
            booleanToNullableInt(input.release.approved),
            booleanToNullableInt(input.release.downloadAllowed),
            booleanToNullableInt(input.release.rejected),
            input.release.rejections ? JSON.stringify(input.release.rejections) : null,
            JSON.stringify(input.release),
            toIso(input.foundAt),
          );
        return Number(result.lastInsertRowid);
      },

      listForSeriesIds(seriesIds: number[]): Array<{ id: number; mediaItemId: number | null; childArrId: number; release: ArrRelease }> {
        if (seriesIds.length === 0) {
          return [];
        }
        const placeholders = seriesIds.map(() => "?").join(", ");
        const rows = db
          .prepare(
            `select rc.id, rc.media_item_id as mediaItemId, rc.child_arr_id as childArrId, rc.raw_json as rawJson
             from release_candidates rc
             join media_items mi on mi.id = rc.media_item_id
             where mi.kind = 'series' and mi.arr_id in (${placeholders})
             order by rc.found_at asc`,
          )
          .all(...seriesIds) as Array<{ id: number; mediaItemId: number | null; childArrId: number; rawJson: string }>;
        return rows.map((row) => ({
          id: row.id,
          mediaItemId: row.mediaItemId,
          childArrId: row.childArrId,
          release: JSON.parse(row.rawJson) as ArrRelease,
        }));
      },

      listForMovieIds(movieIds: number[]): Array<{ id: number; mediaItemId: number | null; childArrId: number; release: ArrRelease }> {
        if (movieIds.length === 0) {
          return [];
        }
        const placeholders = movieIds.map(() => "?").join(", ");
        const rows = db
          .prepare(
            `select rc.id, rc.media_item_id as mediaItemId, rc.child_arr_id as childArrId, rc.raw_json as rawJson
             from release_candidates rc
             join media_items mi on mi.id = rc.media_item_id
             where mi.kind = 'movie' and mi.arr_id in (${placeholders})
             order by rc.found_at asc`,
          )
          .all(...movieIds) as Array<{ id: number; mediaItemId: number | null; childArrId: number; rawJson: string }>;
        return rows.map((row) => ({
          id: row.id,
          mediaItemId: row.mediaItemId,
          childArrId: row.childArrId,
          release: JSON.parse(row.rawJson) as ArrRelease,
        }));
      },

      delete(id: number): void {
        db.prepare("delete from release_candidates where id = ?").run(id);
      },
    },

    jobs: {
      upsert(job: Job): void {
        db.prepare(
          `insert into jobs (
             id,
             name,
             kind,
             target_scope,
             status,
             progress_current,
             progress_total,
             success_count,
             failure_count,
             created_at,
             started_at,
             finished_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict(id) do update set
             name = excluded.name,
             kind = excluded.kind,
             target_scope = excluded.target_scope,
             status = excluded.status,
             progress_current = excluded.progress_current,
             progress_total = excluded.progress_total,
             success_count = excluded.success_count,
             failure_count = excluded.failure_count,
             started_at = excluded.started_at,
             finished_at = excluded.finished_at`,
        ).run(
          job.id,
          job.name,
          job.kind,
          job.target,
          job.status,
          job.progressCurrent,
          job.progressTotal,
          job.successCount,
          job.failureCount,
          job.createdAt,
          job.startedAt ?? null,
          job.finishedAt ?? null,
        );
      },

      insertEvent(event: JobEvent): void {
        db.prepare("insert into job_events (job_id, level, message, created_at) values (?, ?, ?, ?)").run(
          event.jobId,
          event.level,
          event.message,
          event.createdAt,
        );
      },

      list(): Job[] {
        const rows = db
          .prepare(
            `select
               id,
               name,
               kind,
               target_scope as target,
               status,
               progress_current as progressCurrent,
               progress_total as progressTotal,
               success_count as successCount,
               failure_count as failureCount,
               created_at as createdAt,
               started_at as startedAt,
               finished_at as finishedAt
             from jobs
             order by created_at desc`,
          )
          .all() as Job[];
        return rows;
      },

      listEvents(jobId?: string): JobEvent[] {
        const sql = `select job_id as jobId, level, message, created_at as createdAt from job_events`;
        const rows = jobId
          ? db.prepare(`${sql} where job_id = ? order by created_at asc`).all(jobId)
          : db.prepare(`${sql} order by created_at desc limit 200`).all();
        return rows as JobEvent[];
      },
    },

    activityLog: {
      insert(input: ActivityInsert): number {
        const result = db
          .prepare(
            `insert into activity_log (
              instance_id,
              media_item_id,
              child_arr_id,
              action,
              quota_type,
              status,
              message,
              payload_json,
              created_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.instanceId ?? null,
            input.mediaItemId ?? null,
            input.childArrId ?? null,
            input.action,
            input.quotaType,
            input.status,
            input.message ?? null,
            input.payloadJson ?? null,
            toIso(input.createdAt),
          );
        return Number(result.lastInsertRowid);
      },

      update(id: number, input: { status: ActivityStatus; message?: string | null; payloadJson?: string | null }): void {
        db.prepare(
          `update activity_log
           set status = ?,
               message = coalesce(?, message),
               payload_json = coalesce(?, payload_json)
           where id = ?`,
        ).run(input.status, input.message ?? null, input.payloadJson ?? null, id);
      },

      countSince(quotaType: Exclude<QuotaType, "none">, now: Date, windowHours: number): number {
        const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000).toISOString();
        const row = db
          .prepare(
            `select count(*) as count
             from activity_log
             where quota_type = ?
               and created_at >= ?
               and created_at <= ?
               and status in ('started', 'success', 'failed')`,
          )
          .get(quotaType, since, toIso(now)) as { count: number };
        return row.count;
      },

      hasRecentChildActivity(input: {
        action: "search" | "grab";
        childArrId: number;
        instanceId: number;
        now: Date;
        windowHours: number;
      }): boolean {
        const since = new Date(input.now.getTime() - input.windowHours * 60 * 60 * 1000).toISOString();
        const row = db
          .prepare(
            `select 1 as found
             from activity_log
             where action = ?
               and instance_id = ?
               and child_arr_id = ?
               and created_at >= ?
               and created_at <= ?
               and status in ('success', 'failed', 'started')
             limit 1`,
          )
          .get(input.action, input.instanceId, input.childArrId, since, toIso(input.now)) as { found: 1 } | undefined;
        return Boolean(row);
      },

      listRecent(limit = 50): Array<{
        action: string;
        app: string;
        at: string;
        item: string;
        quota: string;
        status: string;
      }> {
        return db
          .prepare(
            `select
               a.action,
               coalesce(i.kind, 'external') as app,
               a.created_at as at,
               coalesce(mi.title, a.message, '-') as item,
               a.quota_type as quota,
               a.status
             from activity_log a
             left join instances i on i.id = a.instance_id
             left join media_items mi on mi.id = a.media_item_id
             order by a.created_at desc
             limit ?`,
          )
          .all(limit) as Array<{
          action: string;
          app: string;
          at: string;
          item: string;
          quota: string;
          status: string;
        }>;
      },
    },

    perfSamples: {
      insert(input: PerfSampleInsert): void {
        db.prepare(
          `insert into perf_samples (
             job_id,
             app,
             phase,
             operation,
             child_arr_id,
             strategy,
             outcome,
             duration_ms,
             detail,
             created_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          input.jobId ?? null,
          input.app ?? null,
          input.phase,
          input.operation,
          input.childArrId ?? null,
          input.strategy ?? null,
          input.outcome,
          Math.round(input.durationMs),
          input.detail ?? null,
          toIso(input.createdAt),
        );
      },

      summarizeForJob(jobId: string): Array<{
        operation: string;
        outcome: string;
        count: number;
        avgMs: number;
        minMs: number;
        maxMs: number;
      }> {
        return db
          .prepare(
            `select
               operation,
               outcome,
               count(*) as count,
               cast(round(avg(duration_ms)) as integer) as avgMs,
               min(duration_ms) as minMs,
               max(duration_ms) as maxMs
             from perf_samples
             where job_id = ?
             group by operation, outcome
             order by operation, outcome`,
          )
          .all(jobId) as Array<{
          operation: string;
          outcome: string;
          count: number;
          avgMs: number;
          minMs: number;
          maxMs: number;
        }>;
      },

      summarizeByPhase(phase: string): Array<{
        operation: string;
        outcome: string;
        count: number;
        avgMs: number;
        minMs: number;
        maxMs: number;
      }> {
        return db
          .prepare(
            `select
               operation,
               outcome,
               count(*) as count,
               cast(round(avg(duration_ms)) as integer) as avgMs,
               min(duration_ms) as minMs,
               max(duration_ms) as maxMs
             from perf_samples
             where phase = ?
             group by operation, outcome
             order by operation, outcome`,
          )
          .all(phase) as Array<{
          operation: string;
          outcome: string;
          count: number;
          avgMs: number;
          minMs: number;
          maxMs: number;
        }>;
      },
    },

    schedules: {
      upsert(input: ScheduleInput & { now: Date }): ScheduleView {
        const now = toIso(input.now);
        const nextRunAt = calculateNextRunAt(
          {
            intervalKind: input.intervalKind,
            intervalValue: input.intervalValue,
            timeOfDay: input.timeOfDay,
          },
          input.now,
        ).toISOString();

        if (input.id) {
          db.prepare(
            `update schedules
             set name = ?,
                 enabled = ?,
                 actions_json = ?,
                 target_scope = ?,
                 interval_kind = ?,
                 interval_value = ?,
                 time_of_day = ?,
                 next_run_at = ?,
                 updated_at = ?
             where id = ?`,
          ).run(
            input.name,
            input.enabled ? 1 : 0,
            JSON.stringify(input.actions),
            input.targetScope,
            input.intervalKind,
            input.intervalValue ?? null,
            input.timeOfDay ?? null,
            nextRunAt,
            now,
            input.id,
          );
        } else {
          db.prepare(
            `insert into schedules (
               name,
               enabled,
               actions_json,
               target_scope,
               interval_kind,
               interval_value,
               time_of_day,
               next_run_at,
               created_at,
               updated_at
             ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            input.name,
            input.enabled ? 1 : 0,
            JSON.stringify(input.actions),
            input.targetScope,
            input.intervalKind,
            input.intervalValue ?? null,
            input.timeOfDay ?? null,
            nextRunAt,
            now,
            now,
          );
        }

        const id =
          input.id ??
          (db.prepare("select last_insert_rowid() as id").get() as {
            id: number;
          }).id;
        return this.find(id)!;
      },

      list(): ScheduleView[] {
        const rows = db
          .prepare(
            `select
               id,
               name,
               enabled,
               actions_json as actionsJson,
               target_scope as targetScope,
               interval_kind as intervalKind,
               interval_value as intervalValue,
               time_of_day as timeOfDay,
               next_run_at as nextRunAt,
               last_run_at as lastRunAt
             from schedules
             order by name collate nocase`,
          )
          .all() as ScheduleRow[];
        return rows.map(formatScheduleRow);
      },

      find(id: number): ScheduleView | undefined {
        const row = db
          .prepare(
            `select
               id,
               name,
               enabled,
               actions_json as actionsJson,
               target_scope as targetScope,
               interval_kind as intervalKind,
               interval_value as intervalValue,
               time_of_day as timeOfDay,
               next_run_at as nextRunAt,
               last_run_at as lastRunAt
             from schedules
             where id = ?`,
          )
          .get(id) as ScheduleRow | undefined;
        return row ? formatScheduleRow(row) : undefined;
      },

      markRun(id: number, lastRunAt: Date, nextRunAt: Date): void {
        db.prepare("update schedules set last_run_at = ?, next_run_at = ?, updated_at = ? where id = ?").run(
          toIso(lastRunAt),
          toIso(nextRunAt),
          toIso(lastRunAt),
          id,
        );
      },

      delete(id: number): void {
        db.prepare("delete from schedules where id = ?").run(id);
      },
    },

    settings: {
      get<T>(key: string, fallback: T): T {
        const row = db.prepare("select value_json as valueJson from settings where key = ?").get(key) as { valueJson: string } | undefined;
        return row ? (JSON.parse(row.valueJson) as T) : fallback;
      },

      set(key: string, value: unknown): void {
        db.prepare(
          `insert into settings (key, value_json)
           values (?, ?)
           on conflict(key) do update set value_json = excluded.value_json`,
        ).run(key, JSON.stringify(value));
      },
    },

    stats: {
      recordCoverageSnapshot(now = new Date()): void {
        const summary = this.mediaSummary();
        const date = toDateKey(now);
        const iso = toIso(now);
        db.prepare(
          `insert into coverage_snapshots (
             date,
             sonarr_fun_share,
             radarr_fun_share,
             total_fun_share,
             sonarr_fun_files,
             radarr_fun_files,
             total_files,
             created_at,
             updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict(date) do update set
             sonarr_fun_share = excluded.sonarr_fun_share,
             radarr_fun_share = excluded.radarr_fun_share,
             total_fun_share = excluded.total_fun_share,
             sonarr_fun_files = excluded.sonarr_fun_files,
             radarr_fun_files = excluded.radarr_fun_files,
             total_files = excluded.total_files,
             updated_at = excluded.updated_at`,
        ).run(
          date,
          summary.sonarrFunShare,
          summary.radarrFunShare,
          summary.totalFunShare,
          summary.sonarrFunFiles,
          summary.radarrFunFiles,
          summary.totalFiles,
          iso,
          iso,
        );
      },

      summary(): StatsSummary {
        const coverageHistory = db
          .prepare(
            `select
               date,
               sonarr_fun_share as sonarrFunShare,
               radarr_fun_share as radarrFunShare,
               total_fun_share as totalFunShare
             from coverage_snapshots
             order by date asc
             limit 90`,
          )
          .all() as StatsSummary["coverageHistory"];
        const dailyActivity = db
          .prepare(
            `select
               substr(created_at, 1, 10) as date,
               sum(case when action = 'analysis' then 1 else 0 end) as analyses,
               sum(case when action = 'search' then 1 else 0 end) as searches,
               sum(case when action = 'grab' then 1 else 0 end) as grabs,
               sum(case when status = 'failed' then 1 else 0 end) as failed
             from activity_log
             group by substr(created_at, 1, 10)
             order by date asc
             limit 90`,
          )
          .all() as StatsSummary["dailyActivity"];
        const totals = db
          .prepare(
            `select
               sum(case when action = 'analysis' then 1 else 0 end) as analyses,
               sum(case when action = 'search' then 1 else 0 end) as searches,
               sum(case when action = 'grab' then 1 else 0 end) as grabs,
               sum(case when status = 'failed' then 1 else 0 end) as failed
             from activity_log`,
          )
          .get() as StatsSummary["totals"];

        return {
          coverageHistory,
          dailyActivity,
          totals: {
            analyses: totals.analyses ?? 0,
            searches: totals.searches ?? 0,
            grabs: totals.grabs ?? 0,
            failed: totals.failed ?? 0,
          },
        };
      },

      mediaSummary(): {
        sonarrFunShare: number;
        radarrFunShare: number;
        totalFunShare: number;
        sonarrFunFiles: number;
        radarrFunFiles: number;
        totalFiles: number;
      } {
        const row = db
          .prepare(
            `select
               coalesce(sum(case when kind = 'series' then children_with_file else 0 end), 0) as sonarrFiles,
               coalesce(sum(case when kind = 'series' then fun_children else 0 end), 0) as sonarrFunFiles,
               coalesce(sum(case when kind = 'movie' then children_with_file else 0 end), 0) as radarrFiles,
               coalesce(sum(case when kind = 'movie' then fun_children else 0 end), 0) as radarrFunFiles,
               coalesce(sum(children_with_file), 0) as totalFiles,
               coalesce(sum(fun_children), 0) as totalFunFiles
             from media_items`,
          )
          .get() as {
          sonarrFiles: number;
          sonarrFunFiles: number;
          radarrFiles: number;
          radarrFunFiles: number;
          totalFiles: number;
          totalFunFiles: number;
        };
        return {
          sonarrFunShare: row.sonarrFiles === 0 ? 0 : row.sonarrFunFiles / row.sonarrFiles,
          radarrFunShare: row.radarrFiles === 0 ? 0 : row.radarrFunFiles / row.radarrFiles,
          totalFunShare: row.totalFiles === 0 ? 0 : row.totalFunFiles / row.totalFiles,
          sonarrFunFiles: row.sonarrFunFiles,
          radarrFunFiles: row.radarrFunFiles,
          totalFiles: row.totalFiles,
        };
      },
    },
  };
}

function booleanToNullableInt(value: boolean | undefined): 0 | 1 | null {
  return typeof value === "boolean" ? (value ? 1 : 0) : null;
}

type ScheduleRow = {
  id: number;
  name: string;
  enabled: 0 | 1;
  actionsJson: string;
  targetScope: ScheduleView["targetScope"];
  intervalKind: ScheduleView["intervalKind"];
  intervalValue: number | null;
  timeOfDay: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
};

function formatScheduleRow(row: ScheduleRow): ScheduleView {
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    actions: JSON.parse(row.actionsJson) as ScheduleView["actions"],
    targetScope: row.targetScope,
    intervalKind: row.intervalKind,
    intervalValue: row.intervalValue ?? undefined,
    timeOfDay: row.timeOfDay ?? undefined,
    nextRunAt: row.nextRunAt ?? "",
    lastRunAt: row.lastRunAt ?? undefined,
  };
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
