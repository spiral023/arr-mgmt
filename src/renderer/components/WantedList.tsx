import { useRef, useState } from "react";
import { invokeIpc } from "../state/ipc-client";

type WantedRow = {
  id: number; title?: string; series?: { title?: string }; seasonNumber?: number; episodeNumber?: number;
  movieFile?: { quality?: { quality?: { name?: string } } }; episodeFile?: { quality?: { quality?: { name?: string } } };
};
type WantedPage = { records: WantedRow[]; totalRecords: number };

export function WantedList({ kind }: { kind: "sonarr" | "radarr" }) {
  const [mode, setMode] = useState<"missing" | "cutoff">("missing");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<WantedPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const load = async (nextMode: typeof mode, nextPage: number) => {
    const id = ++request.current;
    setMode(nextMode); setPage(nextPage); setLoading(true); setError(false); setResult(null);
    try {
      if (!window.arrOps) throw new Error("ARR connection requires Electron");
      const next = await invokeIpc<WantedPage>("library:wanted", { kind, mode: nextMode, page: nextPage, pageSize: 20 });
      if (id === request.current) setResult(next);
    } catch { if (id === request.current) setError(true); }
    finally { if (id === request.current) setLoading(false); }
  };
  const buttonClass = "rounded-md border border-white/10 px-3 py-2 text-[12px] text-ink-200 aria-pressed:border-signal-cyan/50 aria-pressed:bg-signal-cyan/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal-cyan disabled:opacity-50";
  return (
    <details className="rounded-xl bg-ink-925 p-4 shadow-card" onToggle={(event) => {
      if (event.currentTarget.open) void load(mode, page);
      else { request.current++; setLoading(false); }
    }}>
      <summary className="cursor-pointer text-[13px] font-semibold text-ink-200">Fehlende Dateien und Qualitätsziele</summary>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={buttonClass} type="button" aria-pressed={mode === "missing"} onClick={() => void load("missing", 1)}>Verfügbar, Datei fehlt</button>
        <button className={buttonClass} type="button" aria-pressed={mode === "cutoff"} onClick={() => void load("cutoff", 1)}>Unter Qualitätsziel</button>
        <button className={buttonClass} type="button" disabled={loading} onClick={() => void load(mode, page)}>Aktualisieren</button>
      </div>
      <p className="my-3 text-[12px] text-ink-500">{mode === "missing" ? "Überwachte Einträge aus ARR; Veröffentlichungsdaten werden berücksichtigt. Einträge ohne Datei können noch unveröffentlicht sein." :
        "Überwachte Einträge unter dem Qualitätsziel des ARR-Profils; unabhängig von der FuN*-Releasegruppe."}</p>
      {loading ? <p role="status" className="text-[13px] text-ink-400">Lade ARR-Arbeitsliste…</p> : null}
      {error ? <p role="alert" className="text-[13px] text-signal-amber">Arbeitsliste nicht erreichbar. Verbindung in den Einstellungen prüfen.</p> : null}
      {result ? <>
        <p className="mb-2 text-[12px] text-ink-400">{result.totalRecords} {result.totalRecords === 1 ? "Eintrag" : "Einträge"} · Seite {page}</p>
        {result.records.length === 0 ? <p className="text-[13px] text-ink-400">Keine Einträge auf dieser Seite.</p> : <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {result.records.map((row) => <li key={row.id} className="text-[13px] text-ink-200">
            {row.series?.title ? `${row.series.title} · S${row.seasonNumber ?? "?"}E${row.episodeNumber ?? "?"} · ` : ""}{row.title ?? `#${row.id}`}
            {mode === "cutoff" ? <span className="ml-2 text-ink-500">{row.movieFile?.quality?.quality?.name ?? row.episodeFile?.quality?.quality?.name ?? "Qualität unbekannt"}</span> : null}
          </li>)}
        </ul>}
        <div className="mt-3 flex gap-2">
          <button className={buttonClass} type="button" disabled={loading || page <= 1} onClick={() => void load(mode, page - 1)}>Vorherige Seite</button>
          <button className={buttonClass} type="button" disabled={loading || page * 20 >= result.totalRecords} onClick={() => void load(mode, page + 1)}>Nächste Seite</button>
        </div>
      </> : null}
    </details>
  );
}
