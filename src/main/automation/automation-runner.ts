import type { createRepositories } from "../db/repositories";
import type { Job, JobContext, JobTask } from "../scheduler/job-runner";
import type {
  AppSettings,
  AutomationGoalView,
  AutomationRunTrigger,
  AutomationRunView,
  AutomationScope,
  AutomationWorkItemStatus,
  AutomationWorkItemView,
} from "../../shared/ipc-contracts";
import { defaultAppSettings } from "../settings/app-settings";
import { matchesAutomationFilters } from "./filtering";
import { orderAutomationWorkItems } from "./ordering";
import { nextQuotaEligibleAt, shouldStopForQuotaSafety } from "./quota-safety";
import type { AutomationMediaFile, DesiredAutomationWorkItem } from "./automation-types";

type Repositories = ReturnType<typeof createRepositories>;

export type AutomationJobRunner = {
  enqueue(task: JobTask): Pick<Job, "id">;
  waitFor(jobId: string): Promise<void>;
};

export type AutomationRunnerOptions = {
  repositories: Repositories;
  jobRunner: AutomationJobRunner;
  getSettings?: () => AppSettings;
  now?: () => Date;
  executor?: AutomationExecutionAdapter;
};

export type AutomationExecutionAdapter = (input: {
  goal: AutomationGoalView;
  run: AutomationRunView;
  workItems: AutomationWorkItemView[];
  context?: JobContext;
}) => Promise<{ completed: number } | void> | { completed: number } | void;

export class AutomationRunner {
  private readonly repositories: Repositories;
  private readonly jobRunner: AutomationJobRunner;
  private readonly getSettings: () => AppSettings;
  private readonly now: () => Date;
  private readonly executor: AutomationExecutionAdapter;

  constructor(options: AutomationRunnerOptions) {
    this.repositories = options.repositories;
    this.jobRunner = options.jobRunner;
    this.getSettings = options.getSettings ?? (() => defaultAppSettings);
    this.now = options.now ?? (() => new Date());
    this.executor = options.executor ?? (() => ({ completed: 0 }));
  }

  reconcileGoal(goalId: number): AutomationWorkItemView[] {
    const goal = this.requireGoal(goalId);
    const reconciledAt = this.now();
    const files = this.repositories.mediaFiles
      .listForAutomation({ scope: goal.scope })
      .filter((file) => matchesAutomationFilters(file, goal.filters, reconciledAt));
    const desiredItems = files.map((file) => toDesiredWorkItem(file, reconciledAt));

    this.repositories.automationWorkItems.reconcile(goal.id, desiredItems, reconciledAt);

    return this.listOrderedActiveWorkItems(goal, files);
  }

  async runGoal(goalId: number, trigger: AutomationRunTrigger = "manual"): Promise<AutomationRunView> {
    const goal = this.requireRunnableGoal(goalId, trigger);
    let finalRun: AutomationRunView | undefined;

    const job = this.jobRunner.enqueue({
      kind: "automation",
      name: `Automation: ${goal.name}`,
      target: targetForScope(goal.scope),
      run: async (context) => {
        finalRun = await this.runGoalJob(goal.id, trigger, context);
      },
    });

    await this.jobRunner.waitFor(job.id);

    if (!finalRun) {
      throw new Error(`Automation run for goal ${goal.id} did not start`);
    }
    return finalRun;
  }

  async runEligible(trigger: "startup" | "schedule" | "resume" = "schedule"): Promise<AutomationRunView[]> {
    const now = this.now();
    const goals = this.repositories.automationGoals
      .list()
      .filter((goal) => goal.enabled && goal.manualStatus === "active")
      .filter((goal) => goal.nextEligibleRunAt == null || new Date(goal.nextEligibleRunAt).getTime() <= now.getTime())
      .filter((goal) => trigger !== "startup" || goal.runOnStartup);
    const runs: AutomationRunView[] = [];

    for (const goal of goals) {
      runs.push(await this.runGoal(goal.id, trigger));
    }

    return runs;
  }

  private async runGoalJob(goalId: number, trigger: AutomationRunTrigger, context?: JobContext): Promise<AutomationRunView> {
    const startedAt = this.now();
    let run = this.repositories.automationRuns.start({
      goalId,
      trigger,
      jobId: context?.jobId,
      now: startedAt,
    });
    this.insertEvent(goalId, run.id, "info", "Run started", startedAt);

    const activeItems = this.reconcileGoal(goalId);
    const actionableItems = activeItems.filter((item) => item.status !== "satisfied");
    run = this.repositories.automationRuns.updateProgress(run.id, {
      progressCurrent: 0,
      progressTotal: actionableItems.length,
    }) ?? run;
    context?.setProgressTotal(actionableItems.length);
    this.insertEvent(
      goalId,
      run.id,
      "info",
      `Reconciled ${activeItems.length} active work items; ${actionableItems.length} require action`,
      this.now(),
    );

    const reconciledGoal = this.requireGoal(goalId);
    if (reconciledGoal.matchingFiles > 0 && reconciledGoal.currentFunShare >= reconciledGoal.targetFunShare) {
      this.insertEvent(goalId, run.id, "info", "Target FuN share reached; no automation work needed", this.now());
      return this.finishRun(run, "target_reached", 0, actionableItems.length);
    }

    const quotaStop = this.getQuotaSafetyStop(reconciledGoal);
    if (quotaStop) {
      const eligibleAt = nextQuotaEligibleAt(this.now(), 24);
      this.repositories.automationGoals.markRunResult(goalId, {
        lastRunAt: this.now(),
        nextEligibleRunAt: eligibleAt,
        lastError: null,
      });
      this.insertEvent(
        goalId,
        run.id,
        "warning",
        `Quota safety reached for ${quotaStop}; next eligible at ${eligibleAt.toISOString()}`,
        this.now(),
      );
      return this.finishRun(run, "waiting_for_quota", 0, actionableItems.length);
    }

    const result = await this.executor({ goal: reconciledGoal, run, workItems: actionableItems, context });
    const completed = result?.completed ?? 0;
    context?.setProgress(completed, actionableItems.length);
    this.insertEvent(goalId, run.id, "info", "Runner skeleton completed; execution adapter not installed", this.now());
    return this.finishRun(run, "completed", completed, actionableItems.length);
  }

