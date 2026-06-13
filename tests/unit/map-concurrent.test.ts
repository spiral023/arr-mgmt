import { describe, expect, it } from "vitest";
import { mapConcurrent } from "../../src/main/async/map-concurrent";

describe("mapConcurrent", () => {
  it("preserves input order while limiting concurrent work", async () => {
    let active = 0;
    let maxActive = 0;

    const result = await mapConcurrent([3, 1, 2, 4], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, value * 5));
      active -= 1;
      return value * 10;
    });

    expect(result).toEqual([30, 10, 20, 40]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("uses one worker when the limit is invalid", async () => {
    let active = 0;
    let maxActive = 0;

    await mapConcurrent([1, 2, 3], 0, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
    });

    expect(maxActive).toBe(1);
  });
});
