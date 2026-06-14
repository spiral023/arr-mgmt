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
});
