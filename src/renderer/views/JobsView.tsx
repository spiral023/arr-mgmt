import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, ChevronDown, Pause, Play } from "lucide-react";
import { DataTable } from "../components/DataTable";
import { IconButton } from "../components/IconButton";
import { StatusPill, type StatusTone } from "../components/StatusPill";
import { listJobEvents, listJobs, subscribeToJobEvents } from "../state/ipc-client";
import { createRefreshScheduler } from "../state/refresh-scheduler";
import type { JobEventView, JobStatus, JobView } from "../../shared/ipc-contracts";

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

const statusTone: Record<JobStatus, StatusTone> = {
  blocked_by_budget: "warning",
  cancelled: "muted",
  completed: "success",
  failed: "danger",
  queued: "idle",
  running: "running",
};

export function JobsView() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [events, setEvents] = useState<JobEventView[]>([]);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const expandedJobIdRef = useRef<string | null>(null);

  const refreshEvents = useCallback(async (jobId: string) => {
    setEvents(await listJobEvents(jobId));
  }, []);

  const refreshJobs = useCallback(async () => {
    const nextJobs = (await listJobs()).map(toJobRow);
    setJobs(nextJobs);
    const activeJobId = expandedJobIdRef.current ?? nextJobs[0]?.id ?? null;
    if (activeJobId) {
      expandedJobIdRef.current = activeJobId;
      setExpandedJobId(activeJobId);
      await refreshEvents(activeJobId);
    }
  }, [refreshEvents]);

  const selectJob = useCallback(
    (jobId: string) => {
      expandedJobIdRef.current = jobId;
      setExpandedJobId(jobId);
      void refreshEvents(jobId);
    },
    [refreshEvents],
  );

  useEffect(() => {
    void refreshJobs();
    const scheduler = createRefreshScheduler(refreshJobs, { minimumDelayMs: 1_000 });
    const interval = window.setInterval(() => scheduler.trigger(), 2_000);
    const unsubscribe = subscribeToJobEvents(() => scheduler.trigger());
    return () => {
      window.clearInterval(interval);
      unsubscribe();
      scheduler.dispose();
    };
  }, [refreshJobs]);

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
            <IconButton className="px-0" icon={ChevronDown} label={`Show events for ${row.original.job}`} onClick={() => selectJob(row.original.id)} />
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
    [selectJob],
  );

  const activeEvents = events;
  const activeJob = expandedJobId ? jobs.find((job) => job.id === expandedJobId) : undefined;

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
            <div className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[10rem_6rem_1fr]" key={`${event.createdAt}-${event.message}`}>
              <Mono>{formatDateTime(event.createdAt)}</Mono>
              <StatusPill tone={event.level === "error" ? "danger" : event.level === "warning" ? "warning" : "idle"}>{event.level}</StatusPill>
              <span className="text-ink-200">{event.message}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function toJobRow(job: JobView): JobRow {
  return {
    actions: job.kind,
    duration: formatDuration(job.startedAt, job.finishedAt),
    failure: job.failureCount,
    finished: formatDateTime(job.finishedAt),
    id: job.id,
    job: job.name,
    progressCurrent: job.progressCurrent,
    progressTotal: job.progressTotal,
    started: formatDateTime(job.startedAt),
    status: job.status,
    success: job.successCount,
    target: job.target,
  };
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

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function formatDuration(startedAt?: string, finishedAt?: string) {
  if (!startedAt) return "-";
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
}
