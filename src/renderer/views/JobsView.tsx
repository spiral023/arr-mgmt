import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, ChevronDown, Pause, Play } from "lucide-react";
import { DataTable } from "../components/DataTable";
import { IconButton } from "../components/IconButton";
import { StatusPill, type StatusTone } from "../components/StatusPill";

type JobStatus = "running" | "queued" | "completed" | "failed" | "blocked";

interface JobRow {
  actions: string;
  duration: string;
  failure: number;
  finished: string;
  id: string;
  job: string;
  progressCurrent: number;
  progressTotal: number;
  started: string;
  status: JobStatus;
  success: number;
  target: string;
}

const jobs: JobRow[] = [
  {
    actions: "analysis, search",
    duration: "00:18:42",
    failure: 2,
    finished: "-",
    id: "job-1",
    job: "Nightly FuN analysis",
    progressCurrent: 418,
    progressTotal: 2595,
    started: "2026-06-13 21:42",
    status: "running",
    success: 416,
    target: "all",
  },
  {
    actions: "search",
    duration: "-",
    failure: 0,
    finished: "-",
    id: "job-2",
    job: "Selected movie search",
    progressCurrent: 0,
    progressTotal: 34,
    started: "-",
    status: "queued",
    success: 0,
    target: "radarr",
  },
  {
    actions: "grab",
    duration: "00:00:03",
    failure: 0,
    finished: "2026-06-13 21:58",
    id: "job-3",
    job: "Grab stored candidates",
    progressCurrent: 0,
    progressTotal: 12,
    started: "2026-06-13 21:58",
    status: "blocked",
    success: 0,
    target: "all",
  },
  {
    actions: "analysis",
    duration: "00:09:18",
    failure: 0,
    finished: "2026-06-13 20:36",
    id: "job-4",
    job: "Radarr refresh",
    progressCurrent: 2411,
    progressTotal: 2411,
    started: "2026-06-13 20:27",
    status: "completed",
    success: 2411,
    target: "radarr",
  },
];

const events: Record<string, Array<{ at: string; level: "info" | "warning" | "error"; message: string }>> = {
  "job-1": [
    { at: "21:42:09", level: "info", message: "Started combined analysis and search for all enabled instances." },
    { at: "21:56:44", level: "warning", message: "Skipped 13 Sonarr episodes due to search cooldown." },
    { at: "22:00:51", level: "info", message: "Stored 41 FuN* release candidates." },
  ],
  "job-2": [{ at: "21:59:12", level: "info", message: "Queued behind active combined job." }],
  "job-3": [{ at: "21:58:44", level: "warning", message: "Grab budget has 339 remaining but selected batch needs 401." }],
  "job-4": [{ at: "20:36:43", level: "info", message: "Completed Radarr analysis for 2,411 movies." }],
};

const statusTone: Record<JobStatus, StatusTone> = {
  blocked: "warning",
  completed: "success",
  failed: "danger",
  queued: "idle",
  running: "running",
};

export function JobsView() {
  const [expandedJobId, setExpandedJobId] = useState("job-1");

  const columns = useMemo<Array<ColumnDef<JobRow, unknown>>>(
    () => [
      {
        accessorKey: "job",
        cell: ({ getValue }) => <span className="font-semibold text-white">{getValue<string>()}</span>,
        header: "Job",
        size: 240,
      },
      { accessorKey: "actions", header: "Actions", size: 140 },
      { accessorKey: "target", header: "Target", size: 96 },
      {
        accessorKey: "status",
        cell: ({ getValue }) => {
          const status = getValue<JobStatus>();
          return <StatusPill tone={statusTone[status]}>{status}</StatusPill>;
        },
        header: "Status",
        size: 124,
      },
      {
        accessorKey: "progressCurrent",
        cell: ({ row }) => <Progress current={row.original.progressCurrent} total={row.original.progressTotal} />,
        header: "Progress",
        size: 180,
      },
      { accessorKey: "success", cell: ({ getValue }) => <Mono>{String(getValue<number>())}</Mono>, header: "Success", size: 96 },
      { accessorKey: "failure", cell: ({ getValue }) => <Mono>{String(getValue<number>())}</Mono>, header: "Failure", size: 96 },
      { accessorKey: "started", cell: ({ getValue }) => <Mono>{getValue<string>()}</Mono>, header: "Started", size: 150 },
      { accessorKey: "finished", cell: ({ getValue }) => <Mono>{getValue<string>()}</Mono>, header: "Finished", size: 150 },
      { accessorKey: "duration", cell: ({ getValue }) => <Mono>{getValue<string>()}</Mono>, header: "Duration", size: 112 },
      {
        cell: ({ row }) => (
          <div className="flex gap-2">
            <IconButton className="px-0" icon={ChevronDown} label={`Show events for ${row.original.job}`} onClick={() => setExpandedJobId(row.original.id)} />
            <IconButton className="px-0" icon={row.original.status === "queued" ? Play : Pause} label={`Toggle ${row.original.job}`} />
            <IconButton className="px-0" icon={Ban} label={`Cancel ${row.original.job}`} tone="danger" />
          </div>
        ),
        enableSorting: false,
        header: "",
        id: "jobActions",
        size: 152,
      },
    ],
    [],
  );

  const activeEvents = events[expandedJobId] ?? [];
  const activeJob = jobs.find((job) => job.id === expandedJobId);

  return (
    <div className="flex flex-col gap-4">
      <DataTable columns={columns} data={jobs} getRowId={(row) => row.id} initialSorting={[{ id: "started", desc: true }]} searchPlaceholder="Filter jobs" title="Jobs" />

      <section className="rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Job Events</h2>
            <p className="mt-1 text-sm text-ink-400">{activeJob ? activeJob.job : "Select a job"} event stream</p>
          </div>
          {activeJob ? <StatusPill tone={statusTone[activeJob.status]}>{activeJob.status}</StatusPill> : null}
        </div>
        <div className="mt-4 divide-y divide-white/10 rounded-md border border-white/10 bg-ink-950/60">
          {activeEvents.map((event) => (
            <div className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[6rem_6rem_1fr]" key={`${event.at}-${event.message}`}>
              <Mono>{event.at}</Mono>
              <StatusPill tone={event.level === "error" ? "danger" : event.level === "warning" ? "warning" : "idle"}>{event.level}</StatusPill>
              <span className="text-ink-200">{event.message}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Progress({ current, total }: { current: number; total: number }) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="min-w-36">
      <div className="flex justify-between gap-3 font-mono text-xs tabular-nums text-ink-200">
        <span>
          {current} / {total}
        </span>
        <span>{percent}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-ink-800">
        <div className="h-full rounded bg-signal-cyan" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function Mono({ children }: { children: string }) {
  return <span className="font-mono tabular-nums text-ink-200">{children}</span>;
}
