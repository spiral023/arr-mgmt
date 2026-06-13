import { app, safeStorage } from "electron";
import { join } from "node:path";
import { createAppShell } from "./app-shell";
import { InstanceStore } from "./instances/instance-store";
import { registerIpcHandlers } from "./ipc";
import { createNotificationAdapter } from "./notifications";
import { JobRunner } from "./scheduler/job-runner";
import { Scheduler } from "./scheduler/scheduler";
import { createSecretStore } from "./secrets/secret-store";
import { createTray } from "./tray";

export let isQuitting = false;

app.whenReady().then(() => {
  const notificationAdapter = createNotificationAdapter();
  const jobRunner = new JobRunner(notificationAdapter);
  const scheduler = new Scheduler();
  const instanceStore = new InstanceStore(
    join(app.getPath("userData"), "instances.json"),
    createSecretStore(safeStorage),
  );
  const window = createAppShell();

  registerIpcHandlers({ instanceStore, jobRunner });
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
