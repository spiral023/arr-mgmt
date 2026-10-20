import type { ArrHistory, ArrQueueItem } from "./arr-types";
import type { TransferView, TransferStatus } from "../../shared/ipc-contracts";

export function resolveTransferStatus(transfer: TransferView, history: ArrHistory[], queue: ArrQueueItem[], kind: "sonarr" | "radarr"):
  { status: TransferStatus; message: string | null; downloadId?: string } {
  const childMatches = (item: { movieId?: number; episodeId?: number }) =>
    (kind === "radarr" ? item.movieId : item.episodeId) === transfer.childArrId;
  const matching = history.filter((event) => childMatches(event) &&
    Date.parse(event.date) >= Date.parse(transfer.grabbedAt) &&
    (transfer.downloadId ? event.downloadId === transfer.downloadId : event.sourceTitle === transfer.title))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || b.id - a.id);
  const downloadId = transfer.downloadId ?? matching.find((event) => event.downloadId)?.downloadId;
  const terminal = matching.find((event) => ["downloadFolderImported", "downloadFailed", "downloadIgnored"].includes(event.eventType));
  if (terminal) {
    return { status: terminal.eventType === "downloadFolderImported" ? "imported" : "failed",
      message: terminal.data?.message ?? terminal.eventType, downloadId: downloadId ?? undefined };
  }
  const active = queue.find((item) => childMatches(item) &&
    (downloadId ? item.downloadId === downloadId : item.title === transfer.title));
  if (active) {
    const state = active.trackedDownloadState?.toLowerCase() ?? "";
    const warning = active.trackedDownloadStatus?.toLowerCase() === "warning";
    return { status: state === "importfailed" || state === "downloadfailed" ? "failed" :
      state.includes("import") || active.status === "completed" ? "importing" : "downloading",
      message: active.statusMessages?.flatMap((message) => [message.title, ...(message.messages ?? [])]).filter(Boolean).join("; ") ||
        (warning ? "ARR reports a warning" : active.status ?? null), downloadId: active.downloadId ?? downloadId ?? undefined };
  }
  return { status: "unknown", message: "Kein aktiver Download und kein bestätigter Import gefunden.", downloadId: downloadId ?? undefined };
}
