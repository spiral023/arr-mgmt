import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcChannel } from "../../src/shared/ipc-contracts";

const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
  shell: { openExternal: vi.fn() },
}));

describe("automation IPC handlers", () => {
  beforeEach(() => {
    handlers.clear();
    vi.resetModules();
  });

  it("registers automation handlers and uses an injected automation runner for manual runs", async () => {
    const { registerIpcHandlers } = await import("../../src/main/ipc");
    const automationRunner = {
      runEligible: vi.fn(),
      runGoal: vi.fn(async () => ({ id: 5, goalId: 7, status: "completed" })),
    };
    const state = createState({ automationRunner });

    registerIpcHandlers(state);

    expect(automationChannels.every((channel) => handlers.has(channel))).toBe(true);
    await expect(invoke("automation:runGoal", { goalId: 7 })).resolves.toEqual({ id: 5, goalId: 7, status: "completed" });
    expect(automationRunner.runGoal).toHaveBeenCalledWith(7, "manual");
  });

  it("validates goal id payloads defensively", async () => {
    const { registerIpcHandlers } = await import("../../src/main/ipc");
    registerIpcHandlers(createState());

    await expect(invoke("automation:getGoal", {})).rejects.toThrow("goalId is required");
    await expect(invoke("automation:deleteGoal", { goalId: 0 })).rejects.toThrow("goalId is required");
    await expect(invoke("automation:pauseGoal", { goalId: "7" })).rejects.toThrow("goalId is required");
    await expect(invoke("automation:resumeGoal", { goalId: 1.5 })).rejects.toThrow("goalId is required");
    await expect(invoke("automation:runGoal", undefined)).rejects.toThrow("goalId is required");
  });

  it("validates reorder payloads defensively", async () => {
    const { registerIpcHandlers } = await import("../../src/main/ipc");
    registerIpcHandlers(createState());

    await expect(invoke("automation:reorderGoals", {})).rejects.toThrow("goalIds are required");
    await expect(invoke("automation:reorderGoals", { goalIds: [] })).rejects.toThrow("goalIds are required");
    await expect(invoke("automation:reorderGoals", { goalIds: [1, 0] })).rejects.toThrow("goalIds are required");
    await expect(invoke("automation:reorderGoals", { goalIds: [1, "2"] })).rejects.toThrow("goalIds are required");
  });

  it("validates automation goal payload shape before saving", async () => {
    const { registerIpcHandlers } = await import("../../src/main/ipc");
    registerIpcHandlers(createState());

    await expect(invoke("automation:saveGoal", goalInput({ targetFunShare: Number.NaN }))).rejects.toThrow(
      "Invalid automation target FuN share",
    );
    await expect(
      invoke("automation:saveGoal", goalInput({ filters: { monitored: "yes" } })),
    ).rejects.toThrow("Automation filters are required");
    await expect(
      invoke(
        "automation:saveGoal",
        goalInput({
          filters: {
            ...defaultFilters(),
            searched: { mode: "older_than", days: 0 },
          },
        }),
      ),
    ).rejects.toThrow("Invalid automation recency filter");
  });
});

const automationChannels: IpcChannel[] = [
  "automation:listGoals",
  "automation:getGoal",
  "automation:saveGoal",
  "automation:deleteGoal",
  "automation:reorderGoals",
  "automation:pauseGoal",
  "automation:resumeGoal",
  "automation:runGoal",
  "automation:runEligible",
  "automation:listEvents",
];

function invoke(channel: IpcChannel, payload?: unknown) {
  const handler = handlers.get(channel);
  if (!handler) {
    throw new Error(`Handler ${channel} was not registered`);
  }
  return Promise.resolve().then(() => handler({}, payload));
}

function createState(overrides: Record<string, unknown> = {}) {
  return {
    instanceStore: {
      getWithApiKey: vi.fn(),
      list: vi.fn(() => []),
      save: vi.fn(),
    },
    jobRunner: {
      enqueue: vi.fn(),
      listEvents: vi.fn(() => []),
      listJobs: vi.fn(() => []),
      cancel: vi.fn(),
      waitFor: vi.fn(),
    },
    repositories: {
      activityLog: { listRecent: vi.fn(() => []), countSince: vi.fn(() => 0) },
      automationEvents: { list: vi.fn(() => []) },
      automationGoals: {
        delete: vi.fn(),
        find: vi.fn((id: number) => ({ id, name: "Goal" })),
        list: vi.fn(() => []),
        reorder: vi.fn(),
        setManualStatus: vi.fn(),
        upsert: vi.fn((input) => ({ ...input, id: input.id ?? 1, priority: 1, manualStatus: "active" })),
      },
      instances: { upsert: vi.fn() },
      mediaItems: {
        itemDetails: vi.fn(),
        listRadarrRows: vi.fn(() => []),
        listSonarrRows: vi.fn(() => []),
        summary: vi.fn(),
      },
      schedules: { delete: vi.fn(), list: vi.fn(() => []), upsert: vi.fn() },
      settings: { get: vi.fn(), set: vi.fn() },
      stats: { summary: vi.fn() },
    },
    scheduler: { remove: vi.fn(), register: vi.fn() },
    ...overrides,
  } as never;
}

function goalInput(overrides: Record<string, unknown> = {}) {
  return {
    actionMode: "search_and_grab",
    enabled: true,
    executionStrategy: "grab_immediately",
    filters: defaultFilters(),
    minSearchIntervalHours: 168,
    name: "Goal",
    ordering: "oldest_search_first",
    runOnStartup: true,
    schedule: null,
    scope: "sonarr",
    targetFunShare: 0.95,
    ...overrides,
  };
}

function defaultFilters() {
  return {
    analyzed: { mode: "any" },
    funShare: { operator: "lt", value: 0.95 },
    grabbed: { mode: "any" },
    hasFile: "yes",
    monitored: "yes",
    qualityProfiles: [],
    searched: { mode: "older_than", days: 7 },
  };
}
