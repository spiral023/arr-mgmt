import { calculateNextRunAt, type ScheduleRule } from "../../shared/schedule";

export type ScheduledJob = {
  id: string;
  name: string;
  enabled: boolean;
  rule: ScheduleRule;
  nextRunAt: Date;
  run: () => Promise<void>;
};

export class Scheduler {
  private readonly jobs = new Map<string, ScheduledJob>();
  private timer: NodeJS.Timeout | null = null;
  private paused = false;
  private stopped = false;
  private ticking = false;
  private readonly pauseListeners = new Set<(paused: boolean) => void>();

  constructor(private readonly onError: (error: unknown, job: ScheduledJob) => void = (error, job) => {
    console.error(`Scheduled job failed: ${job.name}`, error);
  }) {}

  add(input: Omit<ScheduledJob, "id" | "nextRunAt">, now = new Date()): ScheduledJob {
    return this.upsert(input, now);
  }

  upsert(input: Omit<ScheduledJob, "id" | "nextRunAt"> & { id?: string }, now = new Date()): ScheduledJob {
    const job: ScheduledJob = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      nextRunAt: calculateNextRunAt(input.rule, now),
    };
    this.jobs.set(job.id, job);
    this.stopped = false;
    this.scheduleTick();
    return job;
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    for (const listener of this.pauseListeners) listener(paused);
  }

  isPaused(): boolean {
    return this.paused;
  }

  onPauseChange(listener: (paused: boolean) => void): () => void {
    this.pauseListeners.add(listener);
    return () => { this.pauseListeners.delete(listener); };
  }

  list(): ScheduledJob[] {
    return [...this.jobs.values()];
  }

  remove(id: string): void {
    this.jobs.delete(id);
    if (this.jobs.size === 0) {
      this.stop();
    }
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleTick(): void {
    if (this.stopped || this.ticking || this.jobs.size === 0) return;
    this.clearTimer();
    this.timer = setTimeout(() => void this.tick(), 1_000);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.timer = null;
    this.ticking = true;
    try {
      if (!this.paused && !this.stopped) {
        const now = new Date();
        for (const job of this.jobs.values()) {
          if (this.paused || this.stopped) break;
          if (job.enabled && job.nextRunAt <= now) {
            try {
              await job.run();
            } catch (error) {
              this.onError(error, job);
            } finally {
              job.nextRunAt = calculateNextRunAt(job.rule, new Date());
            }
          }
        }
      }
    } finally {
      this.ticking = false;
      this.scheduleTick();
    }
  }
}
