import { ipcMain } from "electron";
import { analyzeSonarrSeries } from "./arr/analysis-service";
import type { MediaItemAnalysis } from "./arr/arr-types";
import { RadarrClient } from "./arr/radarr-client";
import { SonarrClient } from "./arr/sonarr-client";
import type { InstanceStore } from "./instances/instance-store";
import type { JobRunner } from "./scheduler/job-runner";
import type {
  InstanceConfigInput,
  InstanceKind,
  InstanceTestResult,
  SonarrSeriesTableRow,
} from "../shared/ipc-contracts";

export type IpcState = {
  instanceStore: InstanceStore;
  jobRunner: JobRunner;
};

let sonarrRows: SonarrSeriesTableRow[] = [];

export function registerIpcHandlers(state: IpcState): void {
  ipcMain.handle("jobs:list", () => state.jobRunner.listJobs());
  ipcMain.handle("jobs:enqueue", async (_event, payload: unknown) => {
    const name =
      typeof payload === "object" && payload !== null && "name" in payload && typeof payload.name === "string"
        ? payload.name
        : "Manual job";
    const target =
      typeof payload === "object" && payload !== null && "target" in payload && typeof payload.target === "string"
        ? payload.target
        : "";

    if (target === "sonarr") {
      const job = state.jobRunner.enqueue({
        name,
        kind: "analysis",
        steps: [
          async () => {
            sonarrRows = await analyzeSonarrLibrary(state.instanceStore);
          },
        ],
      });

      await waitForJobCompletion(state.jobRunner, job.id);
      return job;
    }

    return state.jobRunner.enqueue({
      name,
      kind: "analysis",
      steps: [async () => undefined],
    });
  });
  ipcMain.handle("library:summary", () => ({
    totalSeries: 0,
    totalMovies: 0,
    funShare: 0,
  }));
  ipcMain.handle("library:sonarr", () => sonarrRows);
  ipcMain.handle("library:radarr", () => []);
  ipcMain.handle("quota:summary", () => ({
    search: { used: 0, remaining: 2000, limit: 2000 },
    grab: { used: 0, remaining: 400, limit: 400 },
  }));
  ipcMain.handle("settings:get", () => ({
    instances: state.instanceStore.list(),
  }));
  ipcMain.handle("settings:update", (_event, payload: unknown) => payload);
  ipcMain.handle("instances:list", () => state.instanceStore.list());
  ipcMain.handle("instances:save", (_event, payload: unknown) => {
    return state.instanceStore.save(assertInstanceInput(payload));
  });
  ipcMain.handle("instances:test", async (_event, payload: unknown): Promise<InstanceTestResult> => {
    const input = assertInstanceInput(payload);
    try {
      const config = state.instanceStore.getWithApiKey(input.kind, input);
      const client =
        input.kind === "sonarr"
          ? new SonarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey })
          : new RadarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
      const status = await client.getStatus();
      return {
        ok: true,
        message: `${status.appName ?? input.kind} ${status.version ?? ""}`.trim(),
        version: status.version,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

async function analyzeSonarrLibrary(instanceStore: InstanceStore): Promise<SonarrSeriesTableRow[]> {
  const config = instanceStore.getWithApiKey("sonarr");
  const client = new SonarrClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const seriesList = await client.getSeries();
  const analyzedAt = new Date();
  const rows: SonarrSeriesTableRow[] = [];

  for (const series of seriesList) {
    const episodes = await client.getEpisodes(series.id, true);
    rows.push(toSonarrRow(analyzeSonarrSeries(series, episodes, analyzedAt)));
  }

  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

function toSonarrRow(item: MediaItemAnalysis): SonarrSeriesTableRow {
  return {
    id: `series-${item.arrId}`,
    arrId: item.arrId,
    title: item.title,
    monitored: item.monitored,
    episodes: item.totalChildren,
    files: item.childrenWithFile,
    totalSizeBytes: item.totalSizeBytes,
    funFiles: item.funChildren,
    funShare: item.funShare,
    nonFunFiles: item.nonFunChildren,
    hasFiles: item.hasFile,
    lastAnalyzed: formatDateTime(item.lastAnalyzedAt),
    lastSearched: "-",
    lastGrabbed: "-",
    status: item.nonFunChildren > 0 && item.funChildren > 0 ? "searchable" : "ready",
  };
}

function assertInstanceInput(payload: unknown): InstanceConfigInput {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid instance payload");
  }
  const value = payload as Partial<InstanceConfigInput>;
  if (value.kind !== "sonarr" && value.kind !== "radarr") {
    throw new Error("Invalid instance kind");
  }
  if (typeof value.name !== "string" || typeof value.baseUrl !== "string") {
    throw new Error("Instance name and base URL are required");
  }
  return {
    kind: value.kind,
    name: value.name,
    baseUrl: value.baseUrl,
    apiKey: typeof value.apiKey === "string" ? value.apiKey : undefined,
    enabled: value.enabled,
  };
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

async function waitForJobCompletion(jobRunner: JobRunner, jobId: string): Promise<void> {
  for (let i = 0; i < 600; i += 1) {
    const job = jobRunner.listJobs().find((candidate) => candidate.id === jobId);
    if (job?.status === "completed" || job?.status === "failed") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
