import type { NotificationAdapter } from "../notifications";

export type JobKind = "analysis" | "search" | "grab" | "combined";
export type JobStatus = "queued" | "running" | "blocked_by_budget" | "completed" | "failed" | "cancelled";

export type Job = {
  id: string;
  name: string;
  kind: JobKind;
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

export type JobTask = {
  name: string;
  kind: JobKind;
  steps: Array<() => Promise<void>>;
};

export class JobRunner {
  private readonly jobs = new Map<string, Job>();
  private readonly events: JobEvent[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly notifications: NotificationAdapter) {}

  enqueue(task: JobTask): Job {
    const job: Job = {
      id: crypto.randomUUID(),
      name: task.name,
      kind: task.kind,
      status: "queued",
      progressCurrent: 0,
      progressTotal: task.steps.length,
      successCount: 0,
      failureCount: 0,
      createdAt: new Date().toISOString(),
    };

    this.jobs.set(job.id, job);
    this.queue = this.queue.then(() => this.run(job.id, task)).catch(() => undefined);
    return job;
  }

  listJobs(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listEvents(jobId?: string): JobEvent[] {
    return jobId ? this.events.filter((event) => event.jobId === jobId) : [...this.events];
  }

  private async run(jobId: string, task: JobTask): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = "running";
    job.startedAt = new Date().toISOString();
    this.addEvent(job.id, "info", `${job.name} started`);

    try {
      for (const step of task.steps) {
        await step();
        job.progressCurrent += 1;
        job.successCount += 1;
      }
      job.status = "completed";
      this.addEvent(job.id, "info", `${job.name} completed`);
      this.notifications.show({ title: "ARR Ops job completed", body: job.name });
    } catch (error) {
      job.status = "failed";
      job.failureCount += 1;
      this.addEvent(job.id, "error", error instanceof Error ? error.message : String(error));
      this.notifications.show({ title: "ARR Ops job failed", body: job.name });
    } finally {
      job.finishedAt = new Date().toISOString();
    }
  }

  private addEvent(jobId: string, level: JobEvent["level"], message: string): void {
    this.events.push({ jobId, level, message, createdAt: new Date().toISOString() });
  }
}
