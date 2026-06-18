import { describe, expect, it } from "vitest";
import {
  getAutomationSafetyLimit,
  nextQuotaEligibleAt,
  shouldStopForQuotaSafety,
} from "../../src/main/automation/quota-safety";

describe("automation quota safety", () => {
  it("calculates the floor safety limit", () => {
    expect(getAutomationSafetyLimit(10000, 90)).toBe(9000);
    expect(getAutomationSafetyLimit(401, 90)).toBe(360);
  });

  it("stops when used quota reaches the safety limit", () => {
    expect(shouldStopForQuotaSafety({ used: 8999, limit: 10000, stopAtPercent: 90 })).toBe(false);
    expect(shouldStopForQuotaSafety({ used: 9000, limit: 10000, stopAtPercent: 90 })).toBe(true);
  });

  it("returns the next quota eligibility date after the minimum delay", () => {
    expect(nextQuotaEligibleAt(new Date("2026-06-18T12:00:00.000Z"), 24).toISOString()).toBe(
      "2026-06-19T12:00:00.000Z",
    );
  });
});
