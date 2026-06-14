import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";
import { Activity, CheckCircle2, Clock, Database, Download, HardDrive, Search, ShieldCheck } from "lucide-react";
import { DataTable } from "../components/DataTable";
import { StatusPill, type StatusTone } from "../components/StatusPill";
import { getLibrarySummary, getQuotaSummary, getRecentActivity, listJobs, subscribeToJobEvents } from "../state/ipc-client";
import type { ActivityRowView, JobView } from "../../shared/ipc-contracts";

type ActivityRow = ActivityRowView;

interface ActiveJobRow {
  job: string;
  progress: string;
  status: "running" | "queued" | "blocked_by_budget" | "completed" | "failed" | "cancelled";
  target: string;
}

const activityTone: Record<string, StatusTone> = {
  blocked_by_budget: "warning",
  failed: "danger",
  skipped: "muted",
  started: "running",
  success: "success",
};

const jobTone: Record<ActiveJobRow["status"], StatusTone> = {
  blocked_by_budget: "warning",
  cancelled: "muted",
  completed: "success",
  failed: "danger",
  queued: "idle",
  running: "running",
};

export function DashboardView() {
  const [kpis, setKpis] = useState<Array<{ icon: LucideIcon; label: string; value: string; detail: string }>>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityRow[]>([]);
  const [activeJobs, setActiveJobs] = useState<ActiveJobRow[]>([]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    const unsubscribe = subscribeToJobEvents(() => void refresh());
    return () => {
      window.clearInterval(interval);
      unsubscribe();
    };
  }, []);

  async function refresh() {
    const [summary, quota, activityRows, jobs] = await Promise.all([getLibrarySummary(), getQuotaSummary(), getRecentActivity(), listJobs()]);
    const activeJobRows: ActiveJobRow[] = [];
    for (const job of jobs) {
      if (job.status === "running" || job.status === "queued" || job.status === "blocked_by_budget") {
        activeJobRows.push(toActiveJobRow(job));
      }
    }
    setRecentActivity(activityRows);
    setActiveJobs(activeJobRows);
    setKpis([
      { icon: Database, label: "Total series", value: String(summary.totalSeries), detail: "Sonarr library" },
      { icon: Database, label: "Total movies", value: String(summary.totalMovies), detail: "Radarr library" },
      { icon: HardDrive, label: "Total files", value: String(summary.totalFiles), detail: formatBytes(summary.totalSizeBytes) },
      { icon: ShieldCheck, label: "FuN* files", value: String(summary.funFiles), detail: `${Math.round(summary.funShare * 100)}% coverage` },
      { icon: Download, label: "FuN* size share", value: `${Math.round(summary.funShare * 100)}%`, detail: "of files" },
      { icon: Search, label: "Search budget", value: String(quota.search.remaining), detail: `${quota.search.used} used / ${quota.search.limit}` },
      { icon: CheckCircle2, label: "Grab budget", value: String(quota.grab.remaining), detail: `${quota.grab.used} used / ${quota.grab.limit}` },
      { icon: Clock, label: "Active jobs", value: String(jobs.filter((job) => job.status === "running").length), detail: `${jobs.filter((job) => job.status === "queued").length} queued` },
    ]);
  }

  const activityColumns = useMemo<Array<ColumnDef<ActivityRow, unknown>>>(
    () => [
      { accessorKey: "at", cell: ({ getValue }) => <Mono>{getValue<string>()}</Mono>, header: "Time", size: 96 },
      { accessorKey: "app", header: "App", size: 96 },
      { accessorKey: "action", header: "Action", size: 104 },
      { accessorKey: "item", header: "Item", size: 280 },
      { accessorKey: "quota", header: "Quota", size: 96 },
      {
        accessorKey: "status",
        cell: ({ getValue }) => {
          const status = getValue<ActivityRow["status"]>();
          return <StatusPill tone={activityTone[status] ?? "idle"}>{status}</StatusPill>;
        },
        header: "Status",
        size: 112,
      },
    ],
    [],
  );
  const jobColumns = useMemo<Array<ColumnDef<ActiveJobRow, unknown>>>(
    () => [
      { accessorKey: "job", cell: ({ getValue }) => <span className="font-semibold text-white">{getValue<string>()}</span>, header: "Job", size: 220 },
      { accessorKey: "target", header: "Target", size: 96 },
      { accessorKey: "progress", cell: ({ getValue }) => <Mono>{getValue<string>()}</Mono>, header: "Progress", size: 150 },
      {
        accessorKey: "status",
        cell: ({ getValue }) => {
          const status = getValue<ActiveJobRow["status"]>();
          return <StatusPill tone={jobTone[status]}>{status}</StatusPill>;
        },
        header: "Status",
        size: 112,
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div className="rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface" key={kpi.label}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-400">{kpi.label}</span>
                <Icon aria-hidden="true" className="h-4 w-4 text-signal-cyan" />
              </div>
              <div className="mt-3 font-mono text-2xl font-semibold text-white tabular-nums">{kpi.value}</div>
              <div className="mt-1 text-sm text-ink-400">{kpi.detail}</div>
            </div>
          );
        })}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <DataTable columns={activityColumns} data={recentActivity} searchPlaceholder="Filter activity" title="Recent Activity" />
        <DataTable columns={jobColumns} data={activeJobs} searchPlaceholder="Filter jobs" title="Active Jobs" />
      </div>
    </div>
  );
}

function Mono({ children }: { children: string }) {
  return <span className="font-mono tabular-nums text-ink-200">{children}</span>;
}

function toActiveJobRow(job: JobView): ActiveJobRow {
  return {
    job: job.name,
    progress: `${job.progressCurrent} / ${job.progressTotal}`,
    status: job.status,
    target: job.target,
  };
}

function formatBytes(value: number) {
  if (value === 0) return "0 GB";
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)} TB`;
  return `${(value / 1_000_000_000).toFixed(1)} GB`;
}
