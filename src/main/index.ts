import { app } from "electron";
import { createAppShell } from "./app-shell";
import { registerIpcHandlers } from "./ipc";
import { createNotificationAdapter } from "./notifications";
import { JobRunner } from "./scheduler/job-runner";
import { Scheduler } from "./scheduler/scheduler";
import { createTray } from "./tray";

export let isQuitting = false;

app.whenReady().then(() => {
  const notificationAdapter = createNotificationAdapter();
  const jobRunner = new JobRunner(notificationAdapter);
  const scheduler = new Scheduler();
  const window = createAppShell();

  registerIpcHandlers({ jobRunner });
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
