import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatDateTime } from "../../shared/date-time";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, Check, ChevronDown, Copy, RotateCcw } from "lucide-react";
import { DataTable } from "../components/DataTable";
import { IconButton } from "../components/IconButton";
import { StatusPill, type StatusTone } from "../components/StatusPill";
import { cancelJob, listJobEvents, listJobs, resumeJob, subscribeToJobEvents } from "../state/ipc-client";
import { createRefreshScheduler } from "../state/refresh-scheduler";
import type { JobEventView, JobStatus, JobView } from "../../shared/ipc-contracts";

interface JobRow {
  actions: string;
  duration: string;
  durationSeconds?: number;
  failure: number;
  finished: string;
  finishedTimestamp?: number;
  id: string;
  job: string;
  progressCurrent: number;
  progressTotal: number;
  started: string;
  startedTimestamp?: number;
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
  const [copied, setCopied] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const expandedJobIdRef = useRef<string | null>(null);

  const refreshEvents = useCallback(async (jobId: string) => {
    const nextEvents = await listJobEvents(jobId);
    if (expandedJobIdRef.current === jobId) setEvents(nextEvents);
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

  const cancelSelectedJob = useCallback(
    async (jobId: string) => {
      await cancelJob(jobId);
      await refreshJobs();
      if (expandedJobIdRef.current === jobId) {
        await refreshEvents(jobId);
      }
    },
    [refreshEvents, refreshJobs],
  );

  const resumeSelectedJob = useCallback(
    async (jobId: string) => {
      await resumeJob(jobId);
      await refreshJobs();
    },
    [refreshJobs],
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
      {
        id: "started",
        accessorFn: (row) => row.startedTimestamp === undefined ? undefined : row.started,
        cell: ({ row }) => <Mono>{row.original.started}</Mono>,
        header: "Started", size: 150, sortDescFirst: true, sortUndefined: "last",
        sortingFn: (a, b) => (a.original.startedTimestamp ?? 0) - (b.original.startedTimestamp ?? 0),
      },
      {
        id: "finished",
        accessorFn: (row) => row.finishedTimestamp === undefined ? undefined : row.finished,
        cell: ({ row }) => <Mono>{row.original.finished}</Mono>,
        header: "Finished", size: 150, sortDescFirst: true, sortUndefined: "last",
        sortingFn: (a, b) => (a.original.finishedTimestamp ?? 0) - (b.original.finishedTimestamp ?? 0),
      },
      {
        id: "duration",
        accessorFn: (row) => row.durationSeconds === undefined ? undefined : row.duration,
        cell: ({ row }) => <Mono>{row.original.duration}</Mono>,
        header: "Duration", size: 112, sortDescFirst: true, sortUndefined: "last",
        sortingFn: (a, b) => (a.original.durationSeconds ?? 0) - (b.original.durationSeconds ?? 0),
      },
      {
        cell: ({ row }) => (
          <div className="flex gap-2">
            <IconButton className="px-0" icon={ChevronDown} label={`Show events for ${row.original.job}`} onClick={() => selectJob(row.original.id)} />
            {row.original.status === "blocked_by_budget" && row.original.actions === "combined" ? (
              <IconButton
                className="px-0"
                disabled={row.original.target === "selected"}
                icon={RotateCcw}
                label={
                  row.original.target === "selected"
                    ? "Re-select items and start pipeline again"
                    : "Resume pipeline — already processed items are skipped automatically"
                }
                onClick={() => void resumeSelectedJob(row.original.id)}
                tone="default"
              />
            ) : null}
            <IconButton
              className="px-0"
              disabled={isFinished(row.original.status)}
              icon={Ban}
              label={`Cancel ${row.original.job}`}
              onClick={() => void cancelSelectedJob(row.original.id)}
              tone="danger"
            />
          </div>
        ),
        enableSorting: false,
        header: "",
        id: "jobActions",
        size: 152,
      },
    ],
    [cancelSelectedJob, resumeSelectedJob, selectJob],
  );

  const activeEvents = events;
  const activeJob = expandedJobId ? jobs.find((job) => job.id === expandedJobId) : undefined;

  const copy = async (mode: "full" | "ai") => {
    setCopyMenuOpen(false);
    if (activeEvents.length === 0) {
      return;
    }
    const text = mode === "ai" ? buildAiLog(activeEvents, activeJob) : buildFullLog(activeEvents, activeJob);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard may be unavailable; fail silently rather than breaking the view.
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <DataTable columns={columns} data={jobs} getRowId={(row) => row.id} initialSorting={[{ id: "started", desc: true }]} searchPlaceholder="Filter jobs" title="Jobs" />

      <section className="rounded-lg border border-white/10 bg-ink-900/80 p-4 shadow-surface">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Job Events</h2>
            <p className="mt-1 text-sm text-ink-400">{activeJob ? activeJob.job : "Select a job"} event stream</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <IconButton
                aria-expanded={copyMenuOpen}
                disabled={activeEvents.length === 0}
                icon={copied ? Check : Copy}
                label="Copy job log to clipboard"
                onClick={() => setCopyMenuOpen((open) => !open)}
                tone={copied ? "success" : "default"}
              >
                <span className="flex items-center gap-1">
                  {copied ? "Copied" : "Copy log"}
                  <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
              </IconButton>
              {copyMenuOpen ? (
                <>
                  <button
                    aria-label="Close copy menu"
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={() => setCopyMenuOpen(false)}
                    tabIndex={-1}
                    type="button"
                  />
                  <div className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-md border border-white/10 bg-ink-900 shadow-card">
                    <CopyOption
                      description="Every event, tab-separated"
                      label="Full log"
                      onClick={() => void copy("full")}
                    />
                    <CopyOption
                      description="Compressed: warnings, key events & collapsed repeats"
                      label="Compressed for AI"
                      onClick={() => void copy("ai")}
                    />
                  </div>
                </>
              ) : null}
            </div>
            {activeJob ? <StatusPill tone={statusTone[activeJob.status]}>{activeJob.status}</StatusPill> : null}
          </div>
        </div>
        <JobEventList events={activeEvents} jobId={expandedJobId} />
      </section>
    </div>
  );
}

function JobEventList({ events, jobId }: { events: JobEventView[]; jobId: string | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 76,
    initialRect: { width: 800, height: 520 },
    overscan: 6,
  });
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    virtualizer.measure();
  }, [jobId, virtualizer]);
  return (
    <div aria-label="Job events" className="mt-4 max-h-[32rem] overflow-auto rounded-md border border-white/10 bg-ink-950/60" ref={scrollRef} tabIndex={0}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const event = events[item.index];
          return (
            <div className="absolute left-0 top-0 grid w-full gap-2 border-b border-white/10 px-3 py-3 text-sm md:grid-cols-[10rem_6rem_1fr]"
              data-index={item.index} key={`${jobId}-${item.key}`} ref={virtualizer.measureElement} style={{ transform: `translateY(${item.start}px)` }}>
              <Mono>{formatDateTime(event.createdAt)}</Mono>
              <StatusPill tone={event.level === "error" ? "danger" : event.level === "warning" ? "warning" : "idle"}>{event.level}</StatusPill>
              <span className="break-words text-ink-200">{event.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isFinished(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked_by_budget";
}

function toJobRow(job: JobView): JobRow {
  const startedTimestamp = toTimestamp(job.startedAt);
  const finishedTimestamp = toTimestamp(job.finishedAt);
  const durationSeconds = startedTimestamp === undefined || (job.finishedAt && finishedTimestamp === undefined)
    ? undefined
    : Math.max(0, Math.floor(((finishedTimestamp ?? Date.now()) - startedTimestamp) / 1000));
  return {
    actions: job.kind,
    duration: formatDuration(durationSeconds),
    durationSeconds,
    failure: job.failureCount,
    finished: formatDateTime(job.finishedAt),
    finishedTimestamp,
    id: job.id,
    job: job.name,
    progressCurrent: job.progressCurrent,
    progressTotal: job.progressTotal,
    started: formatDateTime(job.startedAt),
    startedTimestamp,
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

function CopyOption({ description, label, onClick }: { description: string; label: string; onClick: () => void }) {
  return (
    <button
      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm text-ink-200 transition-colors hover:bg-white/[0.06] hover:text-white"
      onClick={onClick}
      type="button"
    >
      <span className="font-medium">{label}</span>
      <span className="text-xs text-ink-400">{description}</span>
    </button>
  );
}

function buildJobHeader(job?: JobRow): string {
  return job
    ? `# ${job.job} (${job.status}) — ${job.actions}/${job.target}, ${job.success} ok / ${job.failure} failed, duration ${job.duration}`
    : "# Job log";
}

function buildFullLog(events: JobEventView[], job?: JobRow): string {
  const lines = events.map((event) => `${formatDateTime(event.createdAt)}\t${event.level.toUpperCase()}\t${event.message}`);
  return [buildJobHeader(job), ...lines].join("\n");
}

/** Replaces volatile parts of a message (titles, ids, urls, numbers) so repeated lines collapse by shape. */
function normalizeMessage(message: string): string {
  return message
    .replace(/"[^"]*"/g, '"…"')
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hash>")
    .replace(/-?\d+(?:\.\d+)?/g, "<n>");
}

/**
 * Builds a token-frugal log for AI analysis: the job header, all warnings/errors verbatim, the key
 * unique events (start/completed/performance/pre-fetch), and the remaining repetitive info lines
 * collapsed into "N× <shape>" buckets. Turns hundreds of near-identical lines into a handful.
 */
function buildAiLog(events: JobEventView[], job?: JobRow): string {
  const nonInfo = events.filter((event) => event.level !== "info");
  const infos = events.filter((event) => event.level === "info");
  const isKeyEvent = (message: string) => /performance|completed|started|pre-fetch/i.test(message);
  const keyInfos = infos.filter((event) => isKeyEvent(event.message));
  const collapsible = infos.filter((event) => !isKeyEvent(event.message));

  const counts = new Map<string, number>();
  for (const event of collapsible) {
    const key = normalizeMessage(event.message);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const histogram = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([shape, count]) => `${count}× ${shape}`);

  const sections: string[] = [buildJobHeader(job)];
  if (nonInfo.length > 0) {
    sections.push("", "## Warnings & errors (verbatim)", ...nonInfo.map((event) => `${event.level.toUpperCase()}\t${event.message}`));
  }
  if (keyInfos.length > 0) {
    sections.push("", "## Key events (verbatim)", ...keyInfos.map((event) => event.message));
  }
  if (histogram.length > 0) {
    sections.push("", "## Repeated info (collapsed by shape)", ...histogram);
  }
  const emitted = nonInfo.length + keyInfos.length + histogram.length;
  sections.push("", `(${events.length} events compressed to ${emitted} lines)`);
  return sections.join("\n");
}

function toTimestamp(value?: string): number | undefined {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function formatDuration(seconds?: number) {
  if (seconds === undefined) return "-";
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
}
