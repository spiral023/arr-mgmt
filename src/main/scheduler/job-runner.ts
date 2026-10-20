import type { NotificationAdapter } from "../notifications";

export type JobKind = "analysis" | "search" | "grab" | "combined" | "automation";
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
  jobId: string;
  signal?: AbortSignal;
  addEvent: (level: JobEvent["level"], message: string) => void;
  incrementProgress: (options?: { failed?: boolean }) => void;
  isCancelled: () => boolean;
  setProgress: (current: number, total?: number) => void;
  setProgressTotal: (total: number) => void;
  blockByBudget: (message: string) => never;
  throwIfCancelled: () => void;
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
  private readonly lastProgressFlush = new Map<string, number>();
  private readonly pendingProgress = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly activeJobs = new Set<string>();
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
    this.controllers.set(job.id, new AbortController());
    this.persistJob(job);
    this.emitChange("job", job);
    this.queue = this.queue.then(() => this.run(job.id, task)).catch(() => undefined);
    return job;
  }

  listJobs(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listEvents(jobId?: string): JobEvent[] {
    // Read full historical logs on demand, rather than keeping every event in RAM.
    if (this.options.persistence?.listEvents) return this.options.persistence.listEvents(jobId);
    return jobId ? this.events.filter((event) => event.jobId === jobId) : [...this.events];
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || isFinished(job.status)) {
      return false;
    }

    job.status = "cancelled";
    this.controllers.get(jobId)?.abort(new JobCancelledError());
    if (!this.activeJobs.has(jobId)) {
      job.finishedAt = new Date().toISOString();
    }
    this.addEvent(job, "warning", `${job.name} cancelled`);
    this.persistAndEmitJob(job);
    if (!this.activeJobs.has(jobId)) {
      this.resolveWaiters(job.id);
      this.controllers.delete(job.id);
    }
    return true;
  }

  async waitFor(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job && isFinished(job.status) && !this.activeJobs.has(jobId)) {
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
    if (job.status === "cancelled") return;

    this.activeJobs.add(jobId);
    const controller = this.controllers.get(jobId)!;
    job.status = "running";
    job.startedAt = new Date().toISOString();
    this.persistAndEmitJob(job);
    this.addEvent(job, "info", `${job.name} started`);

    const context: JobContext = {
      jobId: job.id,
      signal: controller.signal,
      addEvent: (level, message) => this.addEvent(job, level, message),
      incrementProgress: (options) => {
        if (job.status === "cancelled") {
          return;
        }
        job.progressCurrent += 1;
        if (options?.failed) {
          job.failureCount += 1;
        } else {
          job.successCount += 1;
        }
        this.updateProgress(job);
      },
      isCancelled: () => job.status === "cancelled",
      setProgress: (current, total) => {
        if (job.status === "cancelled") {
          return;
        }
        job.progressCurrent = current;
        if (typeof total === "number") {
          job.progressTotal = total;
        }
        this.updateProgress(job);
      },
      setProgressTotal: (total) => {
        if (job.status === "cancelled") {
          return;
        }
        job.progressTotal = total;
        this.updateProgress(job);
      },
      blockByBudget: (message) => {
        if (job.status !== "cancelled") {
          job.status = "blocked_by_budget";
          job.finishedAt = new Date().toISOString();
          this.addEvent(job, "warning", message);
          this.persistAndEmitJob(job);
          controller.abort(new JobBlockedByBudgetError(message));
        }
        throw new JobBlockedByBudgetError(message);
      },
      throwIfCancelled: () => {
        controller.signal.throwIfAborted();
      },
    };

    try {
      if (task.run) {
        await task.run(context);
      } else {
        for (const step of task.steps ?? []) {
          context.throwIfCancelled();
          await step();
          context.incrementProgress();
        }
      }
      if ((job.status as JobStatus) !== "cancelled" && (job.status as JobStatus) !== "blocked_by_budget") {
        job.status = "completed";
        this.addEvent(job, "info", `${job.name} completed`);
        this.notifications.show({ title: "ARR Ops job completed", body: job.name });
      }
    } catch (error) {
      if (error instanceof JobBlockedByBudgetError || (job.status as JobStatus) === "blocked_by_budget") {
        job.status = "blocked_by_budget";
      } else if (error instanceof JobCancelledError || (job.status as JobStatus) === "cancelled") {
        job.status = "cancelled";
      } else {
        job.status = "failed";
        job.failureCount += 1;
        this.addEvent(job, "error", error instanceof Error ? error.message : String(error));
        this.notifications.show({ title: "ARR Ops job failed", body: job.name });
      }
    } finally {
      job.finishedAt ??= new Date().toISOString();
      this.persistAndEmitJob(job);
      this.activeJobs.delete(job.id);
      this.controllers.delete(job.id);
      this.resolveWaiters(job.id);
    }
  }

  private resolveWaiters(jobId: string): void {
    for (const resolve of this.waiting.get(jobId) ?? []) resolve();
    this.waiting.delete(jobId);
  }

  private addEvent(job: Job, level: JobEvent["level"], message: string): void {
    const event = { jobId: job.id, level, message, createdAt: new Date().toISOString() };
    this.events.push(event);
    if (this.options.persistence?.listEvents && this.events.length > 200) this.events.splice(0, this.events.length - 200);
    this.options.persistence?.insertEvent?.(event);
    this.emitChange("event", job, event);
  }

  private persistAndEmitJob(job: Job): void {
    const pending = this.pendingProgress.get(job.id);
    if (pending !== undefined) clearTimeout(pending);
    this.pendingProgress.delete(job.id);
    this.persistJob(job);
    this.emitChange("job", job);
    if (isFinished(job.status)) this.lastProgressFlush.delete(job.id);
  }

  private updateProgress(job: Job): void {
    const elapsed = Date.now() - (this.lastProgressFlush.get(job.id) ?? -Infinity);
    if (elapsed >= 250 || (job.progressTotal > 0 && job.progressCurrent >= job.progressTotal)) {
      this.persistAndEmitJob(job);
      this.lastProgressFlush.set(job.id, Date.now());
    } else if (!this.pendingProgress.has(job.id)) {
      this.pendingProgress.set(job.id, setTimeout(() => {
        this.persistAndEmitJob(job);
        this.lastProgressFlush.set(job.id, Date.now());
      }, 250 - elapsed));
    }
  }

  private persistJob(job: Job): void {
    this.options.persistence?.upsert?.(job);
  }

  private emitChange(type: JobRunnerChange["type"], job: Job, event?: JobEvent): void {
    this.options.onChange?.({ type, job: { ...job }, event });
  }
}

class JobCancelledError extends Error {
  constructor() {
    super("Job cancelled");
  }
}

class JobBlockedByBudgetError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function isFinished(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked_by_budget";
}
