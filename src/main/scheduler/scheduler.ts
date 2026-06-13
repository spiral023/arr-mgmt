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

  add(input: Omit<ScheduledJob, "id" | "nextRunAt">, now = new Date()): ScheduledJob {
    const job: ScheduledJob = {
      ...input,
      id: crypto.randomUUID(),
      nextRunAt: calculateNextRunAt(input.rule, now),
    };
    this.jobs.set(job.id, job);
    this.scheduleTick();
    return job;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  list(): ScheduledJob[] {
    return [...this.jobs.values()];
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleTick(): void {
    this.stop();
    this.timer = setTimeout(() => void this.tick(), 1_000);
  }

  private async tick(): Promise<void> {
    if (!this.paused) {
      const now = new Date();
      for (const job of this.jobs.values()) {
        if (job.enabled && job.nextRunAt <= now) {
          await job.run();
          job.nextRunAt = calculateNextRunAt(job.rule, now);
        }
      }
    }
    this.scheduleTick();
  }
}
