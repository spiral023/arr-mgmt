import type { IpcState } from "../ipc";
import { SonarrClient } from "./sonarr-client";
import { RadarrClient } from "./radarr-client";
import { resolveTransferStatus } from "./transfer-status";
import { analyzeRadarrMovies, analyzeSonarrSeries } from "./analysis-service";
import type { InstanceKind } from "../../shared/ipc-contracts";
import { mapConcurrent } from "../async/map-concurrent";

export async function refreshTransfers(state: IpcState, kind: InstanceKind, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const instanceId = state.repositories.instances.findIdByKind(kind);
  if (!instanceId) return [];
  const config = state.instanceStore.getWithApiKey(kind);
  const unresolved = state.repositories.transfers.pending(instanceId);
  const pending = unresolved.filter((item) => item.sourceUrl?.replace(/\/+$/, "") === config.baseUrl.replace(/\/+$/, ""));
  const pendingIds = new Set(pending.map((item) => item.id));
  for (const transfer of unresolved.filter((item) => !pendingIds.has(item.id))) {
    state.repositories.transfers.update(transfer.id, "unknown", "Die ARR-Verbindung hat sich geändert; kein Abgleich mit einer anderen Instanz.", new Date().toISOString());
  }
  if (pending.length === 0) return state.repositories.transfers.list().filter((item) => item.instanceId === instanceId);
  const client = kind === "sonarr" ? new SonarrClient({ ...config, signal }) : new RadarrClient({ ...config, signal });
  // Bound the read workload. Older unresolved transfers remain explicitly unknown.
  const since = new Date(Math.max(Math.min(...pending.map((item) => Date.parse(item.grabbedAt))) - 10_000, Date.now() - 7 * 86_400_000)).toISOString();
  const history = await client.getHistorySince(since);
  const queue = [];
  for (let page = 1; ; page++) {
    const result = await client.getQueue(page, 100);
    queue.push(...result.records);
    if (queue.length >= result.totalRecords) break;
    if (result.records.length === 0 || page >= 100) throw new Error("Incomplete ARR queue response; transfer state was not changed");
  }
  const checkedAt = new Date().toISOString();
  const importedParents = new Set<number>();
  for (const transfer of pending) {
    const result = resolveTransferStatus(transfer, history, queue, kind);
    if (result.status === "imported") {
      const arrId = state.repositories.mediaItems.findArrId(transfer.mediaItemId);
      if (arrId) importedParents.add(arrId);
    }
    // Imported transitions are committed after refreshing the actual files below.
    if (result.status !== "imported") state.repositories.transfers.update(transfer.id, result.status, result.message, checkedAt, result.downloadId);
  }
  for (const arrId of importedParents) {
    const qualityProfileName = state.repositories.mediaItems.qualityProfileName(kind === "sonarr" ? "series" : "movie", arrId, instanceId);
    if (client instanceof SonarrClient) {
      const [series, episodes] = await Promise.all([client.getSeriesById(arrId), client.getEpisodes(arrId, true)]);
      state.repositories.mediaItems.upsertAnalysis(instanceId, analyzeSonarrSeries(series, episodes, new Date(), qualityProfileName));
    } else {
      state.repositories.mediaItems.upsertAnalysis(instanceId, analyzeRadarrMovies([await client.getMovie(arrId)], new Date(), qualityProfileName).items[0]);
    }
  }
  for (const transfer of pending) {
    const result = resolveTransferStatus(transfer, history, queue, kind);
    if (result.status === "imported") state.repositories.transfers.update(transfer.id, result.status, result.message, checkedAt, result.downloadId);
  }
  return state.repositories.transfers.list().filter((item) => item.instanceId === instanceId);
}

export async function getWanted(state: IpcState, kind: InstanceKind, mode: "missing" | "cutoff", page = 1, pageSize = 20) {
  const config = state.instanceStore.getWithApiKey(kind);
  if (kind === "sonarr") return new SonarrClient(config).getWanted(mode, page, pageSize);
  const client = new RadarrClient(config);
  const result = await client.getWanted(mode, page, pageSize);
  if (mode === "cutoff") {
    result.records = await mapConcurrent(result.records, 4, async (movie) => {
      const movieFileId = movie.movieFileId;
      if (typeof movieFileId !== "number" || movie.movieFile) return movie;
      return { ...movie, movieFile: await client.getMovieFile(movieFileId) };
    });
  }
  return result;
}
