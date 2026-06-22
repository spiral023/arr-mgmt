import { describe, expect, it, vi } from "vitest";
import { combineStatuses, jobsToActionData } from "./commands";
import type { Job } from "../main/scheduler/job-runner";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
  safeStorage: { encryptString: vi.fn(), decryptString: vi.fn() },
  app: { getPath: vi.fn(() => ""), whenReady: vi.fn() },
}));

import { createInMemoryDatabase } from "../main/db/client";
import { migrateDatabase } from "../main/db/migrations";
import { createRepositories } from "../main/db/repositories";
import { JobRunner } from "../main/scheduler/job-runner";
import { Scheduler } from "../main/scheduler/scheduler";
import type { IpcState } from "../main/ipc";
import { parseCliArgs } from "./args";
import { runCommand } from "./commands";

function makeState(): IpcState {
  const db = createInMemoryDatabase();
  migrateDatabase(db);
  const repositories = createRepositories(db);
  const jobRunner = new JobRunner({ show: () => {} }, { persistence: repositories.jobs });
  const instanceStore = {
    list: () => [],
    save: () => ({ kind: "sonarr", name: "Sonarr", baseUrl: "", enabled: true, hasApiKey: false }),
    getWithApiKey: () => {
      throw new Error("sonarr API key is not saved yet");
    },
  } as unknown as IpcState["instanceStore"];
  return { instanceStore, jobRunner, repositories, scheduler: new Scheduler() };
}

describe("runCommand read commands", () => {
  it("library summary returns the repository summary", async () => {
    const result = await runCommand(makeState(), parseCliArgs(["library", "summary"]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveProperty("totalSeries");
  });

  it("library sonarr returns a paginated, slim list", async () => {
    const result = await runCommand(makeState(), parseCliArgs(["library", "sonarr"]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.page).toEqual({ total: 0, shown: 0, offset: 0 });
    }
  });

  it("quota returns search and grab buckets", async () => {
    const result = await runCommand(makeState(), parseCliArgs(["quota"]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveProperty("search");
  });

  it("instances list returns an array", async () => {
    const result = await runCommand(makeState(), parseCliArgs(["instances", "list"]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });

  it("an unknown verb fails with unknown_command", async () => {
    const result = await runCommand(makeState(), parseCliArgs(["frobnicate"]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unknown_command");
  });

  it("item without a valid arrId fails with missing_argument", async () => {
    const result = await runCommand(makeState(), parseCliArgs(["item", "series"]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("missing_argument");
  });

  it("help lists the known verbs", async () => {
    const result = await runCommand(makeState(), parseCliArgs(["help"]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveProperty("commands");
  });

  it("help points agents at the companion CLI executable", async () => {
    const result = await runCommand(makeState(), parseCliArgs(["help"]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveProperty("usage", "arr-cli.exe <verb> [sub] [optionen]");
  });
});

function job(partial: Partial<Job>): Job {
  return {
    id: "j",
    name: "n",
    kind: "search",
    target: "selected",
    status: "completed",
    progressCurrent: 0,
    progressTotal: 0,
    successCount: 0,
    failureCount: 0,
    createdAt: "2026-06-21T00:00:00.000Z",
    ...partial,
  };
}

describe("job aggregation", () => {
  it("combineStatuses prefers the worst status", () => {
    expect(combineStatuses(["completed", "failed", "running"])).toBe("failed");
    expect(combineStatuses(["completed", "blocked_by_budget"])).toBe("blocked_by_budget");
    expect(combineStatuses(["completed", "completed"])).toBe("completed");
    expect(combineStatuses([])).toBe("completed");
  });

  it("jobsToActionData sums counters and collects ids", () => {
    const data = jobsToActionData([
      job({ id: "a", successCount: 3, failureCount: 1, progressCurrent: 4, progressTotal: 4 }),
      job({ id: "b", successCount: 2, failureCount: 0, progressCurrent: 2, progressTotal: 5, status: "blocked_by_budget" }),
    ]);
    expect(data.jobIds).toEqual(["a", "b"]);
    expect(data.succeeded).toBe(5);
    expect(data.failed).toBe(1);
    expect(data.processed).toBe(6);
    expect(data.total).toBe(9);
    expect(data.status).toBe("blocked_by_budget");
  });
});

describe("action command validation", () => {
  it("search without --ids fails with missing_argument", async () => {
    const result = await runCommand(makeState(), parseCliArgs(["search", "sonarr"]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("missing_argument");
  });

  it("analyze with an unknown target fails", async () => {
    const result = await runCommand(makeState(), parseCliArgs(["analyze", "nope"]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("missing_argument");
  });
});
