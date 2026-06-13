import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUOTA_LIMITS,
  getQuotaSummaries,
  getQuotaSummary,
  getRollingUsage,
  type QuotaEvent,
} from "../../src/shared/quota";

const now = new Date("2026-06-13T12:00:00.000Z");

describe("getRollingUsage", () => {
  it("counts events created at or after the rolling window start", () => {
    const events: QuotaEvent[] = [
      { action: "search", createdAt: "2026-06-12T11:59:59.999Z" },
      { action: "search", createdAt: "2026-06-12T12:00:00.000Z" },
      { action: "grab", createdAt: "2026-06-13T00:00:00.000Z" },
      { action: "grab", createdAt: "2026-06-13T12:00:00.000Z" },
    ];

    expect(getRollingUsage(events, now, 24)).toBe(3);
  });
});

describe("quota summaries", () => {
  it("returns used, remaining, and limit for one action type", () => {
    const events: QuotaEvent[] = [
      { action: "search", createdAt: "2026-06-13T10:00:00.000Z" },
      { action: "search", createdAt: "2026-06-13T11:00:00.000Z" },
      { action: "grab", createdAt: "2026-06-13T11:30:00.000Z" },
      { action: "search", createdAt: "2026-06-12T10:00:00.000Z" },
    ];

    expect(getQuotaSummary(events, now, 24, "search", 5)).toEqual({
      action: "search",
      used: 2,
      remaining: 3,
      limit: 5,
    });
  });

  it("floors remaining quota at zero when usage exceeds the limit", () => {
    const events: QuotaEvent[] = [
      { action: "grab", createdAt: "2026-06-13T10:00:00.000Z" },
      { action: "grab", createdAt: "2026-06-13T11:00:00.000Z" },
    ];

    expect(getQuotaSummary(events, now, 24, "grab", 1)).toEqual({
      action: "grab",
      used: 2,
      remaining: 0,
      limit: 1,
    });
  });

  it("builds search and grab summaries from shared limits", () => {
    const events: QuotaEvent[] = [
      { action: "search", createdAt: "2026-06-13T11:00:00.000Z" },
      { action: "grab", createdAt: "2026-06-13T11:30:00.000Z" },
    ];

    expect(getQuotaSummaries(events, now, 24, { search: 3, grab: 2 })).toEqual({
      search: { action: "search", used: 1, remaining: 2, limit: 3 },
      grab: { action: "grab", used: 1, remaining: 1, limit: 2 },
    });
  });

  it("exports default ARR Ops quota limits", () => {
    expect(DEFAULT_QUOTA_LIMITS).toEqual({ search: 2000, grab: 400 });
  });
});
