import { describe, expect, it, vi } from "vitest";
import { JobRunner } from "../../src/main/scheduler/job-runner";

describe("JobRunner", () => {
  it("emits live progress and event updates while a job runs", async () => {
    const updates: string[] = [];
    const runner = new JobRunner(
      { show: vi.fn() },
      {
        onChange: (event) => updates.push(`${event.type}:${event.job.id}:${event.job.progressCurrent}/${event.job.progressTotal}`),
      },
    );

    const job = runner.enqueue({
      kind: "analysis",
      name: "Analyze Sonarr",
      progressTotal: 2,
      run: async (context) => {
        context.addEvent("info", "Fetched series");
        context.incrementProgress();
        context.addEvent("info", "Fetched episodes");
        context.incrementProgress();
      },
    });

    await runner.waitFor(job.id);

    expect(runner.listJobs()[0]).toEqual(
      expect.objectContaining({
        id: job.id,
        progressCurrent: 2,
        progressTotal: 2,
        status: "completed",
        successCount: 2,
      }),
    );
    expect(runner.listEvents(job.id).map((event) => event.message)).toEqual([
      "Analyze Sonarr started",
      "Fetched series",
      "Fetched episodes",
      "Analyze Sonarr completed",
    ]);
    expect(updates).toContain(`job:${job.id}:1/2`);
    expect(updates).toContain(`job:${job.id}:2/2`);
  });

  it("cancels a queued job before it starts", async () => {
    let releaseFirstJob: () => void = () => undefined;
    const runner = new JobRunner({ show: vi.fn() });

    const firstJob = runner.enqueue({
      kind: "analysis",
      name: "Long job",
      run: () => new Promise<void>((resolve) => {
        releaseFirstJob = resolve;
      }),
    });
    const queuedJob = runner.enqueue({
      kind: "search",
      name: "Queued job",
      run: async () => {
        throw new Error("cancelled queued jobs must not run");
      },
    });

    await vi.waitFor(() => {
      expect(runner.listJobs().find((item) => item.id === firstJob.id)?.status).toBe("running");
    });
    expect(runner.cancel(queuedJob.id)).toBe(true);
    releaseFirstJob();
    await runner.waitFor(firstJob.id);
    await runner.waitFor(queuedJob.id);

    const cancelledJob = runner.listJobs().find((job) => job.id === queuedJob.id);
    expect(cancelledJob).toEqual(
      expect.objectContaining({
        status: "cancelled",
      }),
    );
    expect(cancelledJob).not.toHaveProperty("startedAt");
    expect(runner.listEvents(queuedJob.id).map((event) => event.message)).toContain("Queued job cancelled");
  });

  it("keeps a running job cancelled when its task returns", async () => {
    let finishTask: () => void = () => undefined;
    const runner = new JobRunner({ show: vi.fn() });
    const job = runner.enqueue({
      kind: "analysis",
      name: "Running job",
      run: () => new Promise<void>((resolve) => {
        finishTask = resolve;
      }),
    });

    await vi.waitFor(() => {
      expect(runner.listJobs().find((item) => item.id === job.id)?.status).toBe("running");
    });
    expect(runner.cancel(job.id)).toBe(true);
    finishTask();
    await runner.waitFor(job.id);

    expect(runner.listJobs().find((item) => item.id === job.id)?.status).toBe("cancelled");
    expect(runner.listEvents(job.id).map((event) => event.message)).toContain("Running job cancelled");
  });

  it("marks a running job as blocked by budget", async () => {
    const runner = new JobRunner({ show: vi.fn() });
    const job = runner.enqueue({
      kind: "search",
      name: "Search Sonarr",
      run: async (context) => {
        context.blockByBudget("Search budget exhausted");
      },
    });

    await runner.waitFor(job.id);

    expect(runner.listJobs().find((item) => item.id === job.id)).toEqual(
      expect.objectContaining({
        status: "blocked_by_budget",
        finishedAt: expect.any(String),
      }),
    );
    expect(runner.listEvents(job.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warning",
          message: "Search budget exhausted",
        }),
      ]),
    );
  });
});
