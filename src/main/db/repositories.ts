import type { AppDatabase } from "./client";
import type { ActivityInsert, QuotaType } from "./schema";

function toIso(date: Date): string {
  return date.toISOString();
}

export function createRepositories(db: AppDatabase) {
  return {
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
    },
  };
}
