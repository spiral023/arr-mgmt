import { app, safeStorage } from "electron";
import { join } from "node:path";
import { createAppDatabase } from "../main/db/client";
import { migrateDatabase } from "../main/db/migrations";
import { createRepositories } from "../main/db/repositories";
import { createNotificationAdapter } from "../main/notifications";
import { JobRunner } from "../main/scheduler/job-runner";
import { Scheduler } from "../main/scheduler/scheduler";
import { createSecretStore } from "../main/secrets/secret-store";
import type { IpcState } from "../main/ipc";
import { isCliInvocation, parseCliArgs } from "./args";
import { runCommand } from "./commands";
import { CliInstanceStore, loadDevEnvInstanceOverrides } from "./env-instances";
import { fail, render, type CommandResult } from "./output";

export { isCliInvocation };

function emit(result: CommandResult, pretty: boolean): void {
  process.stdout.write(render(result, pretty) + "\n");
}

export async function runCli(userArgs: string[]): Promise<void> {
  const args = parseCliArgs(userArgs);
  try {
    await app.whenReady();
    const userData = app.getPath("userData");
    const db = createAppDatabase(join(userData, "arr-ops.sqlite"));
    db.pragma("busy_timeout = 5000");
    migrateDatabase(db);
    const repositories = createRepositories(db);
    const instanceStore = new CliInstanceStore(join(userData, "instances.json"), createSecretStore(safeStorage), {
      overrides: loadDevEnvInstanceOverrides({ isPackaged: app.isPackaged }),
    });
    const jobRunner = new JobRunner(createNotificationAdapter(), {
      persistence: repositories.jobs,
      onChange: args.quiet
        ? undefined
        : (change) => {
            if (change.type === "event" && change.event) {
              process.stderr.write(`[${change.event.level}] ${change.event.message}\n`);
            }
          },
    });
    const state: IpcState = { instanceStore, jobRunner, repositories, scheduler: new Scheduler() };

    const result = await runCommand(state, args);
    emit(result, args.pretty);
    app.exit(result.ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit(fail("internal_error", message, "Unerwarteter Fehler — Details siehe stderr."), args.pretty);
    if (error instanceof Error && error.stack) process.stderr.write(error.stack + "\n");
    app.exit(1);
  }
}
