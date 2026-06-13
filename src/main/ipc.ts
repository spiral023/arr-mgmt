import { ipcMain } from "electron";
import type { JobRunner } from "./scheduler/job-runner";

export type IpcState = {
  jobRunner: JobRunner;
};

export function registerIpcHandlers(state: IpcState): void {
  ipcMain.handle("jobs:list", () => state.jobRunner.listJobs());
  ipcMain.handle("jobs:enqueue", (_event, payload: unknown) => {
    const name =
      typeof payload === "object" && payload !== null && "name" in payload && typeof payload.name === "string"
        ? payload.name
        : "Manual job";
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
  ipcMain.handle("library:sonarr", () => []);
  ipcMain.handle("library:radarr", () => []);
  ipcMain.handle("quota:summary", () => ({
    search: { used: 0, remaining: 2000, limit: 2000 },
    grab: { used: 0, remaining: 400, limit: 400 },
  }));
  ipcMain.handle("settings:get", () => ({}));
  ipcMain.handle("settings:update", (_event, payload: unknown) => payload);
  ipcMain.handle("instances:list", () => []);
  ipcMain.handle("instances:save", (_event, payload: unknown) => payload);
  ipcMain.handle("instances:test", () => ({ ok: false, message: "No instance configured" }));
}
