import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Activity, CheckCircle2, Clock, Database, Download, HardDrive, Search, ShieldCheck } from "lucide-react";
import { DataTable } from "../components/DataTable";
import { StatusPill, type StatusTone } from "../components/StatusPill";

interface ActivityRow {
  action: string;
  app: "Sonarr" | "Radarr";
  at: string;
  item: string;
  quota: string;
  status: "success" | "failed" | "blocked" | "started";
}

interface ActiveJobRow {
  job: string;
  progress: string;
  status: "running" | "queued" | "blocked";
  target: string;
}

const kpis = [
  { icon: Database, label: "Total series", value: "184", detail: "Sonarr library" },
  { icon: Database, label: "Total movies", value: "2,411", detail: "Radarr library" },
  { icon: HardDrive, label: "Total files", value: "18,940", detail: "222.4 TB" },
  { icon: ShieldCheck, label: "FuN* files", value: "9,782", detail: "51.6% coverage" },
  { icon: Download, label: "FuN* size share", value: "48.3%", detail: "of stored bytes" },
  { icon: Search, label: "Search success", value: "72.4%", detail: "last 24h" },
  { icon: CheckCircle2, label: "Grab success", value: "88.1%", detail: "last 24h" },
  { icon: Clock, label: "Budget remaining", value: "1,583 / 339", detail: "search / grab" },
];

const recentActivity: ActivityRow[] = [
  { action: "search", app: "Sonarr", at: "22:01:18", item: "Criminal Record S01E07", quota: "search", status: "success" },
  { action: "grab", app: "Radarr", at: "21:58:44", item: "Nicht noch ein Teenie-Film", quota: "grab", status: "blocked" },
  { action: "analysis", app: "Radarr", at: "21:53:11", item: "2,411 movies", quota: "none", status: "success" },
  { action: "search", app: "Sonarr", at: "21:48:02", item: "Severance S02E01", quota: "search", status: "failed" },
];

const activeJobs: ActiveJobRow[] = [
  { job: "Nightly FuN analysis", progress: "418 / 2,595", status: "running", target: "all" },
  { job: "Selected movie search", progress: "0 / 34", status: "queued", target: "radarr" },
  { job: "Grab stored candidates", progress: "61 / 400 budget used", status: "blocked", target: "all" },
];

const activityTone: Record<ActivityRow["status"], StatusTone> = {
  blocked: "warning",
  failed: "danger",
  started: "running",
  success: "success",
};

const jobTone: Record<ActiveJobRow["status"], StatusTone> = {
  blocked: "warning",
  queued: "idle",
  running: "running",
};

export function DashboardView() {
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
          return <StatusPill tone={activityTone[status]}>{status}</StatusPill>;
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
