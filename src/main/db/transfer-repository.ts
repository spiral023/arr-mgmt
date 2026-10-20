import type { AppDatabase } from "./client";
import type { TransferView, TransferStatus } from "../../shared/ipc-contracts";

const fields = `id, instance_id as instanceId, media_item_id as mediaItemId, child_arr_id as childArrId,
 title, download_id as downloadId, status, message, grabbed_at as grabbedAt, checked_at as checkedAt, source_url as sourceUrl`;
export function createTransferRepository(db: AppDatabase) {
  return {
    record(input: { instanceId: number; mediaItemId: number; childArrId: number; title: string; downloadId?: string; grabbedAt: string }) {
      return Number(db.prepare(`insert into transfers(instance_id, media_item_id, child_arr_id, title, download_id, grabbed_at, source_url)
        values (?, ?, ?, ?, ?, ?, (select base_url from instances where id = ?))`)
        .run(input.instanceId, input.mediaItemId, input.childArrId, input.title, input.downloadId ?? null, input.grabbedAt, input.instanceId).lastInsertRowid);
    },
    list(mediaItemId?: number): TransferView[] {
      return db.prepare(`select ${fields} from transfers where (? is null or media_item_id = ?) order by id desc limit 200`)
        .all(mediaItemId ?? null, mediaItemId ?? null) as TransferView[];
    },
    pending(instanceId: number): TransferView[] {
      return db.prepare(`select ${fields} from transfers where instance_id = ? and status <> 'imported' order by id`)
        .all(instanceId) as TransferView[];
    },
    update(id: number, status: TransferStatus, message: string | null, checkedAt: string, downloadId?: string) {
      db.prepare(`update transfers set status = ?, message = ?, checked_at = ?, download_id = coalesce(?, download_id)
        where id = ? and status <> 'imported' and (checked_at is null or checked_at <= ?)`)
        .run(status, message, checkedAt, downloadId ?? null, id, checkedAt);
    },
  };
}
