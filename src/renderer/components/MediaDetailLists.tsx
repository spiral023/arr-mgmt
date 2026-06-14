import { clsx } from "clsx";
import type { MediaItemDetails, NonFunFileView } from "../../shared/ipc-contracts";

export function MediaDetailLists({
  details,
  kind,
  loading,
}: {
  details: MediaItemDetails | null;
  kind: "series" | "movie";
  loading: boolean;
}) {
  const missingTitle = kind === "series" ? "Fehlende FuN*-Folgen" : "Fehlende FuN*-Datei";
  const missingEmpty = kind === "series" ? "Keine Non-FuN*-Folgen gefunden." : "Keine Non-FuN*-Datei gefunden.";

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <DetailList count={details?.nonFunFiles.length ?? 0} emptyText={missingEmpty} loading={loading} title={missingTitle}>
        {details?.nonFunFiles.map((file, index) => (
          <ListItem
            key={`${file.childArrId}-${index}`}
            meta={[file.quality, file.releaseGroup, formatBytes(file.sizeBytes)]}
            title={formatFileLabel(file, kind)}
          />
        ))}
      </DetailList>
      <DetailList
        count={details?.candidates.length ?? 0}
        emptyText="Noch keine Kandidaten gespeichert. Zuerst einen FuN*-Search ausführen."
        loading={loading}
        title="Beim Search gefunden"
      >
        {details?.candidates.map((candidate) => (
          <ListItem
            key={candidate.id}
            meta={[
              candidate.quality,
              candidate.indexer,
              formatBytes(candidate.sizeBytes),
              candidate.approved === false ? "nicht freigegeben" : null,
            ]}
            title={candidate.title}
            tone={candidate.approved === false ? "warning" : "default"}
          />
        ))}
      </DetailList>
    </div>
  );
}

function DetailList({
  children,
  count,
  emptyText,
  loading,
  title,
}: {
  children: React.ReactNode;
  count: number;
  emptyText: string;
  loading: boolean;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-ink-950/50 p-3">
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500">{title}</div>
        {!loading ? (
          <span className="font-mono text-[11px] tabular-nums text-ink-500">{count}</span>
        ) : null}
      </div>
      {loading ? (
        <p className="mt-2 text-[13px] text-ink-500">Lade Details…</p>
      ) : count === 0 ? (
        <p className="mt-2 text-[13px] text-ink-500">{emptyText}</p>
      ) : (
        <ul className="mt-2 flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">{children}</ul>
      )}
    </div>
  );
}

function ListItem({
  meta,
  title,
  tone = "default",
}: {
  meta: Array<string | null | undefined>;
  title: string;
  tone?: "default" | "warning";
}) {
  const detail = meta.filter((value): value is string => Boolean(value)).join(" · ");
  return (
    <li className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
      <div className={clsx("truncate text-[13px] font-medium", tone === "warning" ? "text-signal-amber" : "text-ink-100")} title={title}>
        {title}
      </div>
      {detail ? <div className="mt-0.5 truncate font-mono text-[11.5px] text-ink-500">{detail}</div> : null}
    </li>
  );
}

function formatFileLabel(file: NonFunFileView, kind: "series" | "movie"): string {
  if (kind === "series" && file.seasonNumber !== null && file.episodeNumber !== null) {
    const code = `S${pad(file.seasonNumber)}E${pad(file.episodeNumber)}`;
    return file.relativePath ? `${code} · ${file.relativePath}` : code;
  }
  return file.relativePath ?? (file.childArrId ? `#${file.childArrId}` : "Unbekannte Datei");
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatBytes(value: number): string {
  if (!value) return "";
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)} TB`;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} GB`;
  return `${(value / 1_000_000).toFixed(0)} MB`;
}
