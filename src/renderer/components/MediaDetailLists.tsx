import { clsx } from "clsx";
import { useState } from "react";
import type { MediaItemDetails, NonFunFileView } from "../../shared/ipc-contracts";
import { invokeIpc } from "../state/ipc-client";

export function MediaDetailLists({
  details,
  kind,
  loading,
}: {
  details: MediaItemDetails | null;
  kind: "series" | "movie";
  loading: boolean;
}) {
  const [snapshot, setSnapshot] = useState<{ source: MediaItemDetails; result: MediaItemDetails } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const current = snapshot?.source === details ? snapshot.result : details;
  const refresh = async () => {
    if (!details || refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const result = await invokeIpc<MediaItemDetails>("library:refreshTransfers", { kind, arrId: details.arrId });
      setSnapshot({ source: details, result });
    } catch {
      setRefreshError("Status konnte nicht aktualisiert werden. Der letzte bekannte Stand bleibt sichtbar.");
    } finally { setRefreshing(false); }
  };
  const missingTitle = kind === "series" ? "Fehlende FuN*-Folgen" : "Fehlende FuN*-Datei";
  const missingEmpty = kind === "series" ? "Keine Non-FuN*-Folgen gefunden." : "Keine Non-FuN*-Datei gefunden.";

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <DetailList count={current?.nonFunFiles.length ?? 0} emptyText={missingEmpty} loading={loading} title={missingTitle}>
        {current?.nonFunFiles.map((file) => (
          <ListItem
            key={file.childArrId}
            meta={[file.quality, file.releaseGroup, formatBytes(file.sizeBytes)]}
            title={formatFileLabel(file, kind)}
          />
        ))}
      </DetailList>
      <DetailList
        count={current?.candidates.length ?? 0}
        emptyText="Noch keine Kandidaten gespeichert. Zuerst einen FuN*-Search ausführen."
        loading={loading}
        title="Beim Search gefunden"
      >
        {current?.candidates.map((candidate) => (
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
      <DetailList count={current?.files?.length ?? 0} emptyText="Noch keine technischen Dateidaten analysiert." loading={loading} title="Dateien und Bitraten">
        {current?.files?.map((file) => (
          <ListItem key={file.childArrId} title={formatFileLabel(file, kind)} meta={[
            file.releaseGroup, file.mediaInfo?.videoCodec, file.mediaInfo?.resolution, file.mediaInfo?.audioLanguages,
            file.mediaInfo?.totalBitrateMbps != null ? `${file.mediaInfo.totalBitrateMbps.toFixed(2)} Mbit/s gesamt` : "Bitrate unbekannt",
            file.mediaInfo?.megabytesPerMinute != null ? `${file.mediaInfo.megabytesPerMinute.toFixed(1)} MB/min` : null,
            file.mediaInfo?.videoBitrateMbps != null ? `${file.mediaInfo.videoBitrateMbps.toFixed(2)} Mbit/s Video` : null,
          ]} />
        ))}
      </DetailList>
      <div className="rounded-lg border border-white/[0.07] bg-ink-950/50 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-[13px] font-semibold text-ink-200">Download und Import</h3>
          <button type="button" onClick={() => void refresh()} disabled={refreshing || loading || !details || !current?.transfers?.length}
            className="rounded-md border border-white/10 px-3 py-2 text-[12px] text-ink-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal-cyan disabled:opacity-50">
            {refreshing ? "Prüfe Status…" : "Status prüfen"}
          </button>
        </div>
        <p className="mb-2 text-[12px] text-ink-500">Ein Grab bestätigt die Übergabe. Erst die ARR-Historie bestätigt den Import.</p>
        {refreshError ? <p role="alert" className="mb-2 text-[12px] text-signal-amber">{refreshError}</p> : null}
        <ul aria-live="polite" className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {current?.transfers?.map((transfer) => (
            <ListItem key={transfer.id} title={transfer.title} meta={[
              transferLabels[transfer.status], transfer.message,
              transfer.checkedAt ? `Geprüft ${new Date(transfer.checkedAt).toLocaleString()}` : "Noch nicht geprüft",
            ]} tone={transfer.status === "failed" || transfer.status === "unknown" ? "warning" : "default"} />
          ))}
        </ul>
        {!current?.transfers?.length ? <p className="text-[13px] text-ink-500">Neue Grabs werden hier nachverfolgt.</p> : null}
      </div>
    </div>
  );
}

const transferLabels = {
  grabbed: "An ARR übergeben", downloading: "Download läuft", importing: "Import ausstehend",
  imported: "Import bestätigt", failed: "Fehlgeschlagen", unknown: "Status unbekannt",
};

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
