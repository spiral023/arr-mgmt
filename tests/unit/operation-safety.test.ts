import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveGrabTarget } from "../../src/main/arr/grab-selection";
import type { ArrRelease } from "../../src/main/arr/arr-types";
import { ArrRateLimiter } from "../../src/main/arr/arr-api-client";
import { RadarrClient } from "../../src/main/arr/radarr-client";
import { mapConcurrent } from "../../src/main/async/map-concurrent";
import { JobRunner } from "../../src/main/scheduler/job-runner";
import { Scheduler } from "../../src/main/scheduler/scheduler";

const stored: ArrRelease = { guid: "e5", title: "Series.S01E05-FuN", releaseGroup: "FuN", indexerId: 1 };

afterEach(() => vi.useRealTimers());

describe("fresh release selection", () => {
  it("requires an exact match in a season response and permits replacement only after an item search", () => {
    const other = { ...stored, guid: "e1", title: "Series.S01E01-FuN" };
    expect(resolveGrabTarget([other], stored, "season")).toBeUndefined();
    expect(resolveGrabTarget([{ ...stored, guid: "replacement" }], stored, "item")?.release.title).toBe(stored.title);
  });

  it.each([{ rejected: true }, { downloadAllowed: false }, { releaseGroup: "Other" }])(
    "revalidates exact GUID and title matches: %j", (flags) => {
      expect(resolveGrabTarget([{ ...stored, ...flags }], stored, "season")).toBeUndefined();
      expect(resolveGrabTarget([{ ...stored, ...flags }], stored, "item")).toBeUndefined();
    },
  );

  it("keeps exact season matches tied to the stored indexer", () => {
    expect(resolveGrabTarget([{ ...stored, indexerId: 2 }], stored, "season")).toBeUndefined();
    expect(resolveGrabTarget([{ ...stored }], stored, "season")?.strategy).toBe("guid");
    expect(resolveGrabTarget([{ ...stored, guid: "new" }], stored, "season")?.strategy).toBe("title");
  });
});

describe("operation cancellation", () => {
  it("does not dispatch a queued POST after cancellation or poison the limiter", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const limiter = new ArrRateLimiter({ maxRequests: 1, windowMs: 1000 });
    const fetchImpl = vi.fn(async () => new Response("[]"));
    const client = new RadarrClient({ baseUrl: "http://test.invalid", apiKey: "test", signal: controller.signal, rateLimiter: limiter, fetchImpl });
    await client.getMovies();
    const pending = client.grabRelease(stored);
    const rejection = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejection;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await new RadarrClient({ baseUrl: "http://test.invalid", apiKey: "test", rateLimiter: limiter, fetchImpl }).getMovies();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-flight read", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const client = new RadarrClient({ baseUrl: "http://read.invalid", apiKey: "test", signal: controller.signal, fetchImpl,
      rateLimiter: { waitForSlot: async () => undefined } });
    const pending = client.getMovies();
    const rejection = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    controller.abort();
    await rejection;
  });

  it("keeps the result of a POST already sent to ARR observable after cancellation", async () => {
    const controller = new AbortController();
    let respond!: (value: Response) => void;
    let requestSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      requestSignal = init?.signal;
      return new Promise<Response>((resolve) => { respond = resolve; });
    });
    const client = new RadarrClient({ baseUrl: "http://post.invalid", apiKey: "test", signal: controller.signal, fetchImpl,
      rateLimiter: { waitForSlot: async () => undefined } });
    const pending = client.grabRelease(stored);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    controller.abort();
    expect(requestSignal?.aborted).toBe(false);
    respond(new Response(JSON.stringify({ downloadId: "accepted" })));
    await expect(pending).resolves.toMatchObject({ downloadId: "accepted" });
  });

  it("drains active workers and never starts another item after one worker fails", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started: number[] = [];
    const pending = mapConcurrent([0, 1, 2], 2, async (item) => {
      started.push(item);
      if (item === 0) throw new Error("stop");
      await gate;
    });
    let settled = false;
    const observed = pending.catch((error) => { settled = true; return error; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect((await observed).message).toBe("stop");
    expect(started).toEqual([0, 1]);
  });

  it("waits for a cancelled running job to drain before reporting it finished or starting the next job", async () => {
    let release!: () => void;
    let signal: AbortSignal | undefined;
    const next = vi.fn(async () => undefined);
    const runner = new JobRunner({ show: vi.fn() });
    const job = runner.enqueue({ name: "Active", kind: "grab", run: async (context) => {
      signal = context.signal;
      await new Promise<void>((resolve) => { release = resolve; });
    } });
    const successor = runner.enqueue({ name: "Next", kind: "analysis", run: next });
    await vi.waitFor(() => expect(signal).toBeDefined());
    runner.cancel(job.id);
    let settled = false;
    const pending = runner.waitFor(job.id).then(() => { settled = true; });
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
    expect(settled).toBe(false);
    expect(next).not.toHaveBeenCalled();
    expect(job.finishedAt).toBeUndefined();
    release();
    await pending;
    await runner.waitFor(successor.id);
    expect(job.status).toBe("cancelled");
    expect(job.finishedAt).toBeDefined();
  });
});

describe("scheduler reliability", () => {
  it("continues scheduling other jobs and future ticks after a task fails", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const scheduler = new Scheduler(onError);
    const run = vi.fn(async () => undefined);
    const failing = scheduler.add({ name: "Fails", enabled: true, rule: { intervalKind: "minutes", intervalValue: 1 }, run: async () => { throw Error("unavailable"); } });
    const healthy = scheduler.add({ name: "Healthy", enabled: true, rule: { intervalKind: "minutes", intervalValue: 1 }, run });
    failing.nextRunAt = healthy.nextRunAt = new Date(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("publishes pause changes and leaves due work untouched until resumed", async () => {
    vi.useFakeTimers();
    const scheduler = new Scheduler();
    const listener = vi.fn();
    const unsubscribe = scheduler.onPauseChange(listener);
    const run = vi.fn(async () => undefined);
    const task = scheduler.add({ name: "Due", enabled: true, rule: { intervalKind: "minutes", intervalValue: 1 }, run });
    task.nextRunAt = new Date(0);
    scheduler.setPaused(true);
    scheduler.setPaused(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).not.toHaveBeenCalled();
    expect(scheduler.isPaused()).toBe(true);
    scheduler.setPaused(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledOnce();
    expect(listener.mock.calls).toEqual([[true], [false]]);
    unsubscribe();
    scheduler.stop();
  });
});
