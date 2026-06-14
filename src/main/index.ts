import { app, safeStorage } from "electron";
import { join } from "node:path";
import { createAppShell } from "./app-shell";
import { createAppDatabase } from "./db/client";
import { migrateDatabase } from "./db/migrations";
import { createRepositories } from "./db/repositories";
import { InstanceStore } from "./instances/instance-store";
import { registerIpcHandlers, registerPersistedSchedules } from "./ipc";
import { createNotificationAdapter } from "./notifications";
import { JobRunner } from "./scheduler/job-runner";
import { Scheduler } from "./scheduler/scheduler";
import { createSecretStore } from "./secrets/secret-store";
import { createTray } from "./tray";

export let isQuitting = false;

app.whenReady().then(() => {
  const notificationAdapter = createNotificationAdapter();
  const scheduler = new Scheduler();
  const window = createAppShell();
  const db = createAppDatabase(join(app.getPath("userData"), "arr-ops.sqlite"));
  migrateDatabase(db);
  const repositories = createRepositories(db);
  const jobRunner = new JobRunner(notificationAdapter, {
    persistence: repositories.jobs,
    onChange: (event) => window.webContents.send("jobs:event", event),
  });
  const instanceStore = new InstanceStore(
    join(app.getPath("userData"), "instances.json"),
    createSecretStore(safeStorage),
  );

  const ipcState = { instanceStore, jobRunner, repositories, scheduler };
  registerIpcHandlers(ipcState);
  registerPersistedSchedules(ipcState);
  createTray(window, {
    runAnalysis: () => {
      jobRunner.enqueue({ name: "Manual analysis", kind: "analysis", steps: [async () => undefined] });
    },
    pauseScheduler: (paused) => scheduler.setPaused(paused),
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // Keep running in the tray/background on Windows.
});
