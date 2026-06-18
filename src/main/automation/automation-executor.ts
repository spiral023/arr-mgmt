import type { createRepositories } from "../db/repositories";
import type { ArrRelease } from "../arr/arr-types";
import { selectBestFunRelease } from "../arr/sonarr-operations";
import { QuotaService, type QuotaAction } from "../scheduler/quota-service";
import { defaultAppSettings } from "../settings/app-settings";
import type { AutomationExecutionAdapter } from "./automation-runner";
import type { AppSettings, AutomationRunView, AutomationWorkItemView } from "../../shared/ipc-contracts";

type Repositories = ReturnType<typeof createRepositories>;

export type AutomationSonarrClient = {
  getReleasesForEpisode(episodeId: number): Promise<ArrRelease[]> | ArrRelease[];
  grabRelease(release: ArrRelease): Promise<void> | void;
};

export type AutomationRadarrClient = {
  getReleasesForMovie(movieId: number): Promise<ArrRelease[]> | ArrRelease[];
  grabRelease(release: ArrRelease): Promise<void> | void;
};

export type AutomationArrClients = {
  sonarr: AutomationSonarrClient;
  radarr: AutomationRadarrClient;
};

export type AutomationExecutorOptions = {
  repositories: Repositories;
  getSettings: () => AppSettings;
  now?: () => Date;
  quota?: QuotaService;
  clients: AutomationArrClients;
};

export class AutomationQuotaSafetyError extends Error {
  readonly action: QuotaAction;
  readonly completed: number;

  constructor(action: QuotaAction, completed: number) {
    super(`Automation ${action} quota exhausted`);
    this.name = "AutomationQuotaSafetyError";
    this.action = action;
    this.completed = completed;
  }
}

export function createAutomationExecutor(options: AutomationExecutorOptions): AutomationExecutionAdapter {
  const repositories = options.repositories;
  const now = options.now ?? (() => new Date());
  const getSettings = options.getSettings ?? (() => defaultAppSettings);

  const quota = () =>
    options.quota ??
    new QuotaService(repositories, {
      now,
      ...getSettings().quota,
    });

  return async ({ goal, run, workItems, context }) => {
    let completed = 0;
    const activeItems = workItems.filter((item) => item.status !== "satisfied" && item.status !== "out_of_scope");

    for (const item of activeItems) {
      context?.throwIfCancelled();

      if (shouldSkipAfterGrab(item)) {
        recordEvent(repositories, run, "info", `Skipping ${item.title}; already grabbed after latest analysis`, now());
        completed += 1;
        context?.incrementProgress();
        continue;
      }

      if (isWithinSearchInterval(item, goal.minSearchIntervalHours, now())) {
        repositories.automationWorkItems.updateStatus(item.id, {
          status: "cooldown",
          updatedAt: now(),
        });
        recordEvent(repositories, run, "info", `Skipping ${item.title}; search cooldown is still active`, now());
        completed += 1;
        context?.incrementProgress();
        continue;
      }

      const searchReservation = quota().reserve("search", activityDetails(item, `Automation search: ${item.title}`));
      if (!searchReservation.allowed) {
        throw new AutomationQuotaSafetyError("search", completed);
      }

      repositories.automationWorkItems.updateStatus(item.id, { status: "searching", updatedAt: now() });
      let searchCompleted = false;
      let grabActivityId: number | undefined;

      try {
        const releases = await getReleases(options.clients, item);
        const candidate = selectBestFunRelease(releases);
        if (!candidate) {
          repositories.automationWorkItems.updateStatus(item.id, {
            status: "pending",
            lastSearchedAt: now(),
            incrementSearchAttempt: true,
            lastError: null,
            updatedAt: now(),
          });
          quota().complete(searchReservation.activityId!, "success", `No FuN candidate found for ${item.title}`);
          searchCompleted = true;
          completed += 1;
          context?.incrementProgress();
          continue;
        }

        const candidateId = repositories.releaseCandidates.insert({
          instanceId: item.instanceId,
          mediaItemId: item.mediaItemId,
          childArrId: item.childArrId,
          release: candidate,
          foundAt: now(),
        });
        repositories.automationWorkItems.updateStatus(item.id, {
          status: "candidate_found",
          lastSearchedAt: now(),
          incrementSearchAttempt: true,
          lastError: null,
          updatedAt: now(),
        });
        quota().complete(searchReservation.activityId!, "success", `FuN candidate found for ${item.title}`);
        searchCompleted = true;

        if (goal.actionMode === "search_and_grab" && goal.executionStrategy === "grab_immediately") {
          const grabReservation = quota().reserve("grab", activityDetails(item, `Automation grab: ${item.title}`));
          if (!grabReservation.allowed) {
            throw new AutomationQuotaSafetyError("grab", completed);
          }
          grabActivityId = grabReservation.activityId;

          await grabRelease(options.clients, item, candidate);
          repositories.releaseCandidates.delete(candidateId);
          repositories.automationWorkItems.updateStatus(item.id, {
            status: "grabbed",
            lastGrabbedAt: now(),
            lastError: null,
            updatedAt: now(),
          });
          quota().complete(grabActivityId!, "success", `Grabbed FuN candidate for ${item.title}`);
          grabActivityId = undefined;
        }

        completed += 1;
        context?.incrementProgress();
      } catch (error) {
        if (error instanceof AutomationQuotaSafetyError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        repositories.automationWorkItems.updateStatus(item.id, {
          status: "failed",
          lastError: message,
          updatedAt: now(),
        });
        if (grabActivityId != null) {
          quota().complete(grabActivityId, "failed", message);
        } else if (!searchCompleted) {
          quota().complete(searchReservation.activityId!, "failed", message);
        }
        completed += 1;
        context?.incrementProgress();
      }
    }

    return { completed };
  };
}

function getReleases(clients: AutomationArrClients, item: AutomationWorkItemView): Promise<ArrRelease[]> | ArrRelease[] {
  if (item.kind === "movie") {
    return clients.radarr.getReleasesForMovie(item.childArrId);
  }
  return clients.sonarr.getReleasesForEpisode(item.childArrId);
}

function grabRelease(clients: AutomationArrClients, item: AutomationWorkItemView, release: ArrRelease): Promise<void> | void {
  if (item.kind === "movie") {
    return clients.radarr.grabRelease(release);
  }
  return clients.sonarr.grabRelease(release);
}

function activityDetails(item: AutomationWorkItemView, message: string) {
  return {
    childArrId: item.childArrId,
    instanceId: item.instanceId,
    mediaItemId: item.mediaItemId,
    message,
  };
}

function shouldSkipAfterGrab(item: AutomationWorkItemView): boolean {
  if (item.status !== "grabbed" || !item.lastGrabbedAt || !item.lastAnalyzedAt) {
    return false;
  }
  return new Date(item.lastGrabbedAt).getTime() >= new Date(item.lastAnalyzedAt).getTime();
}

function isWithinSearchInterval(item: AutomationWorkItemView, intervalHours: number, now: Date): boolean {
  if (!item.lastSearchedAt || intervalHours <= 0) {
    return false;
  }
  const lastSearchedAt = new Date(item.lastSearchedAt).getTime();
  if (!Number.isFinite(lastSearchedAt)) {
    return false;
  }
  return now.getTime() - lastSearchedAt < intervalHours * 60 * 60 * 1000;
}

function recordEvent(
  repositories: Repositories,
  run: AutomationRunView,
  level: "info" | "warning" | "error",
  message: string,
  createdAt: Date,
): void {
  repositories.automationEvents.insert({ goalId: run.goalId, runId: run.id, level, message, createdAt });
}
