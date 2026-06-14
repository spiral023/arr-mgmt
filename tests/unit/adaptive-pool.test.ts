import { describe, expect, it } from "vitest";
import { mapAdaptive } from "../../src/main/async/adaptive-pool";

/** Resolves on the next microtask so we can interleave deterministic "work". */
function tick(): Promise<void> {
  return Promise.resolve();
}

describe("mapAdaptive", () => {
  it("never exceeds the initial concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const result = await mapAdaptive(
      Array.from({ length: 30 }, (_, i) => i),
      { initialLimit: 4, safeLimit: 2 },
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await tick();
        await tick();
        active -= 1;
      },
    );

    expect(peak).toBeLessThanOrEqual(4);
    expect(result.peakActive).toBeLessThanOrEqual(4);
    expect(result.downshifted).toBe(false);
  });

  it("processes every item exactly once", async () => {
    const seen: number[] = [];
    await mapAdaptive(
      Array.from({ length: 20 }, (_, i) => i),
      { initialLimit: 5, safeLimit: 2 },
      async (item) => {
        await tick();
        seen.push(item);
      },
    );

    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("downshifts to the safe limit after a throttle signal and reports it once", async () => {
    let active = 0;
    let peakAfterThrottle = 0;
    let throttled = false;
    let downshiftCalls = 0;

    const result = await mapAdaptive(
      Array.from({ length: 40 }, (_, i) => i),
      {
        initialLimit: 8,
        safeLimit: 2,
        onDownshift: () => {
          downshiftCalls += 1;
        },
      },
      async (item, _index, controls) => {
        active += 1;
        if (throttled) {
          peakAfterThrottle = Math.max(peakAfterThrottle, active);
        }
        await tick();
        if (item === 5 && !throttled) {
          throttled = true;
          controls.reportThrottle("simulated 429");
        }
        await tick();
        active -= 1;
      },
    );

    expect(result.downshifted).toBe(true);
    expect(result.finalLimit).toBe(2);
    expect(downshiftCalls).toBe(1);
    // Once downshifted, no more than the safe number of workers may run at once.
    expect(peakAfterThrottle).toBeLessThanOrEqual(2);
  });

  it("stops pulling new items once a worker throws and rejects with that error", async () => {
    const started: number[] = [];
    await expect(
      mapAdaptive(
        Array.from({ length: 50 }, (_, i) => i),
        { initialLimit: 3, safeLimit: 1 },
        async (item) => {
          started.push(item);
          await tick();
          if (item === 2) {
            throw new Error("boom");
          }
        },
      ),
    ).rejects.toThrow("boom");

    // Far fewer than all 50 items should have started before the run halted.
    expect(started.length).toBeLessThan(20);
  });

  it("handles an empty item list", async () => {
    const result = await mapAdaptive([], { initialLimit: 4, safeLimit: 2 }, async () => undefined);
    expect(result).toEqual({ peakActive: 0, finalLimit: 4, downshifted: false });
  });
});
