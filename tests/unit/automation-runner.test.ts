import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArrRelease, MediaItemAnalysis } from "../../src/main/arr/arr-types";
import { createAutomationExecutor, type AutomationArrClients } from "../../src/main/automation/automation-executor";
import { AutomationRunner } from "../../src/main/automation/automation-runner";
import { defaultAppSettings } from "../../src/main/settings/app-settings";
import { createInMemoryDatabase } from "../../src/main/db/client";
import { migrateDatabase } from "../../src/main/db/migrations";
import { createRepositories } from "../../src/main/db/repositories";
import type { AppSettings, AutomationGoalFilters } from "../../src/shared/ipc-contracts";
import type { JobContext, JobTask } from "../../src/main/scheduler/job-runner";

const now = new Date("2026-06-18T12:00:00.000Z");

const defaultFilters = {
  monitored: "yes",
  hasFile: "yes",
  qualityProfiles: ["WEBDL-1080p"],
  funShare: { operator: "lt", value: 0.95 },
  analyzed: { mode: "any" },
  searched: { mode: "any" },
  grabbed: { mode: "any" },
} satisfies AutomationGoalFilters;

type GoalInputOverrides = Partial<{
  actionMode: "search_only" | "search_and_grab";
  enabled: boolean;
  executionStrategy: "grab_immediately" | "search_then_grab";
  filters: AutomationGoalFilters;
  minSearchIntervalHours: number;
  name: string;
  runOnStartup: boolean;
  targetFunShare: number;
}>;

