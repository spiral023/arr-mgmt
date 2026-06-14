import type { AppDatabase } from "./client";
import type { ActivityInsert, QuotaType } from "./schema";
import type { ArrRelease, MediaItemAnalysis } from "../arr/arr-types";
import type { Job, JobEvent } from "../scheduler/job-runner";
import type { InstanceKind, LibrarySummary, SonarrSeriesTableRow } from "../../shared/ipc-contracts";

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
             sort_title,
             year,
             monitored,
             has_file,
             total_children,
             children_with_file,
             fun_children,
             total_size_bytes,
             fun_share,
             last_analyzed_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict(instance_id, kind, arr_id) do update set
             title = excluded.title,
             sort_title = excluded.sort_title,
             year = excluded.year,
             monitored = excluded.monitored,
             has_file = excluded.has_file,
             total_children = excluded.total_children,
             children_with_file = excluded.children_with_file,
             fun_children = excluded.fun_children,
             total_size_bytes = excluded.total_size_bytes,
             fun_share = excluded.fun_share,
             last_analyzed_at = excluded.last_analyzed_at`,
        ).run(
          instanceId,
          item.kind,
          item.arrId,
          item.title,
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
               coalesce(sum(fun_children), 0) as funFiles
             from media_items`,
          )
          .get() as {
          totalSeries: number | null;
          totalMovies: number | null;
          totalFiles: number;
          totalSizeBytes: number;
          funFiles: number;
        };
        return {
          totalSeries: row.totalSeries ?? 0,
          totalMovies: row.totalMovies ?? 0,
          totalFiles: row.totalFiles,
          totalSizeBytes: row.totalSizeBytes,
          funFiles: row.funFiles,
          funShare: row.totalFiles === 0 ? 0 : row.funFiles / row.totalFiles,
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

      listSonarrRows(): SonarrSeriesTableRow[] {
        const rows = db
          .prepare(
            `select
               mi.id,
               mi.arr_id as arrId,
               mi.title,
               mi.monitored,
               mi.has_file as hasFiles,
               mi.total_children as episodes,
               mi.children_with_file as files,
               mi.fun_children as funFiles,
               mi.total_size_bytes as totalSizeBytes,
               mi.fun_share as funShare,
               mi.last_analyzed_at as lastAnalyzed,
               (
                 select max(created_at)
                 from activity_log a
                 where a.media_item_id = mi.id and a.action = 'search'
               ) as lastSearched,
               (
                 select max(created_at)
                 from activity_log a
                 where a.media_item_id = mi.id and a.action = 'grab'
               ) as lastGrabbed
             from media_items mi
             join instances i on i.id = mi.instance_id
             where i.kind = 'sonarr' and mi.kind = 'series'
             order by mi.title collate nocase`,
          )
          .all() as Array<{
          id: number;
          arrId: number;
          title: string;
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
        }>;

        return rows.map((row) => {
          const nonFunFiles = row.files - row.funFiles;
          return {
            id: `series-${row.arrId}`,
            arrId: row.arrId,
            title: row.title,
            monitored: Boolean(row.monitored),
            episodes: row.episodes,
            files: row.files,
            totalSizeBytes: row.totalSizeBytes,
            funFiles: row.funFiles,
            funShare: row.funShare,
            nonFunFiles,
            hasFiles: Boolean(row.hasFiles),
            lastAnalyzed: row.lastAnalyzed ?? "-",
            lastSearched: row.lastSearched ?? "-",
            lastGrabbed: row.lastGrabbed ?? "-",
            status: nonFunFiles > 0 && row.funFiles > 0 ? "searchable" : "ready",
          };
        });
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

      countSince(quotaType: Exclude<QuotaType, "none">, now: Date, windowHours: number): number {
        const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000).toISOString();
        const row = db
          .prepare(
            `select count(*) as count
             from activity_log
             where quota_type = ?
               and created_at >= ?
               and created_at <= ?
               and status in ('started', 'success')`,
          )
          .get(quotaType, since, toIso(now)) as { count: number };
        return row.count;
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
  };
}

function booleanToNullableInt(value: boolean | undefined): 0 | 1 | null {
  return typeof value === "boolean" ? (value ? 1 : 0) : null;
}
