import { app, safeStorage } from "electron";
import { join } from "node:path";
import { createAppShell } from "./app-shell";

// In dev mode Electron falls back to "Electron" as the app name (no package.json
// in the build output dir), which redirects userData to %APPDATA%\Electron instead
// of %APPDATA%\arr-ops where the GUI stores its data. Fix this before any path lookup.
if (!app.isPackaged) {
  app.setName("arr-ops");
}
import { createAppDatabase } from "./db/client";
import { migrateDatabase } from "./db/migrations";
import { createRepositories } from "./db/repositories";
import { InstanceStore } from "./instances/instance-store";
import { enqueueRadarrAnalysis, enqueueSonarrAnalysis, registerIpcHandlers, registerPersistedAutomationGoals, registerPersistedSchedules } from "./ipc";
import { createNotificationAdapter } from "./notifications";
import { JobRunner } from "./scheduler/job-runner";
import { Scheduler } from "./scheduler/scheduler";
import { createSecretStore } from "./secrets/secret-store";
import { getAppSettings } from "./settings/app-settings";
import { applyLoginStartupSetting } from "./settings/login-startup";
import { createTray } from "./tray";
import { isCliInvocation, runCli } from "../cli/run";

export let isQuitting = false;

const userArgs = process.argv.slice(app.isPackaged ? 1 : 2);

if (isCliInvocation(userArgs)) {
  void runCli(userArgs);
} else {
  app.whenReady().then(() => {
    const notificationAdapter = createNotificationAdapter();
    const scheduler = new Scheduler();
    const window = createAppShell();
    const db = createAppDatabase(join(app.getPath("userData"), "arr-ops.sqlite"));
    migrateDatabase(db);
    const repositories = createRepositories(db);
    scheduler.setPaused(repositories.settings.get<boolean>("scheduler.paused", false) === true);
    const jobRunner = new JobRunner(notificationAdapter, {
      persistence: repositories.jobs,
      onChange: (event) => window.webContents.send("jobs:event", event),
    });
    const instanceStore = new InstanceStore(
      join(app.getPath("userData"), "instances.json"),
      createSecretStore(safeStorage),
    );

    applyLoginStartupSetting(getAppSettings(repositories), app);

    const ipcState = { instanceStore, jobRunner, loginStartup: app, repositories, scheduler };
    registerIpcHandlers(ipcState);
    registerPersistedSchedules(ipcState);
    void registerPersistedAutomationGoals(ipcState).catch((error) => {
      console.error("Failed to start persisted automation goals", error);
    });
    const trayController = createTray(window, {
      runAnalysis: () => {
        for (const instance of instanceStore.list().filter((item) => item.enabled && item.hasApiKey)) {
          if (instance.kind === "sonarr") enqueueSonarrAnalysis(ipcState, "Tray: Analyze Sonarr");
          else enqueueRadarrAnalysis(ipcState, "Tray: Analyze Radarr");
        }
      },
      pauseScheduler: (paused) => scheduler.setPaused(paused),
    });
    trayController.setSchedulerPaused(scheduler.isPaused());
    scheduler.onPauseChange((paused) => {
      repositories.settings.set("scheduler.paused", paused);
      trayController.setSchedulerPaused(paused);
      if (!window.isDestroyed()) window.webContents.send("scheduler:event", { paused });
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("window-all-closed", () => {
    // Keep running in the tray/background on Windows.
  });
}