describe("AutomationRunner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reconcileGoal creates file-level work items and marks FuN files satisfied and non-FuN files pending", () => {
    const { goal, repos } = createFixture();
    const runner = createRunner(repos);

    const items = runner.reconcileGoal(goal.id);

    expect(items).toEqual([
      expect.objectContaining({ childArrId: 101, isFun: true, status: "satisfied", title: "Example Series S01E01" }),
      expect.objectContaining({ childArrId: 102, isFun: false, status: "pending", title: "Example Series S01E02" }),
    ]);
    expect(repos.automationWorkItems.listForGoal(goal.id).map((item) => item.status)).toEqual(["satisfied", "pending"]);
  });

  it("reconcileGoal removes stale work items when filters no longer match", () => {
    const { goal, repos } = createFixture();
    const runner = createRunner(repos);

    expect(runner.reconcileGoal(goal.id)).toHaveLength(2);
    repos.automationGoals.upsert({
      ...goal,
      filters: { ...goal.filters, qualityProfiles: ["Bluray-2160p"] },
      now,
    });

    expect(runner.reconcileGoal(goal.id)).toEqual([]);
    expect(repos.automationWorkItems.listForGoal(goal.id)).toEqual([
      expect.objectContaining({ childArrId: 101, status: "out_of_scope" }),
      expect.objectContaining({ childArrId: 102, status: "out_of_scope" }),
    ]);
  });

  it("runGoal creates an automation job, run row, events, and reaches target_reached", async () => {
    const { goal, repos } = createFixture({
      targetFunShare: 0.5,
    });
    const jobRunner = new FakeJobRunner();
    const runner = createRunner(repos, { jobRunner });

    const run = await runner.runGoal(goal.id);

    expect(jobRunner.tasks).toEqual([
      expect.objectContaining({ kind: "automation", name: "Automation: Goal", target: "sonarr" }),
    ]);
    expect(run).toEqual(expect.objectContaining({ goalId: goal.id, status: "target_reached", progressCurrent: 0, progressTotal: 1 }));
    expect(repos.automationRuns.listForGoal(goal.id)).toEqual([expect.objectContaining({ id: run.id, status: "target_reached" })]);
    expect(repos.automationEvents.list(goal.id, 10).map((event) => event.message)).toEqual([
      "Target FuN share reached; no automation work needed",
      "Reconciled 2 active work items; 1 require action",
      "Run started",
    ]);
    expect(jobRunner.contexts[0].setProgressTotal).toHaveBeenCalledWith(1);
  });

  it("runGoal stops with waiting_for_quota and sets nextEligibleRunAt when global search or grab usage reaches safety threshold", async () => {
    const { goal, repos } = createFixture();
    const settings: AppSettings = {
      ...defaultAppSettings,
      automation: { quotaSafetyPercent: 50 },
      quota: { searchLimit: 4, grabLimit: 10, windowHours: 24 },
    };
    for (let index = 0; index < 2; index += 1) {
      repos.activityLog.insert({
        action: "search",
        quotaType: "search",
        status: "success",
        createdAt: new Date(now.getTime() - index * 60_000),
      });
    }
    const runner = createRunner(repos, { getSettings: () => settings });

    const run = await runner.runGoal(goal.id);

    expect(run.status).toBe("waiting_for_quota");
    expect(run.progressTotal).toBe(1);
    expect(repos.automationGoals.find(goal.id)?.nextEligibleRunAt).toBe("2026-06-19T12:00:00.000Z");
    expect(repos.automationGoals.find(goal.id)?.status).toBe("waiting_for_quota");
    expect(repos.automationEvents.list(goal.id, 10)[0]).toEqual(
      expect.objectContaining({ level: "warning", message: "Quota safety reached for search; next eligible at 2026-06-19T12:00:00.000Z" }),
    );

    const grabFixture = createFixture();
    for (let index = 0; index < 5; index += 1) {
      grabFixture.repos.activityLog.insert({
        action: "grab",
        quotaType: "grab",
        status: "success",
        createdAt: new Date(now.getTime() - index * 60_000),
      });
    }
    const grabRun = await createRunner(grabFixture.repos, { getSettings: () => settings }).runGoal(grabFixture.goal.id);
    expect(grabRun.status).toBe("waiting_for_quota");
    expect(grabFixture.repos.automationGoals.find(grabFixture.goal.id)?.status).toBe("waiting_for_quota");
    expect(grabFixture.repos.automationEvents.list(grabFixture.goal.id, 10)[0]).toEqual(
      expect.objectContaining({ level: "warning", message: "Quota safety reached for grab; next eligible at 2026-06-19T12:00:00.000Z" }),
    );
  });

  it("runGoal finalizes the automation run and goal when the executor rejects", async () => {
    const { goal, repos } = createFixture();
    const runner = createRunner(repos, {
      executor: async () => {
        throw new Error("adapter failed");
      },
    });

    const run = await runner.runGoal(goal.id);

    expect(run).toEqual(expect.objectContaining({ status: "blocked_by_error", progressCurrent: 0, progressTotal: 1 }));
    expect(repos.automationRuns.listForGoal(goal.id)).toEqual([
      expect.objectContaining({ id: run.id, status: "blocked_by_error", finishedAt: "2026-06-18T12:00:00.000Z" }),
    ]);
    expect(repos.automationGoals.find(goal.id)).toEqual(
      expect.objectContaining({ lastError: "adapter failed", status: "blocked_by_error" }),
    );
    expect(repos.automationEvents.list(goal.id, 10)[0]).toEqual(
      expect.objectContaining({ level: "error", message: "adapter failed" }),
    );
  });

  it("runGoal marks the run waiting_for_quota when the executor stops on hard quota", async () => {
    const { goal, repos } = createFixture();
    const runner = createRunner(repos, {
      executor: () => ({ completed: 0, stoppedByQuota: "search" }),
    });

    const run = await runner.runGoal(goal.id);

    expect(run).toEqual(expect.objectContaining({ status: "waiting_for_quota", progressCurrent: 0, progressTotal: 1 }));
    expect(repos.automationGoals.find(goal.id)).toEqual(
      expect.objectContaining({ lastError: undefined, nextEligibleRunAt: "2026-06-19T12:00:00.000Z", status: "waiting_for_quota" }),
    );
    expect(repos.automationEvents.list(goal.id, 10)[0]).toEqual(
      expect.objectContaining({ level: "warning", message: "Quota exhausted for search; next eligible at 2026-06-19T12:00:00.000Z" }),
    );
  });

  it("does not re-search a grabbed item after reconcile until a later analysis still finds it non-FuN", async () => {
    const currentNow = { value: now };
    const { goal, instanceId, repos } = createFixture({ minSearchIntervalHours: 1 });
    const clients = createClients({
      sonarrReleases: [release({ guid: "fun-102", releaseGroup: "FuN" })],
    });
    const runner = createRunner(repos, {
      now: () => currentNow.value,
      executor: createAutomationExecutor({
        repositories: repos,
        getSettings: () => defaultAppSettings,
        now: () => currentNow.value,
        clients,
      }),
    });

    await runner.runGoal(goal.id);
    currentNow.value = new Date("2026-06-25T12:00:00.000Z");
    await runner.runGoal(goal.id);

    expect(clients.sonarr.getReleasesForEpisode).toHaveBeenCalledTimes(1);
    expect(clients.sonarr.grabRelease).toHaveBeenCalledTimes(1);
    expect(repos.activityLog.countSince("search", currentNow.value, 24 * 30)).toBe(1);
    expect(repos.activityLog.countSince("grab", currentNow.value, 24 * 30)).toBe(1);
    expect(repos.automationWorkItems.listForGoal(goal.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          childArrId: 102,
          lastAnalyzedAt: "2026-06-18T10:00:00.000Z",
          lastGrabbedAt: "2026-06-18T12:00:00.000Z",
        }),
      ]),
    );

    repos.mediaItems.upsertAnalysis(instanceId, {
      ...analysis(),
      lastAnalyzedAt: "2026-06-26T10:00:00.000Z",
    });
    currentNow.value = new Date("2026-06-26T12:00:00.000Z");
    await runner.runGoal(goal.id);

    expect(clients.sonarr.getReleasesForEpisode).toHaveBeenCalledTimes(2);
    expect(clients.sonarr.grabRelease).toHaveBeenCalledTimes(2);
    expect(repos.activityLog.countSince("search", currentNow.value, 24 * 30)).toBe(2);
    expect(repos.activityLog.countSince("grab", currentNow.value, 24 * 30)).toBe(2);
  });

  it("runEligible startup runs only enabled active startup goals whose nextEligibleRunAt is due", async () => {
    const { db, repos } = createFixture();
    const dueStartupGoal = repos.automationGoals.upsert(goalInput({ name: "Due startup", runOnStartup: true }));
    const disabledGoal = repos.automationGoals.upsert(goalInput({ name: "Disabled", enabled: false, runOnStartup: true }));
    const scheduledOnlyGoal = repos.automationGoals.upsert(goalInput({ name: "Scheduled only", runOnStartup: false }));
    const futureGoal = repos.automationGoals.upsert(goalInput({ name: "Future startup", runOnStartup: true }));
    const pausedGoal = repos.automationGoals.upsert(goalInput({ name: "Paused startup", runOnStartup: true }));
    const invalidDateGoal = repos.automationGoals.upsert(goalInput({ name: "Invalid date startup", runOnStartup: true }));
    repos.automationGoals.markRunResult(futureGoal.id, {
      lastRunAt: now,
      nextEligibleRunAt: new Date("2026-06-19T12:00:00.000Z"),
    });
    repos.automationGoals.setManualStatus(pausedGoal.id, "paused_by_user", now);
    db.prepare("update automation_goals set next_eligible_run_at = ? where id = ?").run("not-a-date", invalidDateGoal.id);
    const jobRunner = new FakeJobRunner();
    const runner = createRunner(repos, { jobRunner });

    const runs = await runner.runEligible("startup");

    expect(runs.map((run) => run.goalId)).toEqual([1, dueStartupGoal.id, invalidDateGoal.id]);
    expect(jobRunner.tasks.map((task) => task.name)).toEqual([
      "Automation: Goal",
      "Automation: Due startup",
      "Automation: Invalid date startup",
    ]);
    expect(repos.automationRuns.listForGoal(disabledGoal.id)).toEqual([]);
    expect(repos.automationRuns.listForGoal(scheduledOnlyGoal.id)).toEqual([]);
    expect(repos.automationRuns.listForGoal(futureGoal.id)).toEqual([]);
    expect(repos.automationRuns.listForGoal(pausedGoal.id)).toEqual([]);
  });

  it("test fake waits only for the requested job id", async () => {
    const jobRunner = new FakeJobRunner();
    let releaseFirstJob: () => void = () => undefined;
    jobRunner.enqueue({
      kind: "automation",
      name: "Slow automation",
      run: () =>
        new Promise<void>((resolve) => {
          releaseFirstJob = resolve;
        }),
    });
    const fastJob = jobRunner.enqueue({ kind: "automation", name: "Fast automation", run: async () => undefined });

    await expect(Promise.race([jobRunner.waitFor(fastJob.id).then(() => "fast"), delay(10).then(() => "timeout")])).resolves.toBe(
      "fast",
    );

    releaseFirstJob();
    await jobRunner.waitFor("job-1");
  });
});

