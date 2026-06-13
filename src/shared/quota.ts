import { QUOTA_ACTION_TYPES, type DateInput, type QuotaActionType } from "./domain";

export type QuotaEvent = {
  action: QuotaActionType;
  createdAt: DateInput;
};

export type QuotaLimits = Record<QuotaActionType, number>;

export type QuotaSummary = {
  action: QuotaActionType;
  used: number;
  remaining: number;
  limit: number;
};

export const DEFAULT_QUOTA_LIMITS: QuotaLimits = {
  search: 2000,
  grab: 400,
};

export function getRollingUsage(
  events: readonly QuotaEvent[],
  now: DateInput,
  windowHours: number,
): number {
  const nowMs = toTimestamp(now);
  const windowStartMs = nowMs - windowHours * 60 * 60 * 1000;

  return events.filter((event) => {
    const createdAtMs = toTimestamp(event.createdAt);
    return createdAtMs >= windowStartMs && createdAtMs <= nowMs;
  }).length;
}

export function getQuotaSummary(
  events: readonly QuotaEvent[],
  now: DateInput,
  windowHours: number,
  action: QuotaActionType,
  limit: number,
): QuotaSummary {
  const used = getRollingUsage(
    events.filter((event) => event.action === action),
    now,
    windowHours,
  );

  return {
    action,
    used,
    remaining: Math.max(limit - used, 0),
    limit,
  };
}

export function getQuotaSummaries(
  events: readonly QuotaEvent[],
  now: DateInput,
  windowHours: number,
  limits: QuotaLimits = DEFAULT_QUOTA_LIMITS,
): Record<QuotaActionType, QuotaSummary> {
  return {
    search: getQuotaSummary(events, now, windowHours, QUOTA_ACTION_TYPES[0], limits.search),
    grab: getQuotaSummary(events, now, windowHours, QUOTA_ACTION_TYPES[1], limits.grab),
  };
}

function toTimestamp(value: DateInput): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}
