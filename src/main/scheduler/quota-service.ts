import type { createRepositories } from "../db/repositories";

type Repositories = ReturnType<typeof createRepositories>;

export type QuotaAction = "search" | "grab";

export type QuotaConfig = {
  searchLimit: number;
  grabLimit: number;
  windowHours: number;
  now: () => Date;
};

export type QuotaReservation = {
  allowed: boolean;
  remaining: number;
};

export class QuotaService {
  constructor(
    private readonly repos: Repositories,
    private readonly config: QuotaConfig,
  ) {}

  reserve(action: QuotaAction, details: { message?: string; payloadJson?: string } = {}): QuotaReservation {
    const limit = this.getLimit(action);
    const used = this.repos.activityLog.countSince(action, this.config.now(), this.config.windowHours);
    const remaining = Math.max(0, limit - used);

    if (remaining <= 0) {
      this.repos.activityLog.insert({
        action,
        quotaType: action,
        status: "blocked_by_budget",
        message: details.message ?? `${action} blocked by budget`,
        payloadJson: details.payloadJson ?? null,
        createdAt: this.config.now(),
      });
      return { allowed: false, remaining: 0 };
    }

    this.repos.activityLog.insert({
      action,
      quotaType: action,
      status: "started",
      message: details.message ?? `${action} reserved`,
      payloadJson: details.payloadJson ?? null,
      createdAt: this.config.now(),
    });

    return { allowed: true, remaining: remaining - 1 };
  }

  recordManualGrab(count: number, note: string): void {
    for (let i = 0; i < count; i += 1) {
      this.repos.activityLog.insert({
        action: "manual_grab_entry",
        quotaType: "grab",
        status: "success",
        message: note,
        createdAt: this.config.now(),
      });
    }
  }

  private getLimit(action: QuotaAction): number {
    return action === "search" ? this.config.searchLimit : this.config.grabLimit;
  }
}