class FakeJobRunner {
  readonly contexts: Array<JobContext & { setProgressTotal: ReturnType<typeof vi.fn>; setProgress: ReturnType<typeof vi.fn> }> = [];
  readonly tasks: JobTask[] = [];
  private readonly running = new Map<string, Promise<void>>();

  enqueue(task: JobTask) {
    const id = `job-${this.tasks.length + 1}`;
    this.tasks.push(task);
    const context = {
      jobId: id,
      addEvent: vi.fn(),
      incrementProgress: vi.fn(),
      isCancelled: () => false,
      setProgress: vi.fn(),
      setProgressTotal: vi.fn(),
      blockByBudget: (message: string): never => {
        throw new Error(message);
      },
      throwIfCancelled: vi.fn(),
    };
    this.contexts.push(context);
    this.running.set(id, Promise.resolve(task.run?.(context)).then(() => undefined));
    return {
      id,
      name: task.name,
      kind: task.kind,
      target: task.target ?? "all",
      status: "completed" as const,
      progressCurrent: 0,
      progressTotal: task.progressTotal ?? 0,
      successCount: 0,
      failureCount: 0,
      createdAt: now.toISOString(),
    };
  }

  async waitFor(jobId: string): Promise<void> {
    await this.running.get(jobId);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createRunner(
  repos: ReturnType<typeof createRepositories>,
  overrides: Partial<ConstructorParameters<typeof AutomationRunner>[0]> = {},
) {
  return new AutomationRunner({
    repositories: repos,
    jobRunner: new FakeJobRunner(),
    getSettings: () => defaultAppSettings,
    now: () => now,
    ...overrides,
  });
}

function createClients(input: { sonarrReleases?: ArrRelease[]; radarrReleases?: ArrRelease[] } = {}): AutomationArrClients {
  return {
    sonarr: {
      getStatus: vi.fn(async () => ({ appName: "Sonarr" })),
      getReleasesForEpisode: vi.fn(async () => input.sonarrReleases ?? []),
      grabRelease: vi.fn(async () => undefined),
    },
    radarr: {
      getStatus: vi.fn(async () => ({ appName: "Radarr" })),
      getReleasesForMovie: vi.fn(async () => input.radarrReleases ?? []),
      grabRelease: vi.fn(async () => undefined),
    },
  };
}

function release(overrides: Partial<ArrRelease> = {}): ArrRelease {
  return {
    approved: true,
    downloadAllowed: true,
    guid: "release-guid",
    indexer: "Indexer",
    quality: { quality: { name: "WEBDL-1080p" } },
    releaseGroup: "FuN",
    size: 1_000,
    title: "Example.Release.FuN",
    ...overrides,
  };
}

function createFixture(overrides: GoalInputOverrides = {}) {
  const db = createInMemoryDatabase();
  migrateDatabase(db);
  const repos = createRepositories(db);
  const instanceId = repos.instances.upsert({
    kind: "sonarr",
    name: "Sonarr",
    baseUrl: "http://sonarr.local:8989",
    apiKeyEncrypted: "encrypted",
    enabled: true,
    now,
  });
  repos.mediaItems.upsertAnalysis(instanceId, analysis());
  const goal = repos.automationGoals.upsert(goalInput(overrides));
  return { db, goal, instanceId, repos };
}

function goalInput(overrides: GoalInputOverrides = {}) {
  return {
    name: "Goal",
    enabled: true,
    scope: "sonarr" as const,
    targetFunShare: 0.95,
    filters: defaultFilters,
    actionMode: "search_and_grab" as const,
    executionStrategy: "grab_immediately" as const,
    ordering: "oldest_search_first" as const,
    minSearchIntervalHours: 168,
    runOnStartup: true,
    schedule: null,
    now,
    ...overrides,
  };
}

function analysis(): MediaItemAnalysis {
  return {
    arrId: 7,
    childrenWithFile: 2,
    files: [
      {
        arrFileId: 1001,
        childArrId: 101,
        episodeNumber: 1,
        isFun: true,
        path: "/tv/example/s01e01.mkv",
        qualityName: "WEBDL-1080p",
        releaseGroup: "FuN",
        seasonNumber: 1,
        sizeBytes: 1_000,
      },
      {
        arrFileId: 1002,
        childArrId: 102,
        episodeNumber: 2,
        isFun: false,
        path: "/tv/example/s01e02.mkv",
        qualityName: "WEBDL-1080p",
        releaseGroup: "WvF",
        seasonNumber: 1,
        sizeBytes: 2_000,
      },
    ],
    funChildren: 1,
    funShare: 0.5,
    funSizeBytes: 1_000,
    hasFile: true,
    kind: "series",
    lastAnalyzedAt: "2026-06-18T10:00:00.000Z",
    monitored: true,
    nonFunChildren: 1,
    qualityProfileName: "WEBDL-1080p",
    title: "Example Series",
    titleSlug: "example-series",
    totalChildren: 2,
    totalSizeBytes: 3_000,
  };
}
