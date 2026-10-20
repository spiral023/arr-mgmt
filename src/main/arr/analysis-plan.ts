import type { ArrHistory } from "./arr-types";

export function selectAnalysisItems<T extends { id: number }>(
  items: T[], stored: Array<{ arrId: number; lastAnalyzedAt: string | null }>,
  changedIds: ReadonlySet<number>, now: Date, forceFull = false,
): T[] {
  const previous = new Map(stored.map((item) => [item.arrId, Date.parse(item.lastAnalyzedAt ?? "")]));
  const due = (item: T) => {
    const last = previous.get(item.id);
    return forceFull || last === undefined || !Number.isFinite(last) || last > now.getTime() ||
      now.getTime() - last >= 86_400_000 || changedIds.has(item.id);
  };
  // New titles first: interrupted scans retain their resume behavior without starving old titles.
  return items.filter(due).sort((a, b) => Number(previous.has(a.id)) - Number(previous.has(b.id)));
}

export function changedItemIds(history: ArrHistory[], kind: "sonarr" | "radarr"): Set<number> {
  return new Set(history.map((event) => kind === "sonarr" ? event.seriesId : event.movieId)
    .filter((id): id is number => Number.isSafeInteger(id) && id! > 0));
}
