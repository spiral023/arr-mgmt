import type { NotificationAdapter } from "../notifications";

export type JobKind = "analysis" | "search" | "grab" | "combined";
export type JobStatus = "queued" | "running" | "blocked_by_budget" | "completed" | "failed" | "cancelled";

export type Job = {
  id: string;
  name: string;
  kind: JobKind;
  target: "all" | "sonarr" | "radarr" | "selected";
  status: JobStatus;
  progressCurrent: number;
  progressTotal: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type JobEvent = {
  jobId: string;
  level: "info" | "warning" | "error";
  message: string;
  createdAt: string;
};

export type JobRunnerChange = {
  type: "job" | "event";
  job: Job;
  event?: JobEvent;
};

export type JobContext = {
  addEvent: (level: JobEvent["level"], message: string) => void;
  incrementProgress: (options?: { failed?: boolean }) => void;
  setProgress: (current: number, total?: number) => void;
  setProgressTotal: (total: number) => void;
};

export type JobTask = {
  name: string;
  kind: JobKind;
  target?: Job["target"];
  progressTotal?: number;
  run?: (context: JobContext) => Promise<void>;
  steps?: Array<() => Promise<void>>;
};

export type JobRunnerPersistence = {
  list?: () => Job[];
  listEvents?: (jobId?: string) => JobEvent[];
  upsert?: (job: Job) => void;
  insertEvent?: (event: JobEvent) => void;
};

export type JobRunnerOptions = {
  onChange?: (event: JobRunnerChange) => void;
  persistence?: JobRunnerPersistence;
};

export class JobRunner {
  private readonly jobs = new Map<string, Job>();
  private readonly events: JobEvent[] = [];
  private readonly waiting = new Map<string, Array<() => void>>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly notifications: NotificationAdapter,
    private readonly options: JobRunnerOptions = {},
  ) {
    for (const job of options.persistence?.list?.() ?? []) {
      this.jobs.set(job.id, job);
    }
    this.events.push(...(options.persistence?.listEvents?.() ?? []));
  }

  enqueue(task: JobTask): Job {
    const job: Job = {
      id: crypto.randomUUID(),
      name: task.name,
      kind: task.kind,
      target: task.target ?? "all",
      status: "queued",
      progressCurrent: 0,
      progressTotal: task.progressTotal ?? task.steps?.length ?? 0,
      successCount: 0,
      failureCount: 0,
      createdAt: new Date().toISOString(),
    };

    this.jobs.set(job.id, job);
    this.persistJob(job);
    this.emitChange("job", job);
    this.queue = this.queue.then(() => this.run(job.id, task)).catch(() => undefined);
    return job;
  }

  listJobs(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listEvents(jobId?: string): JobEvent[] {
    return jobId ? this.events.filter((event) => event.jobId === jobId) : [...this.events];
  }

  async waitFor(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job && isFinished(job.status)) {
      return;
    }

    await new Promise<void>((resolve) => {
      const existing = this.waiting.get(jobId) ?? [];
      existing.push(resolve);
      this.waiting.set(jobId, existing);
    });
  }

  private async run(jobId: string, task: JobTask): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = "running";
    job.startedAt = new Date().toISOString();
    this.persistAndEmitJob(job);
    this.addEvent(job, "info", `${job.name} started`);

    const context: JobContext = {
      addEvent: (level, message) => this.addEvent(job, level, message),
      incrementProgress: (options) => {
        job.progressCurrent += 1;
        if (options?.failed) {
          job.failureCount += 1;
        } else {
          job.successCount += 1;
        }
        this.persistAndEmitJob(job);
      },
      setProgress: (current, total) => {
        job.progressCurrent = current;
        if (typeof total === "number") {
          job.progressTotal = total;
        }
        this.persistAndEmitJob(job);
      },
      setProgressTotal: (total) => {
        job.progressTotal = total;
        this.persistAndEmitJob(job);
      },
    };

    try {
      if (task.run) {
        await task.run(context);
      } else {
        for (const step of task.steps ?? []) {
          await step();
          context.incrementProgress();
        }
      }
      job.status = "completed";
      this.addEvent(job, "info", `${job.name} completed`);
      this.notifications.show({ title: "ARR Ops job completed", body: job.name });
    } catch (error) {
      job.status = "failed";
      job.failureCount += 1;
      this.addEvent(job, "error", error instanceof Error ? error.message : String(error));
      this.notifications.show({ title: "ARR Ops job failed", body: job.name });
    } finally {
      job.finishedAt = new Date().toISOString();
      this.persistAndEmitJob(job);
      for (const resolve of this.waiting.get(job.id) ?? []) {
        resolve();
      }
      this.waiting.delete(job.id);
    }
  }

  private addEvent(job: Job, level: JobEvent["level"], message: string): void {
    const event = { jobId: job.id, level, message, createdAt: new Date().toISOString() };
    this.events.push(event);
    this.options.persistence?.insertEvent?.(event);
    this.emitChange("event", job, event);
  }

  private persistAndEmitJob(job: Job): void {
    this.persistJob(job);
    this.emitChange("job", job);
  }

  private persistJob(job: Job): void {
    this.options.persistence?.upsert?.(job);
  }

  private emitChange(type: JobRunnerChange["type"], job: Job, event?: JobEvent): void {
    this.options.onChange?.({ type, job: { ...job }, event });
  }
}

function isFinished(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked_by_budget";
}