  private finishRun(
    run: AutomationRunView,
    status: Exclude<AutomationRunView["status"], "running">,
    progressCurrent: number,
    progressTotal: number,
  ): AutomationRunView {
    const finishedAt = this.now();
    const goalResult =
      status === "waiting_for_quota"
        ? { lastRunAt: finishedAt, lastError: null }
        : { lastRunAt: finishedAt, nextEligibleRunAt: null, lastError: null };
    this.repositories.automationGoals.markRunResult(run.goalId, goalResult);
    return (
      this.repositories.automationRuns.finish(run.id, {
        status,
        finishedAt,
        progressCurrent,
        progressTotal,
      }) ?? run
    );
  }

  private listOrderedActiveWorkItems(goal: AutomationGoalView, files: AutomationMediaFile[]): AutomationWorkItemView[] {
    const orderingByKey = new Map(files.map((file) => [workItemKey(file), file]));
    const activeItems = this.repositories.automationWorkItems
      .listForGoal(goal.id)
      .filter((item) => item.status !== "out_of_scope");

    return orderAutomationWorkItems(
      activeItems.map((item) => {
        const file = orderingByKey.get(workItemKey(item));
        return {
          ...item,
          itemFunShare: file?.itemFunShare ?? 0,
          sizeBytes: file?.sizeBytes ?? 0,
        };
      }),
      goal.ordering,
    );
  }

  private getQuotaSafetyStop(goal: AutomationGoalView): "search" | "grab" | undefined {
    const settings = this.getSettings();
    const usedSearches = this.repositories.activityLog.countSince("search", this.now(), settings.quota.windowHours);
    if (
      shouldStopForQuotaSafety({
        used: usedSearches,
        limit: settings.quota.searchLimit,
        stopAtPercent: settings.automation.quotaSafetyPercent,
      })
    ) {
      return "search";
    }

    if (goal.actionMode === "search_only") {
      return undefined;
    }

    const usedGrabs = this.repositories.activityLog.countSince("grab", this.now(), settings.quota.windowHours);
    if (
      shouldStopForQuotaSafety({
        used: usedGrabs,
        limit: settings.quota.grabLimit,
        stopAtPercent: settings.automation.quotaSafetyPercent,
      })
    ) {
      return "grab";
    }

    return undefined;
  }

  private requireGoal(goalId: number): AutomationGoalView {
    const goal = this.repositories.automationGoals.find(goalId);
    if (!goal) {
      throw new Error(`Automation goal ${goalId} not found`);
    }
    return goal;
  }

  private requireRunnableGoal(goalId: number, trigger: AutomationRunTrigger): AutomationGoalView {
    const goal = this.requireGoal(goalId);
    if (!goal.enabled) {
      throw new Error(`Automation goal ${goalId} is disabled and cannot be run with trigger ${trigger}`);
    }
    if (goal.manualStatus !== "active") {
      throw new Error(`Automation goal ${goalId} is paused and cannot be run with trigger ${trigger}`);
    }
    return goal;
  }

  private insertEvent(
    goalId: number,
    runId: number,
    level: "info" | "warning" | "error",
    message: string,
    createdAt: Date,
  ): void {
    this.repositories.automationEvents.insert({ goalId, runId, level, message, createdAt });
  }
}

function toDesiredWorkItem(file: AutomationMediaFile, now: Date): DesiredAutomationWorkItem {
  return {
    instanceId: file.instanceId,
    mediaItemId: file.mediaItemId,
    mediaFileId: file.mediaFileId,
    childArrId: file.childArrId,
    kind: file.kind,
    title: file.title,
    sortKey: file.sortKey,
    isFun: file.isFun,
    lastAnalyzedAt: file.lastAnalyzedAt,
    lastSearchedAt: file.lastSearchedAt,
    lastGrabbedAt: file.lastGrabbedAt,
    status: statusForFile(file),
    now,
  };
}

function statusForFile(file: AutomationMediaFile): AutomationWorkItemStatus {
  return file.isFun ? "satisfied" : "pending";
}

function targetForScope(scope: AutomationScope): Job["target"] {
  if (scope === "both") return "all";
  return scope;
}

function workItemKey(item: Pick<AutomationMediaFile | AutomationWorkItemView, "instanceId" | "kind" | "childArrId">): string {
  return `${item.instanceId}:${item.kind}:${item.childArrId}`;
}
