import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";
import { Activity, LineChart, Search, ShieldCheck, Zap } from "lucide-react";
import { DataTable } from "../components/DataTable";
import { getStatsSummary, subscribeToJobEvents } from "../state/ipc-client";
import { createRefreshScheduler } from "../state/refresh-scheduler";
import type { DailyActivityPoint, StatsSummary } from "../../shared/ipc-contracts";

const emptyStats: StatsSummary = {
  coverageHistory: [],
  dailyActivity: [],
  totals: { analyses: 0, failed: 0, grabs: 0, searches: 0 },
};

export function StatsView() {
  const [stats, setStats] = useState<StatsSummary>(emptyStats);

  useEffect(() => {
    void refresh();
    const scheduler = createRefreshScheduler(refresh, { minimumDelayMs: 2_000 });
    const interval = window.setInterval(() => scheduler.trigger(), 10_000);
    const unsubscribe = subscribeToJobEvents(() => scheduler.trigger());
    return () => {
      window.clearInterval(interval);
      unsubscribe();
      scheduler.dispose();
    };
  }, []);

  async function refresh() {
    setStats(await getStatsSummary());
  }

  const latest = stats.coverageHistory.at(-1);
  const previous = stats.coverageHistory.at(-2);
  const totalDelta = latest && previous ? latest.totalFunShare - previous.totalFunShare : 0;
  const activityColumns = useMemo<Array<ColumnDef<DailyActivityPoint, unknown>>>(
    () => [
      { accessorKey: "date", header: "Date", size: 120 },
      { accessorKey: "analyses", cell: ({ getValue }) => <Mono>{String(getValue<number>())}</Mono>, header: "Analyses", size: 100 },
      { accessorKey: "searches", cell: ({ getValue }) => <Mono>{String(getValue<number>())}</Mono>, header: "Searches", size: 100 },
      { accessorKey: "grabs", cell: ({ getValue }) => <Mono>{String(getValue<number>())}</Mono>, header: "Grabs", size: 100 },
      { accessorKey: "failed", cell: ({ getValue }) => <Mono>{String(getValue<number>())}</Mono>, header: "Failed", size: 100 },
    ],
    [],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_0.85fr]">
      <section className="rounded-lg bg-ink-900/80 p-4 shadow-surface">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">FuN* Coverage History</h2>
            <p className="mt-1 text-sm text-ink-400">Daily stored snapshots for Sonarr, Radarr, and total library coverage.</p>
          </div>
          <LineChart aria-hidden="true" className="h-5 w-5 text-signal-cyan" />
        </div>
        <div className="mt-5 flex h-72 items-end gap-2 overflow-x-auto rounded-md bg-ink-950/60 p-3 shadow-surface">
          {stats.coverageHistory.length > 0 ? (
            stats.coverageHistory.map((point) => (
              <div className="flex min-w-14 flex-1 flex-col items-center gap-2" key={point.date}>
                <div className="flex h-52 items-end gap-1">
                  <Bar value={point.sonarrFunShare} className="bg-signal-cyan" />
                  <Bar value={point.radarrFunShare} className="bg-signal-amber" />
                  <Bar value={point.totalFunShare} className="bg-signal-green" />
                </div>
                <span className="font-mono text-[11px] tabular-nums text-ink-400">{point.date.slice(5)}</span>
              </div>
            ))
          ) : (
            <div className="m-auto text-sm text-ink-400">No coverage snapshots yet.</div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-400">
          <Legend color="bg-signal-cyan" label="Sonarr" />
          <Legend color="bg-signal-amber" label="Radarr" />
          <Legend color="bg-signal-green" label="Total" />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Insight icon={ShieldCheck} label="Latest total coverage" value={latest ? formatPercent(latest.totalFunShare) : "-"} detail={`${formatSignedPercent(totalDelta)} since previous snapshot`} />
        <Insight icon={Search} label="Daily searches" value={String(stats.totals.searches)} detail="all recorded search actions" />
        <Insight icon={Zap} label="Daily grabs" value={String(stats.totals.grabs)} detail="successful and failed grab activity" />
        <Insight icon={Activity} label="Failures" value={String(stats.totals.failed)} detail="actions marked failed" />
      </section>

      <div className="xl:col-span-2">
        <DataTable columns={activityColumns} data={stats.dailyActivity} enableColumnVisibility searchPlaceholder="Filter days" title="Daily Activity" />
      </div>
    </div>
  );
}

function Bar({ className, value }: { className: string; value: number }) {
  return <div className={`w-3 rounded-t ${className}`} style={{ height: `${Math.max(4, Math.round(value * 100))}%` }} />;
}

function Insight({ detail, icon: Icon, label, value }: { detail: string; icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink-900/80 p-4 shadow-surface">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-400">{label}</span>
        <Icon aria-hidden="true" className="h-4 w-4 text-signal-cyan" />
      </div>
      <div className="mt-3 font-mono text-2xl font-semibold text-white tabular-nums">{value}</div>
      <div className="mt-1 text-sm text-ink-400">{detail}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Mono({ children }: { children: string }) {
  return <span className="font-mono tabular-nums text-ink-200">{children}</span>;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatSignedPercent(value: number) {
  const percent = Math.round(value * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}
