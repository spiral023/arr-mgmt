import { describe, expect, it } from "vitest";
import { calculateNextRunAt } from "../../src/shared/schedule";

describe("calculateNextRunAt", () => {
  it("adds minute intervals after the provided now", () => {
    const next = calculateNextRunAt(
      { intervalKind: "minutes", intervalValue: 15 },
      new Date("2026-06-13T12:00:00.000Z"),
    );

    expect(next.toISOString()).toBe("2026-06-13T12:15:00.000Z");
  });

  it("adds hour intervals after the provided now", () => {
    const next = calculateNextRunAt(
      { intervalKind: "hours", intervalValue: 2 },
      new Date("2026-06-13T12:00:00.000Z"),
    );

    expect(next.toISOString()).toBe("2026-06-13T14:00:00.000Z");
  });

  it("adds day intervals after the provided now", () => {
    const next = calculateNextRunAt(
      { intervalKind: "days", intervalValue: 3 },
      new Date("2026-06-13T12:00:00.000Z"),
    );

    expect(next.toISOString()).toBe("2026-06-16T12:00:00.000Z");
  });

  it("uses today's daily time when it is still after now", () => {
    const next = calculateNextRunAt(
      { intervalKind: "daily_time", timeOfDay: "09:30" },
      new Date(2026, 5, 13, 8, 0, 0, 0),
    );

    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(5);
    expect(next.getDate()).toBe(13);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(30);
  });

  it("rolls daily time to tomorrow when it is not after now", () => {
    const next = calculateNextRunAt(
      { intervalKind: "daily_time", timeOfDay: "09:30" },
      new Date(2026, 5, 13, 9, 30, 0, 0),
    );

    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(5);
    expect(next.getDate()).toBe(14);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(30);
  });
});
