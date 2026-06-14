import { afterEach, describe, expect, it, vi } from "vitest";
import { createRefreshScheduler } from "../../src/renderer/state/refresh-scheduler";

describe("createRefreshScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces event storms into one refresh per minimum interval", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const scheduler = createRefreshScheduler(refresh, { minimumDelayMs: 1_000 });

    scheduler.trigger();
    scheduler.trigger();
    scheduler.trigger();

    await vi.advanceTimersByTimeAsync(999);
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.trigger();
    scheduler.trigger();

    await vi.advanceTimersByTimeAsync(999);
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
